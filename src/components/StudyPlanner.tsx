import React, { useState, useEffect, useRef, useMemo } from 'react';
import { AcademicActivity, Semester, AcademicDay } from '../types';
import { getCATDateComponents, normalizeToCATDateString, evaluateAcademicDayStatus, isDayManuallyEnded } from '../lib/catTime';
import { GeneratePlanButton } from './planner/GeneratePlanButton';
import { PlannerCard } from './planner/PlannerCard';
import { updateSessionStatus, generateAndPersistDailyPlan } from '../lib/plannerFirestore';
import { auth } from '../lib/firebase';
import { 
  Calendar, 
  Brain, 
  Clock, 
  Loader2, 
  ChevronLeft, 
  ChevronRight, 
  RotateCcw, 
  Coffee, 
  Moon, 
  Sun, 
  CheckCircle2, 
  Sparkles 
} from 'lucide-react';
import { SemesterDashboard } from './SemesterDashboard';
import { SemesterSetupWizard } from './SemesterSetupWizard';
import { useSOMA } from '../lib/realtime';

interface StudyPlannerProps {
  onOpenAI?: (target?: any) => void;
  onOpenPractice?: (moduleId: string, topicId: string) => void;
}

export const StudyPlanner: React.FC<StudyPlannerProps> = ({ onOpenAI, onOpenPractice }) => {
  const {
    activeSemester: semester,
    days: allDays,
    activities: allActivities,
    loading: somaLoading,
    syncStatus
  } = useSOMA();

  const [activeDay, setActiveDay] = useState<AcademicDay | null>(null);
  const [view, setView] = useState<'planner' | 'timeline'>('planner');
  const [isAutoGenerating, setIsAutoGenerating] = useState(false);
  const attemptedAutoGenerateRef = useRef<Set<string>>(new Set());

  const currentCat = getCATDateComponents();

  // Sort all days chronologically
  const sortedDays = useMemo(() => {
    return [...allDays].sort((a, b) => {
      const da = new Date(a.date).getTime();
      const db = new Date(b.date).getTime();
      return da - db;
    });
  }, [allDays]);

  // Sync activeDay with today initially if not set
  useEffect(() => {
    if (!activeDay && sortedDays.length > 0) {
      const today = sortedDays.find(d => normalizeToCATDateString(d.date) === currentCat.dateString);
      setActiveDay(today || sortedDays[0]);
    }
  }, [sortedDays, activeDay, currentCat.dateString]);

  const activeDayIndex = useMemo(() => {
    if (!activeDay) return -1;
    return sortedDays.findIndex(d => d.id === activeDay.id);
  }, [sortedDays, activeDay]);

  const activeDateStr = activeDay ? normalizeToCATDateString(activeDay.date) : '';
  const isToday = activeDateStr === currentCat.dateString;
  const isSaturday = activeDay?.dayOfWeek === 'Saturday';
  const isSunday = activeDay?.dayOfWeek === 'Sunday';

  const dayActivities = useMemo(() => {
    if (!activeDay) return [];
    return allActivities.filter(a => a.dayId === activeDay.id);
  }, [allActivities, activeDay]);

  const classes = useMemo(() => {
    return dayActivities.filter(a => a.type === 'class');
  }, [dayActivities]);

  const sessions = useMemo(() => {
    return dayActivities.filter(a => a.type === 'study_session');
  }, [dayActivities]);

  const hasAfternoonClass = useMemo(() => {
    return classes.some(c => {
      const e = c.endTime || '';
      const s = c.startTime || '';
      return e > '13:30' || s >= '13:30';
    });
  }, [classes]);

  // Auto-generate if today has no sessions yet
  useEffect(() => {
    if (activeDay && semester && sessions.length === 0 && !isAutoGenerating && !isSaturday && !attemptedAutoGenerateRef.current.has(activeDay.id)) {
      const userId = auth.currentUser?.uid;
      if (userId && isToday) {
        attemptedAutoGenerateRef.current.add(activeDay.id);
        setIsAutoGenerating(true);
        const dateStr = activeDay.date instanceof Date ? activeDay.date.toISOString().split('T')[0] : activeDay.date;
        generateAndPersistDailyPlan(userId, semester.id, activeDay.id, dateStr)
          .catch(err => console.error("Auto-generate daily plan error:", err))
          .finally(() => setIsAutoGenerating(false));
      }
    }
  }, [activeDay, semester, sessions.length, isAutoGenerating, isSaturday, isToday]);

  const handleStartSession = (session: AcademicActivity) => {
    if (onOpenAI) {
      onOpenAI({
        topic: session.topicName || session.title,
        module: session.moduleName || 'General',
        reason: session.reason,
        objective: session.title,
        sessionId: session.id
      });
      
      if (activeDay) {
        updateSessionStatus(session.id, 'In Progress', activeDay.id);
      }
    }
  };

  const handleStatusUpdate = async (id: string, status: AcademicActivity['status']) => {
    if (activeDay) {
      await updateSessionStatus(id, status, activeDay.id);
    }
  };

  const handlePrevDay = () => {
    if (activeDayIndex > 0) {
      setActiveDay(sortedDays[activeDayIndex - 1]);
    }
  };

  const handleNextDay = () => {
    if (activeDayIndex >= 0 && activeDayIndex < sortedDays.length - 1) {
      setActiveDay(sortedDays[activeDayIndex + 1]);
    }
  };

  const handleJumpToToday = () => {
    const today = sortedDays.find(d => normalizeToCATDateString(d.date) === currentCat.dateString);
    if (today) setActiveDay(today);
  };

  if (somaLoading) {
    return (
      <div className="p-12 text-center text-neutral-500 font-medium animate-pulse">
        Synchronizing with SOMA Intelligence...
      </div>
    );
  }

  if (!semester) {
    return <SemesterSetupWizard />;
  }

  if (!activeDay) {
    return (
      <div className="p-12 text-center bg-white rounded-3xl border border-dashed max-w-2xl mx-auto space-y-4">
        <Calendar className="w-12 h-12 text-neutral-300 mx-auto" />
        <h3 className="text-xl font-bold text-neutral-800">Planner Unavailable</h3>
        <p className="text-neutral-500 text-sm">Please ensure today's date is within your semester range.</p>
      </div>
    );
  }

  const dayStatus = evaluateAcademicDayStatus(activeDay.date, currentCat, isDayManuallyEnded(activeDay.id));

  if (view === 'timeline') {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center bg-white p-4 rounded-2xl border shadow-sm">
          <h2 className="font-bold text-neutral-900">Academic Timeline</h2>
          <button 
            onClick={() => setView('planner')}
            className="text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-xl hover:bg-blue-100 transition-all cursor-pointer"
          >
            Switch to Daily Planner →
          </button>
        </div>
        <SemesterDashboard initialDay={activeDay} onSelectDay={d => setActiveDay(d)} onOpenAI={onOpenAI} />
      </div>
    );
  }

  // Display a window of 7 days around the active day
  const visibleDays = (() => {
    if (sortedDays.length <= 7) return sortedDays;
    const startIdx = Math.max(0, Math.min(activeDayIndex - 3, sortedDays.length - 7));
    return sortedDays.slice(startIdx, startIdx + 7);
  })();

  return (
    <div className="space-y-6 pb-24 max-w-4xl mx-auto">
      {/* Sync Status Bar */}
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${syncStatus === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest font-mono">
            {syncStatus === 'online' ? 'SOMA Intelligence Live' : 'Offline Mode • Sync Pending'}
          </span>
        </div>
        <span className="text-xs text-neutral-500 font-mono tabular-nums">
          {currentCat.shortTimeString} CAT (UTC+2)
        </span>
      </div>

      {isAutoGenerating && (
        <div className="bg-purple-50 border border-purple-200 text-purple-700 px-4 py-3 rounded-2xl flex items-center gap-3 animate-pulse">
          <Loader2 className="w-5 h-5 animate-spin text-purple-600 shrink-0" />
          <div className="text-xs font-semibold">
            SOMA Intelligence Engine is generating your routine-aware daily study plan...
          </div>
        </div>
      )}

      {/* Single Active Day Date-Picker Tab Strip (Zero Endless Scroll) */}
      <div className="bg-white p-3 md:p-4 rounded-3xl border shadow-xs space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              onClick={handlePrevDay}
              disabled={activeDayIndex <= 0}
              className="p-2 rounded-xl text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
              title="Previous Day"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={handleNextDay}
              disabled={activeDayIndex >= sortedDays.length - 1}
              className="p-2 rounded-xl text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
              title="Next Day"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <span className="text-xs font-bold text-neutral-900 ml-1">
              Active Day Selector
            </span>
          </div>

          <div className="flex items-center gap-2">
            {!isToday && (
              <button
                onClick={handleJumpToToday}
                className="text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-xl border border-blue-200 transition-all flex items-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Jump to Today</span>
              </button>
            )}
            <button 
              onClick={() => setView('timeline')}
              className="text-xs font-semibold text-neutral-600 hover:text-blue-600 bg-neutral-100 hover:bg-neutral-200 px-3 py-1.5 rounded-xl transition-all cursor-pointer"
            >
              Timeline View
            </button>
          </div>
        </div>

        {/* Date Tabs Strip */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          {visibleDays.map(d => {
            const dStr = normalizeToCATDateString(d.date);
            const isTabToday = dStr === currentCat.dateString;
            const isSelected = d.id === activeDay.id;
            const dObj = new Date(d.date);
            const dayNum = dObj.getDate();
            const monthStr = dObj.toLocaleDateString('en-US', { month: 'short' });

            return (
              <button
                key={d.id}
                onClick={() => setActiveDay(d)}
                className={`flex-1 min-w-[76px] py-2.5 px-3 rounded-2xl flex flex-col items-center justify-center transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-neutral-900 text-white shadow-sm ring-2 ring-neutral-900/10'
                    : 'bg-neutral-50 hover:bg-neutral-100 text-neutral-700 border border-neutral-200/70'
                }`}
              >
                <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider">
                  <span>{d.dayOfWeek.slice(0, 3)}</span>
                  {isTabToday && (
                    <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-emerald-400' : 'bg-emerald-500 animate-pulse'}`} />
                  )}
                </div>
                <div className="text-base font-bold font-mono tabular-nums leading-tight mt-0.5">
                  {dayNum}
                </div>
                <div className={`text-[9px] ${isSelected ? 'text-neutral-400' : 'text-neutral-500'}`}>
                  {monthStr}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Active Day Header Banner */}
      <div className="bg-white p-6 md:p-8 rounded-3xl border shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-xs uppercase tracking-wider font-semibold text-purple-600 bg-purple-50 px-3 py-1 rounded-full">
              SOMA Intelligence Planner
            </span>
            <span className="text-xs text-neutral-500 font-medium">
              {activeDay.dayOfWeek} · {new Date(activeDay.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </span>
            {isToday && (
              <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                Active Today
              </span>
            )}
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-neutral-900">
            {isSaturday 
              ? 'Saturday Rest & Recovery' 
              : isSunday 
              ? 'Sunday Afternoon Study Plan' 
              : `${activeDay.dayOfWeek} Study Plan`}
          </h1>
          <p className="text-sm text-neutral-500 mt-1">
            {isSaturday 
              ? 'No academic study sessions are scheduled on Saturdays to protect neural rest and consolidation.'
              : isSunday
              ? 'Morning rest and personal time until 14:00 CAT; academic focus resumes in the afternoon.'
              : 'Forward-scheduled according to your master timetable, commute buffers, and current CAT time.'}
          </p>
        </div>

        <div className="flex flex-col gap-2 w-full md:w-auto">
          {!isSaturday && (
            <GeneratePlanButton 
              userId={auth.currentUser?.uid || 'guest'}
              semesterId={semester.id}
              day={activeDay}
              onComplete={() => {}}
              variant="secondary"
            />
          )}
        </div>
      </div>

      {/* Routine & Availability Indicator Bar */}
      <div className="bg-neutral-50 border border-neutral-200/90 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 text-neutral-700">
          <Clock className="w-4 h-4 text-neutral-400 shrink-0" />
          <span className="font-semibold text-neutral-900">Physical Availability:</span>
          {isSaturday ? (
            <span>Restorative Weekend Day (0 sessions)</span>
          ) : isSunday ? (
            <span>Rest until 14:00 CAT · Afternoon sessions active</span>
          ) : (
            <span>
              Arrival 08:30 · {hasAfternoonClass ? '12:00–13:30 Campus Lunch' : '12:00–14:30 Transit Home & Rest'} · Cutoff 23:00
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-neutral-500">
          <span className="font-medium font-mono tabular-nums">
            {sessions.length} {sessions.length === 1 ? 'Study Session' : 'Study Sessions'}
          </span>
          <span>·</span>
          <span className="font-medium font-mono tabular-nums">
            {classes.length} {classes.length === 1 ? 'Class' : 'Classes'}
          </span>
        </div>
      </div>

      {/* Saturday Rest Day Special View */}
      {isSaturday ? (
        <div className="bg-white p-12 text-center rounded-3xl border shadow-sm space-y-4">
          <div className="p-4 bg-emerald-50 text-emerald-600 rounded-3xl w-fit mx-auto border border-emerald-100">
            <Coffee className="w-10 h-10" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold text-neutral-900">Restorative Rest Day</h3>
            <p className="text-sm text-neutral-600 max-w-md mx-auto leading-relaxed">
              Saturday is your dedicated rest day. SOMA protects this time so your brain can consolidate learning from the week. No study sessions are scheduled. Enjoy your rest!
            </p>
          </div>
        </div>
      ) : sessions.length === 0 ? (
        <div className="bg-white p-12 text-center rounded-3xl border shadow-sm space-y-6">
          <div className="p-4 bg-purple-100 text-purple-600 rounded-2xl w-fit mx-auto">
            <Brain className="w-10 h-10" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold text-neutral-900">Your Plan is Ready to be Generated</h3>
            <p className="text-sm text-neutral-500 max-w-md mx-auto leading-relaxed">
              {isToday && currentCat.hours >= 21
                ? 'The academic day is concluding soon (23:00 CAT cutoff). Generate a light evening review session or plan for tomorrow.'
                : `SOMA will schedule study sessions for ${activeDay.dayOfWeek} strictly within your free hours, avoiding class times and commute windows.`}
            </p>
          </div>
          <div className="max-w-xs mx-auto">
            <GeneratePlanButton 
              userId={auth.currentUser?.uid || 'guest'}
              semesterId={semester.id}
              day={activeDay}
              onComplete={() => {}}
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sessions.map(s => (
            <PlannerCard 
              key={s.id} 
              session={s} 
              isEnded={dayStatus.isEnded} 
              onStatusUpdate={handleStatusUpdate}
              onStartSession={handleStartSession}
              onOpenPractice={onOpenPractice}
            />
          ))}
        </div>
      )}

      {dayStatus.isEnded && (
        <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-2xl text-indigo-900 text-xs flex items-center gap-3">
          <Moon className="w-4 h-4 text-indigo-600 shrink-0" />
          <span>The academic day has concluded (23:00 CAT cutoff). Daytime sessions have closed for sleep and memory consolidation.</span>
        </div>
      )}
    </div>
  );
};
