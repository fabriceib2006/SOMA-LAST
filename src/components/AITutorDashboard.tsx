import React, { useState, useEffect, useRef } from 'react';
import { User } from 'firebase/auth';
import { Semester, LibraryModule, AcademicAssessment, LectureMaterial, LibraryTopic } from '../types';
import { getOrCreateDayConversation, saveTutorMessage, clearDayConversationMessages, purgeLegacyErrorMessages, isTutorErrorMessage, TutorMessage } from '../lib/tutorFirestore';
import { addTopicEvidence } from '../lib/performanceFirestore';
import { auth } from '../lib/firebase';
import { getCATDateComponents, getCATGreeting, CATDateComponents } from '../lib/catTime';
import { Sparkles, CheckCircle2, AlertTriangle, ArrowRight, X, Clock, Moon, Trash2, Calendar, RotateCcw } from 'lucide-react';
import { useSOMA } from '../lib/realtime';
import { onSnapshot, collection, query, orderBy, where, doc, deleteDoc, setDoc, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { deleteAssessmentWithCascade, deleteActivityWithCascade } from '../lib/academicCascadeDelete';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, LineChart, Line, CartesianGrid } from 'recharts';

const COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

const markdownComponents = {
  p: ({ node, children, ...props }: any) => (
    <div className="my-1.5 text-neutral-900" {...props}>{children}</div>
  ),
  pre: ({ node, children, ...props }: any) => (
    <div className="p-3 my-2 rounded-xl bg-neutral-900 text-neutral-100 font-mono text-xs overflow-x-auto whitespace-pre" {...props}>
      {children}
    </div>
  ),
  table: ({ node, ...props }: any) => (
    <div className="overflow-x-auto my-3 rounded-xl border border-neutral-200/90 bg-white shadow-xs">
      <table className="min-w-full divide-y divide-neutral-200 text-xs text-neutral-800" {...props} />
    </div>
  ),
  thead: ({ node, ...props }: any) => <thead className="bg-neutral-100/90 text-neutral-900 font-semibold" {...props} />,
  th: ({ node, ...props }: any) => <th className="px-3.5 py-2 text-left text-xs font-bold uppercase tracking-wider text-neutral-700 border-b border-neutral-200" {...props} />,
  td: ({ node, ...props }: any) => <td className="px-3.5 py-2 text-xs border-b border-neutral-100 text-neutral-800 whitespace-normal" {...props} />,
  tr: ({ node, ...props }: any) => <tr className="even:bg-neutral-50/60 hover:bg-neutral-100/40 transition-colors" {...props} />,
  code: ({ node, inline, className, children, ...props }: any) => {
    if (inline) {
      return <code className="px-1.5 py-0.5 rounded-md bg-neutral-100 text-neutral-850 font-mono text-xs border border-neutral-200" {...props}>{children}</code>;
    }
    return <code className="font-mono text-xs text-neutral-100 block whitespace-pre" {...props}>{children}</code>;
  }
};

function renderMessageWithChartsAndTables(content: string) {
  const chartRegex = /```(?:json:chart|json-chart|chart|json)\s*([\s\S]*?)```/g;
  let match;
  let lastIndex = 0;
  const elements: React.ReactNode[] = [];
  let keyIdx = 0;

  while ((match = chartRegex.exec(content)) !== null) {
    const textBefore = content.substring(lastIndex, match.index);
    if (textBefore.trim()) {
      elements.push(
        <div key={`md-${keyIdx++}`} className="prose prose-sm max-w-none prose-headings:text-neutral-950 prose-p:text-neutral-900 prose-li:text-neutral-900 prose-headings:font-bold prose-p:my-1.5 prose-table:border-collapse prose-table:w-full">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{textBefore}</ReactMarkdown>
        </div>
      );
    }

    let isChartRendered = false;
    try {
      const chartJson = JSON.parse(match[1].trim());
      const chartType = chartJson.type;
      const chartTitle = chartJson.title || 'Data Visualization';
      const chartData = chartJson.data;

      if ((chartType === 'pie' || chartType === 'bar' || chartType === 'line') && Array.isArray(chartData) && chartData.length > 0) {
        isChartRendered = true;
        elements.push(
          <div key={`chart-${keyIdx++}`} className="my-4 p-4 bg-white border border-neutral-200 rounded-2xl shadow-xs">
            <h5 className="font-bold text-xs text-neutral-800 mb-3 flex items-center gap-1.5">
              📊 {chartTitle}
            </h5>
            <div className="w-full h-64">
              <ResponsiveContainer width="100%" height="100%">
                {chartType === 'pie' ? (
                  <PieChart>
                    <Pie
                      data={chartData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                    >
                      {chartData.map((entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                ) : chartType === 'line' ? (
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                ) : (
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="value" fill="#2563eb" radius={[6, 6, 0, 0]} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>
        );
      }
    } catch (e) {
      // Not a JSON chart
    }

    if (!isChartRendered) {
      // Render as code snippet if not an active chart
      elements.push(
        <div key={`code-${keyIdx++}`} className="p-3 my-2 bg-neutral-900 text-neutral-100 font-mono text-xs rounded-xl overflow-x-auto whitespace-pre">
          {match[1].trim()}
        </div>
      );
    }

    lastIndex = chartRegex.lastIndex;
  }

  const remainingText = content.substring(lastIndex);
  if (remainingText.trim()) {
    elements.push(
      <div key={`md-${keyIdx++}`} className="prose prose-sm max-w-none prose-headings:text-neutral-950 prose-p:text-neutral-900 prose-li:text-neutral-900 prose-headings:font-bold prose-p:my-1.5 prose-table:border-collapse prose-table:w-full">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{remainingText}</ReactMarkdown>
      </div>
    );
  }

  return elements.length > 0 ? elements : (
    <div className="prose prose-sm max-w-none prose-headings:text-neutral-950 prose-p:text-neutral-900 prose-li:text-neutral-900 prose-headings:font-bold prose-p:my-1.5 prose-table:border-collapse prose-table:w-full">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{content}</ReactMarkdown>
    </div>
  );
}

interface AITutorDashboardProps {
  user?: User | null;
  initialTarget?: { 
    topic?: string; 
    module?: string; 
    prompt?: string;
    sessionId?: string;
    reason?: string;
    objective?: string;
    dayId?: string;
    date?: string;
  } | null;
  onClearTarget?: () => void;
}

import { buildAcademicContext, ContextOptions, formatContextForGemini } from '../lib/academicContext';
import { addOrUpdateStudySession, updateSessionStatus } from '../lib/plannerFirestore';
import { updateAssessmentDueDate, autoUpdatePastDueAssessments, createAssessment } from '../lib/assessmentFirestore';
import { AcademicDataPayload, AcademicAction, UploadedFileItem } from '../lib/academicBrain';
import { normalizeToCATDateString } from '../lib/catTime';
import { ensureDayExists, addClassSlotAcrossAllWeeks, moveClassSlotAcrossAllWeeks } from '../lib/semesterFirestore';
import { syncSOMAEntityToGoogle, syncAllPendingSOMAEntitiesToGoogle } from '../lib/calendarSync';
import { getAccessToken, googleSignIn } from '../lib/auth';
import { deleteGoogleCalendarEvent } from '../lib/calendarApi';
import { BookOpen } from 'lucide-react';

export function AITutorDashboard({ user, initialTarget, onClearTarget }: AITutorDashboardProps) {
  const {
    activeSemester: selectedSem,
    modules,
    topics,
    assessments,
    topicMastery: allTopics,
    academicRisk: riskList,
    days: allDays,
    activities: allActivities,
    lectures: allLectures,
    weeks,
    loading: somaLoading,
    syncStatus
  } = useSOMA();

  const currentCat = getCATDateComponents();
  const defaultDayId = initialTarget?.dayId || `day_${currentCat.dateString}`;
  const defaultDate = initialTarget?.date || currentCat.dateString;

  const [selectedDayId, setSelectedDayId] = useState<string>(defaultDayId);
  const [selectedDate, setSelectedDate] = useState<string>(defaultDate);

  // Authoritative day, timetable, and study sessions resolution
  const todayDay = allDays.find(d => normalizeToCATDateString(d.date) === currentCat.dateString);
  const activeDayRecord = allDays.find(d => d.id === selectedDayId) || todayDay;
  const todayActivities = allActivities.filter(a => a.dayId === (activeDayRecord?.id || selectedDayId));
  const todayClasses = todayActivities.filter(a => a.type === 'class');
  const todaySessions = todayActivities.filter(a => a.type === 'study_session');

  const currentTimeStr = `${String(currentCat.hours).padStart(2, '0')}:${String(currentCat.minutes).padStart(2, '0')}`;
  const nextSession = todaySessions.find(s => (s.endTime || '23:00') > currentTimeStr && s.status !== 'Completed');
  const upcomingAssessments = assessments
    .filter(a => a.status !== 'Completed' && a.status !== 'Ended')
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));

  useEffect(() => {
    if (initialTarget?.dayId) {
      setSelectedDayId(initialTarget.dayId);
      if (initialTarget.date) setSelectedDate(initialTarget.date);
    }
  }, [initialTarget]);

  useEffect(() => {
    if (assessments.length > 0) {
      autoUpdatePastDueAssessments(assessments);
    }
  }, [assessments]);

  const [catTime, setCatTime] = useState<CATDateComponents>(getCATDateComponents());
  const [conversationId, setConversationId] = useState<string>('');
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [input, setInput] = useState('');
  const [imageAttachments, setImageAttachments] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);
  const [calendarConnected, setCalendarConnected] = useState(() => !!getAccessToken());
  const [syncingCalendar, setSyncingCalendar] = useState(false);

  const handleConnectCalendar = async () => {
    setSyncingCalendar(true);
    try {
      const res = await googleSignIn();
      if (res) {
        setCalendarConnected(true);
        const targetUid = res?.user?.uid || user?.uid || auth.currentUser?.uid || 'current_user';
        const count = await syncAllPendingSOMAEntitiesToGoogle(targetUid);
        setFeedbackNotice(`✓ Connected Google Calendar! Synced ${count} scheduled event(s) and CATs directly to your Google Calendar.`);
        setTimeout(() => setFeedbackNotice(null), 8000);
      }
    } catch (e: any) {
      console.error('Error connecting Google Calendar:', e);
      setFeedbackNotice(`⚠️ Could not connect Google Calendar: ${e?.message || 'Access cancelled'}`);
      setTimeout(() => setFeedbackNotice(null), 6000);
    } finally {
      setSyncingCalendar(false);
    }
  };

  const chatBottomRef = useRef<HTMLDivElement>(null);
  const initialGreetingRef = useRef(false);
  const isSendingRef = useRef(false);

  // Live CAT tick
  useEffect(() => {
    const timer = setInterval(() => {
      setCatTime(getCATDateComponents());
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let unsubscribe: () => void;
    if (selectedSem && user) {
      initTutorSession(selectedDayId, selectedDate).then(unsub => {
        if (unsub) unsubscribe = unsub;
      });
    }
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [user, selectedSem, selectedDayId, selectedDate]);

  const initTutorSession = async (dayIdToUse: string, dateToUse: string) => {
    if (!selectedSem || !user) return;
    setInitializing(true);
    initialGreetingRef.current = false;

    try {
      const currentUid = user.uid;
      const currentCat = getCATDateComponents();
      
      const conv = await getOrCreateDayConversation(selectedSem.id, dayIdToUse, dateToUse, currentUid);
      setConversationId(conv.id);

      // Proactively purge any legacy fallback error messages from this conversation
      purgeLegacyErrorMessages(conv.id).catch(err => console.warn('Purge error:', err));

      // Real-time messages listener
      const msgsRef = collection(db, 'tutorMessages');
      const q = query(msgsRef, where('conversationId', '==', conv.id));
      
      const unsubscribe = onSnapshot(q, async (snapshot) => {
        // Asynchronously delete any error messages found in snapshot
        snapshot.docs.forEach(docSnap => {
          const data = docSnap.data();
          if (isTutorErrorMessage(data.content || '')) {
            deleteDoc(docSnap.ref).catch(() => {});
          }
        });

        const msgs = snapshot.docs
          .map(d => ({ id: d.id, ...d.data() } as TutorMessage))
          .filter(m => !isTutorErrorMessage(m.content))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        setMessages(msgs);
        
        if (msgs.length === 0 && !initialGreetingRef.current) {
          initialGreetingRef.current = true;
          const studentName = user.displayName?.split(' ')[0] || 'Student';
          const greetingData = getCATGreeting(studentName, currentCat);
          
          // Initial greeting
          await saveTutorMessage({
            conversationId: conv.id,
            userId: currentUid,
            role: 'assistant',
            content: `${greetingData.greeting}! I am SOMA AI, your Academic Mentor & Intelligence Partner. How can I help you master your curriculum for this day?`
          });
        }
      });

      // Handle Initial Target
      if (initialTarget && initialTarget.prompt) {
        setTimeout(() => {
          let customPrompt = initialTarget.prompt;
          handleSend(customPrompt, conv.id);
          onClearTarget?.();
        }, 500);
      }

      setInitializing(false);
      return unsubscribe;
    } catch (e) {
      console.error(e);
      setInitializing(false);
    }
  };

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    Array.from(files).forEach((file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        setImageAttachments(prev => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleSend = async (customPrompt?: string, activeConvId?: string) => {
    if (isSendingRef.current) return;
    const targetConvId = activeConvId || conversationId;
    const text = customPrompt || input;
    if (!text.trim() && imageAttachments.length === 0) return;
    if (!targetConvId) return;

    isSendingRef.current = true;
    setLoading(true);

    const currentUid = user?.uid || auth.currentUser?.uid || 'current_user';
    const userMsgContent = text.trim() || `[Multi-Page Practice Submission (${imageAttachments.length} pages)]`;
    
    // UI will update via onSnapshot
    await saveTutorMessage({
      conversationId: targetConvId,
      userId: currentUid,
      role: 'user',
      content: userMsgContent,
      attachmentUrl: imageAttachments[0] || undefined
    });

    if (!customPrompt) setInput('');
    const currentImgs = [...imageAttachments];
    setImageAttachments([]);

    try {
      // Build context
      const context = await buildAcademicContext({
        userId: user!.uid,
        semesterId: selectedSem!.id,
        scope: 'semester'
      });
      const contextPrompt = formatContextForGemini(context);

      const modMap = new Map((modules || []).map(m => [m.id, m.name]));
      const fileInventory: UploadedFileItem[] = [];

      // 1. Topic Files
      (topics || []).forEach(t => {
        if (t.fileName || t.fileUrl) {
          fileInventory.push({
            id: t.id,
            fileName: t.fileName || `${t.name} Document`,
            moduleName: modMap.get(t.moduleId) || 'Curriculum',
            category: 'Topic File',
            parentName: t.name,
            fileSize: t.fileSize,
            mimeType: t.mimeType,
            hasContent: !!(t.extractedText && t.extractedText.trim()),
            textSnippet: t.extractedText ? t.extractedText.slice(0, 300) : undefined
          });
        }
      });

      // 2. Assessment Files (including completed ones!)
      (assessments || []).forEach(a => {
        if (a.fileName || a.fileUrl) {
          fileInventory.push({
            id: a.id,
            fileName: a.fileName || `${a.title} Document`,
            moduleName: a.moduleName || modMap.get(a.moduleId) || 'Curriculum',
            category: 'Assessment File',
            parentName: a.title,
            status: a.status,
            fileSize: a.fileSize,
            mimeType: a.mimeType,
            hasContent: !!(a.extractedText && a.extractedText.trim()),
            textSnippet: a.extractedText ? a.extractedText.slice(0, 300) : undefined
          });
        }
      });

      // 3. Lecture Files
      (allLectures || []).forEach(l => {
        if (l.fileName || l.fileUrl || l.title) {
          fileInventory.push({
            id: l.id,
            fileName: l.fileName || l.title,
            moduleName: modMap.get(l.moduleId) || 'Curriculum',
            category: 'Lecture File',
            parentName: l.title,
            fileSize: l.fileSize,
            mimeType: l.mimeType,
            hasContent: !!(l.extractedText && l.extractedText.trim()),
            textSnippet: l.extractedText ? l.extractedText.slice(0, 300) : undefined
          });
        }
      });

      // Master Timetable weekly schedule across all days and weeks
      const classActivities = (allActivities || []).filter(a => a.type === 'class');
      const weeklySchedule = classActivities.map(a => {
        const dRec = (allDays || []).find(d => d.id === a.dayId);
        const wRec = (weeks || []).find(w => w.id === dRec?.weekId);
        return {
          id: a.id,
          module: a.moduleName || a.title,
          title: a.title,
          dayOfWeek: dRec?.dayOfWeek || 'Tuesday',
          startTime: a.startTime,
          endTime: a.endTime,
          weekNumber: wRec?.weekNumber || 1
        };
      });

      const academicData: AcademicDataPayload = {
        date: currentCat.dateString,
        time: currentCat.shortTimeString,
        dayOfWeek: currentCat.dayOfWeek,
        semesterId: selectedSem?.id,
        userId: currentUid,
        dayId: activeDayRecord?.id || selectedDayId,
        classes: todayClasses.map(c => ({ title: c.title, module: c.moduleName, startTime: c.startTime, endTime: c.endTime, room: c.description })),
        sessions: todaySessions.map(s => ({ id: s.id, title: s.title, module: s.moduleName, topic: s.topicName, startTime: s.startTime, endTime: s.endTime, status: s.status, priority: s.priority, taskType: s.taskType })),
        modules: modules.map(m => ({ id: m.id, name: m.name, code: m.code, credits: m.credits })),
        assessments: upcomingAssessments.map(a => ({ id: a.id, title: a.title, moduleName: a.moduleName, dueDate: a.dueDate, type: a.type, status: a.status })),
        allAssessments: assessments.map(a => ({
          id: a.id,
          title: a.title,
          moduleName: a.moduleName || modMap.get(a.moduleId),
          dueDate: a.dueDate,
          type: a.type,
          status: a.status,
          hasFile: !!(a.fileName || a.fileUrl),
          fileName: a.fileName
        })),
        topics: (topics || []).map(t => ({
          id: t.id,
          moduleId: t.moduleId,
          name: t.name,
          fileName: t.fileName,
          masteryScore: t.masteryScore
        })),
        nextSession: nextSession ? { id: nextSession.id, title: nextSession.title, module: nextSession.moduleName, topic: nextSession.topicName, startTime: nextSession.startTime, endTime: nextSession.endTime } : null,
        uploadedMaterials: allLectures.map(l => ({ title: l.title, module: l.moduleId, uploadedAt: l.uploadedAt || l.createdAt })),
        uploadedFiles: fileInventory,
        masteryScores: allTopics.reduce((acc, t) => ({ ...acc, [t.name]: t.masteryScore || 0 }), {}),
        riskLevel: riskLevel,
        weeklySchedule,
        weeksCount: weeks.length || 18
      } as any;

      const res = await fetch('/api/tutor-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsgContent,
          images: currentImgs,
          context: contextPrompt,
          academicData,
          history: messages.map(m => ({ role: m.role, content: m.content }))
        })
      });

      if (res.ok) {
        const data = await res.json();
        
        // Rule 5: If SOMA Intelligence scheduled a CAT (Continuous Assessment Test)
        if ((data.action?.type === 'SCHEDULE_CAT' || (data.action?.type === 'SCHEDULE_ASSESSMENT' && data.action?.assessmentType === 'cat')) && selectedSem) {
          try {
            let targetDateStr = data.action.date || selectedDate || currentCat.dateString;
            let targetDayId = activeDayRecord?.id || selectedDayId;

            if (data.action.date) {
              const matchingDay = allDays.find(d => normalizeToCATDateString(d.date) === data.action.date);
              if (matchingDay) {
                targetDayId = matchingDay.id;
                targetDateStr = normalizeToCATDateString(matchingDay.date);
              } else {
                targetDayId = await ensureDayExists(selectedSem.id, currentUid, targetDateStr);
              }
            } else if (!targetDayId) {
              targetDayId = await ensureDayExists(selectedSem.id, currentUid, targetDateStr);
            }

            const modName = data.action.moduleName || 'Structural Geology';
            const targetMod = modules.find(m => m.name.toLowerCase().includes(modName.toLowerCase())) || modules[0] || { id: 'mod_geo', name: modName };
            const catTitle = data.action.title || `${targetMod.name} CAT 1 (Continuous Assessment Test)`;
            const startTime = data.action.startTime || '09:00';
            const endTime = data.action.endTime || '10:30';

            // Check if assessment already exists for this module on this date to prevent duplicate creation
            let createdAsmId = '';
            const existingAsm = assessments.find(a => 
              (a.dueDate && a.dueDate.split('T')[0] === targetDateStr) &&
              (a.moduleId === targetMod.id || a.title.toLowerCase().includes(targetMod.name.toLowerCase()) || targetMod.name.toLowerCase().includes((a.moduleName || '').toLowerCase()))
            );

            if (existingAsm) {
              createdAsmId = existingAsm.id;
              await updateAssessmentDueDate(existingAsm.id, targetDateStr);
            } else {
              createdAsmId = await createAssessment(currentUid, {
                semesterId: selectedSem.id,
                moduleId: targetMod.id,
                moduleName: targetMod.name,
                title: catTitle,
                type: 'cat',
                dueDate: targetDateStr,
                durationMinutes: data.action.durationMinutes || 90,
                maxScore: data.action.maxScore || 100,
                notes: `Official Continuous Assessment Test (CAT) scheduled by SOMA Intelligence for ${targetDateStr} (${startTime}–${endTime} CAT).`
              });
            }

            // Check if activity already exists on target day to avoid duplicates
            const existingAct = allActivities.find(a => 
              a.dayId === targetDayId && 
              (a.assessmentId === createdAsmId || (a.title && a.title.toLowerCase().includes(targetMod.name.toLowerCase()) && a.type === 'cat'))
            );

            const actId = existingAct ? existingAct.id : `act_cat_${Date.now()}`;
            await setDoc(doc(db, 'activities', actId), {
              id: actId,
              dayId: targetDayId,
              userId: currentUid,
              semesterId: selectedSem.id,
              moduleId: targetMod.id,
              moduleName: targetMod.name,
              title: catTitle,
              type: 'cat',
              taskType: 'Exam Preparation',
              startTime,
              endTime,
              priority: 'Critical',
              source: 'intelligence_engine',
              status: 'Upcoming',
              date: targetDateStr,
              assessmentId: createdAsmId
            }, { merge: true });

            // 3. Push to Google Calendar API Bridge with RFC3339 CAT timestamp (single canonical event, no duplicates)
            try {
              const calRes = await syncSOMAEntityToGoogle(currentUid, createdAsmId, 'assessment', {
                title: `SOMA CAT: ${targetMod.name} (Continuous Assessment Test)`,
                start: `${targetDateStr}T${startTime}:00+02:00`,
                end: `${targetDateStr}T${endTime}:00+02:00`,
                description: `Official Continuous Assessment Test (CAT) for ${targetMod.name}.\nDate: ${targetDateStr}\nTime: ${startTime} – ${endTime} CAT.\nPriority: Critical Examination Milestone.\nManaged by SOMA Intelligence.`
              });
              if (calRes?.success) {
                setFeedbackNotice(`✓ Continuous Assessment Test (CAT) Committed & Synced to Google Calendar for ${targetDateStr}: ${targetMod.name} (${startTime}–${endTime} CAT)`);
              } else {
                setFeedbackNotice(`✓ CAT Committed to Timetable & Database for ${targetDateStr}: ${targetMod.name}. (Google Calendar offline — click 'Connect Google Calendar' above to sync)`);
              }
            } catch (calErr) {
              console.warn('Google Calendar sync notice:', calErr);
              setFeedbackNotice(`✓ Continuous Assessment Test (CAT) Committed to Timetable & Assessments for ${targetDateStr}: ${targetMod.name}`);
            }
            setTimeout(() => setFeedbackNotice(null), 8000);
          } catch (actErr) {
            console.error('Error committing CAT to Firestore:', actErr);
          }
        }

        // Rule 6: If SOMA Intelligence scheduled a Class session or Added a Module across all weeks
        if ((data.action?.type === 'ADD_CLASS_ALL_WEEKS' || data.action?.type === 'SCHEDULE_CLASS') && selectedSem) {
          try {
            const modName = data.action.moduleName || 'Structural Geology';
            const startTime = data.action.startTime || '13:00';
            const endTime = data.action.endTime || '17:00';
            const dayName = data.action.day || 'Tuesday';
            const startW = data.action.startWeek || 1;
            const endW = data.action.endWeek || (weeks.length > 0 ? weeks.length : 18);

            await addClassSlotAcrossAllWeeks({
              moduleName: modName,
              dayOfWeek: dayName,
              startTime,
              endTime,
              allDays,
              weeks,
              startWeek: startW,
              endWeek: endW,
              semesterId: selectedSem.id,
              userId: currentUid
            });

            setFeedbackNotice(`✓ Class ${modName} added to Timetable for ${dayName}s (${startTime}–${endTime} CAT) across Weeks ${startW} to ${endW}!`);
            setTimeout(() => setFeedbackNotice(null), 8000);
          } catch (actErr) {
            console.error('Error committing class timetable across weeks:', actErr);
          }
        }

        // Rule 6b: If SOMA Intelligence moved a module across all weeks
        if (data.action?.type === 'MOVE_CLASS_ALL_WEEKS' && selectedSem) {
          try {
            const modName = data.action.moduleName || 'Geological Survey';
            const sourceDay = data.action.sourceDay || 'Monday';
            const targetDay = data.action.targetDay || 'Thursday';
            const startTime = data.action.startTime || '13:00';
            const endTime = data.action.endTime || '17:00';

            const dummyAct: any = {
              id: 'move_request',
              title: modName,
              moduleName: modName,
              userId: currentUid,
              semesterId: selectedSem.id,
              type: 'class'
            };

            await moveClassSlotAcrossAllWeeks({
              activity: dummyAct,
              sourceDayOfWeek: sourceDay,
              targetDayOfWeek: targetDay,
              startTime,
              endTime,
              allDays,
              weeks
            });

            setFeedbackNotice(`✓ Moved ${modName} from ${sourceDay} to ${targetDay} (${startTime}–${endTime} CAT) across all weeks!`);
            setTimeout(() => setFeedbackNotice(null), 8000);
          } catch (actErr) {
            console.error('Error committing moveClassSlotAcrossAllWeeks:', actErr);
          }
        }

        // Rule 7: If SOMA Intelligence scheduled an Exam, Quiz, or Assignment
        if ((data.action?.type === 'SCHEDULE_EXAM' || data.action?.type === 'SCHEDULE_QUIZ' || data.action?.type === 'SCHEDULE_ASSIGNMENT') && selectedSem) {
          try {
            const asmType = data.action.type === 'SCHEDULE_EXAM' ? 'exam' : (data.action.type === 'SCHEDULE_QUIZ' ? 'quiz' : 'assignment');
            let targetDateStr = data.action.date || data.action.newDueDate || selectedDate || currentCat.dateString;
            let targetDayId = activeDayRecord?.id || selectedDayId;
            if (data.action.date) {
              const matchingDay = allDays.find(d => normalizeToCATDateString(d.date) === data.action.date);
              targetDayId = matchingDay ? matchingDay.id : await ensureDayExists(selectedSem.id, currentUid, targetDateStr);
            } else if (!targetDayId) {
              targetDayId = await ensureDayExists(selectedSem.id, currentUid, targetDateStr);
            }
            const modName = data.action.moduleName || 'Structural Geology';
            const targetMod = modules.find(m => m.name.toLowerCase().includes(modName.toLowerCase())) || modules[0] || { id: 'mod_geo', name: modName };
            const title = data.action.title || `${targetMod.name} ${asmType.toUpperCase()}`;
            const startTime = data.action.startTime || '09:00';
            const endTime = data.action.endTime || '10:30';

            const createdAsmId = await createAssessment(currentUid, {
              semesterId: selectedSem.id,
              moduleId: targetMod.id,
              moduleName: targetMod.name,
              title,
              type: asmType,
              dueDate: targetDateStr,
              durationMinutes: data.action.durationMinutes || (asmType === 'exam' ? 120 : 45),
              maxScore: data.action.maxScore || 100,
              notes: `Scheduled by SOMA Intelligence.`
            });

            const actId = `act_${asmType}_${Date.now()}`;
            await setDoc(doc(db, 'activities', actId), {
              id: actId,
              dayId: targetDayId,
              userId: currentUid,
              semesterId: selectedSem.id,
              moduleId: targetMod.id,
              moduleName: targetMod.name,
              title,
              type: asmType,
              taskType: asmType === 'assignment' ? 'Assignment' : 'Exam Preparation',
              startTime,
              endTime,
              priority: asmType === 'exam' ? 'Critical' : 'High',
              source: 'intelligence_engine',
              status: 'Upcoming',
              date: targetDateStr,
              assessmentId: createdAsmId
            });

            try {
              await syncSOMAEntityToGoogle(currentUid, createdAsmId, 'assessment', {
                title: `SOMA ${asmType.toUpperCase()}: ${targetMod.name}`,
                start: `${targetDateStr}T${startTime}:00+02:00`,
                end: `${targetDateStr}T${endTime}:00+02:00`,
                description: `${title} scheduled by SOMA Intelligence.`
              });
            } catch (calErr) {}

            setFeedbackNotice(`✓ ${asmType.toUpperCase()} Scheduled & Synced for ${targetDateStr}: ${targetMod.name}`);
            setTimeout(() => setFeedbackNotice(null), 6000);
          } catch (actErr) {
            console.error('Error committing assessment to Firestore:', actErr);
          }
        }

        // Rule 8: If SOMA Intelligence scheduled a study session, persist directly to Firestore activities & sync to Google Calendar
        if (data.action?.type === 'SCHEDULE_STUDY' && selectedSem) {
          try {
            let targetDateStr = data.action.date || selectedDate || currentCat.dateString;
            let targetDayId = activeDayRecord?.id || selectedDayId;

            if (data.action.date) {
              const matchingDay = allDays.find(d => normalizeToCATDateString(d.date) === data.action.date);
              if (matchingDay) {
                targetDayId = matchingDay.id;
                targetDateStr = normalizeToCATDateString(matchingDay.date);
              } else {
                targetDayId = await ensureDayExists(selectedSem.id, currentUid, targetDateStr);
              }
            } else if (!targetDayId) {
              targetDayId = await ensureDayExists(selectedSem.id, currentUid, targetDateStr);
            }

            const startTime = data.action.startTime || '09:00';
            const endTime = data.action.endTime || '10:30';

            const createdActivity = await addOrUpdateStudySession(currentUid, selectedSem.id, targetDayId, {
              moduleName: data.action.moduleName,
              topicName: data.action.topicName,
              startTime,
              endTime,
              priority: 'High',
              taskType: 'Active Recall',
              date: targetDateStr
            });

            setFeedbackNotice(`✓ Study Session Scheduled for ${targetDateStr}: ${data.action.moduleName} (${startTime}–${endTime} CAT)`);
            setTimeout(() => setFeedbackNotice(null), 6000);
          } catch (actErr) {
            console.error('Error committing study session to Firestore:', actErr);
          }
        }

        // Rule 9: If SOMA Intelligence updated an assessment, update Firestore assessments & sync to Google Calendar
        if (data.action?.type === 'UPDATE_ASSESSMENT') {
          try {
            const targetAsm = assessments.find(a => 
              (data.action.assessmentId && a.id === data.action.assessmentId) ||
              a.title.toLowerCase().includes(data.action.assessmentTitle.toLowerCase())
            );
            if (targetAsm) {
              await updateAssessmentDueDate(targetAsm.id, data.action.newDueDate);
              try {
                await syncSOMAEntityToGoogle(currentUid, targetAsm.id, 'assessment', {
                  title: `SOMA Milestone: ${targetAsm.title}`,
                  start: `${data.action.newDueDate}T09:00:00+02:00`,
                  end: `${data.action.newDueDate}T10:00:00+02:00`,
                  description: `Milestone: ${targetAsm.title} | Due: ${data.action.newDueDate}`
                });
              } catch (calErr) {}
              setFeedbackNotice(`✓ Assessment Deadline Updated & Synced: ${targetAsm.title} due ${data.action.newDueDate}`);
              setTimeout(() => setFeedbackNotice(null), 6000);
            }
          } catch (actErr) {
            console.error('Error updating assessment in Firestore:', actErr);
          }
        }

        if ((data.action?.type === 'DELETE_EVENT' || data.action?.type === 'DELETE_ASSESSMENT') && selectedSem) {
          try {
            const queryTitle = (data.action.assessmentTitle || data.action.moduleName || '').toLowerCase();
            const targetDate = data.action.date || data.action.newDueDate;
            const targetType = data.action.targetType || 'all';

            // 1. Delete matching assessments
            const asmSnap = await getDocs(collection(db, 'assessments'));
            for (const docSnap of asmSnap.docs) {
              const aData = docSnap.data();
              const aTitle = (aData.title || '').toLowerCase();
              const aMod = (aData.moduleName || '').toLowerCase();
              const aDueDate = (aData.dueDate || '').split('T')[0];

              const matchMod = !queryTitle || aTitle.includes(queryTitle) || aMod.includes(queryTitle) || queryTitle.includes(aTitle) || queryTitle.includes(aMod) || aTitle.includes('geology') || aMod.includes('geology');
              const matchDate = !targetDate || aDueDate === targetDate;
              const matchType = targetType === 'all' || targetType === aData.type || (targetType === 'cat' && (aData.type === 'cat' || aTitle.includes('cat')));

              if (matchMod && (matchDate || aTitle.includes('cat') || targetType === 'cat')) {
                await deleteAssessmentWithCascade(docSnap.id);
              }
            }

            // 2. Delete matching activities
            const actSnap = await getDocs(collection(db, 'activities'));
            for (const docSnap of actSnap.docs) {
              const actData = docSnap.data();
              const actTitle = (actData.title || '').toLowerCase();
              const actMod = (actData.moduleName || '').toLowerCase();
              const actDate = (actData.date || '').split('T')[0];

              const matchMod = !queryTitle || actTitle.includes(queryTitle) || actMod.includes(queryTitle) || queryTitle.includes(actTitle) || queryTitle.includes(actMod) || actTitle.includes('geology') || actMod.includes('geology');
              const matchDate = !targetDate || actDate === targetDate;
              const matchType = targetType === 'all' || actData.type === targetType || 
                (targetType === 'cat' && (actData.type === 'cat' || actTitle.includes('cat'))) ||
                (targetType === 'study_session' && actData.type === 'study_session');

              if (matchMod && (matchDate || targetType === 'study_session' || targetType === 'all' || actTitle.includes('cat') || actData.type === 'cat')) {
                await deleteActivityWithCascade(docSnap.id, actData as any);
              }
            }

            // 3. Clear from timetable collection if module matches
            try {
              const ttSnap = await getDocs(collection(db, 'timetable'));
              for (const docSnap of ttSnap.docs) {
                const ttData = docSnap.data();
                const ttMod = (ttData.moduleName || ttData.activityName || '').toLowerCase();
                if (queryTitle && (ttMod.includes(queryTitle) || queryTitle.includes(ttMod))) {
                  await deleteDoc(docSnap.ref);
                }
              }
            } catch (_) {}

            setFeedbackNotice(`✓ Event / Assessment successfully deleted and purged from calendar & timetable`);
            setTimeout(() => setFeedbackNotice(null), 6000);
          } catch (err) {
            console.error('Error deleting assessment/activity:', err);
          }
        }

        // If SOMA AI produced a structured diagnostic grading block, log to Firestore
        if (data.gradingResult && selectedSem) {
          const g = data.gradingResult;
          const matchedModule = modules.find(m => m.name.toLowerCase().includes((g.moduleName || '').toLowerCase())) || modules[0];
          
          await addTopicEvidence({
            userId: currentUid,
            semesterId: selectedSem.id,
            moduleId: matchedModule?.id || 'mod_general',
            moduleName: matchedModule?.name || g.moduleName || 'Curriculum',
            topicId: 'top_' + (g.topicName || 'diagnostic').toLowerCase().replace(/\s+/g, '_'),
            topicName: g.topicName || 'AI Diagnostic Assessment',
            sourceType: currentImgs.length > 0 ? 'handwritten_grading' : 'exercise',
            sourceTitle: 'SOMA AI Diagnostic Evaluation',
            score: g.score,
            normalizedScore: Math.round(g.score * 10),
            mistakes: g.mistakes || [],
            date: catTime.dateString
          });
        }

        await saveTutorMessage({
          conversationId: targetConvId,
          userId: currentUid,
          role: 'assistant',
          content: data.reply || 'Here is your academic guidance.',
          score: data.gradingResult?.score,
          action: data.action || undefined
        });
      } else {
        await saveTutorMessage({
          conversationId: targetConvId,
          userId: currentUid,
          role: 'assistant',
          content: 'I am currently reviewing your syllabus and lecture notes. Please try your query again.'
        });
      }
    } catch (err) {
      await saveTutorMessage({
        conversationId: targetConvId,
        userId: currentUid,
        role: 'assistant',
        content: 'I am actively reviewing your timetable and academic plan. How can I assist you with your studies?'
      });
    } finally {
      setLoading(false);
      isSendingRef.current = false;
    }
  };

  const handleStartSession = async (sessionActivity: { id?: string; title?: string; module?: string; topic?: string; startTime?: string }) => {
    if (sessionActivity.id && activeDayRecord) {
      await updateSessionStatus(sessionActivity.id, 'In Progress', activeDayRecord.id);
    }
    const name = sessionActivity.topic || sessionActivity.module || sessionActivity.title || 'study session';
    setFeedbackNotice(`🚀 Started session: ${name}. SOMA is preparing your active recall drill!`);
    setTimeout(() => setFeedbackNotice(null), 5000);
    handleSend(`I am starting my scheduled session on ${name}. Please guide me through the core concepts and test my mastery with active recall questions.`);
  };

  const riskLevel = riskList.some(r => r.riskLevel === 'CRITICAL') ? 'CRITICAL' : 
                   riskList.some(r => r.riskLevel === 'HIGH') ? 'HIGH' : 'MEDIUM';

  const quickChips = [
    "What is on my plan today?",
    "Please ask SOMA Intelligence to schedule Structure Geology study today at 20:30",
    "The Soil Mechanics assignment deadline moved to 15 October 2026; please update it",
    allTopics.filter(t => (t.masteryScore || 0) < 60).length > 0 
      ? `Quiz me on ${allTopics.filter(t => (t.masteryScore || 0) < 60)[0].name}` 
      : "Quiz me on my weakest topic",
    "Prepare me for my next CAT",
    "Review my recurring mistake patterns"
  ];

  const formatDayDate = (d: any) => {
    if (!d || !d.date) return '';
    if (d.date instanceof Date) {
      return d.date.toISOString().split('T')[0];
    }
    return String(d.date).split('T')[0];
  };

  const sortedDays = [...allDays].sort((a, b) => {
    const da = a.date instanceof Date ? a.date.getTime() : new Date(a.date).getTime();
    const db = b.date instanceof Date ? b.date.getTime() : new Date(b.date).getTime();
    return da - db;
  });

  const isTodayActive = selectedDate === currentCat.dateString;
  const activeDayObject = allDays.find(d => d.id === selectedDayId || formatDayDate(d) === selectedDate);
  const activeDayDisplay = activeDayObject 
    ? `${activeDayObject.dayOfWeek}, ${selectedDate}` 
    : `Academic Day (${selectedDate})`;

  const handleClearDayChat = async () => {
    if (!conversationId) return;
    setClearing(true);
    try {
      await clearDayConversationMessages(conversationId);
      setMessages([]);
      setShowClearModal(false);

      const currentUid = user?.uid || auth.currentUser?.uid || 'current_user';
      const studentName = user?.displayName?.split(' ')[0] || 'Student';
      const greetingData = getCATGreeting(studentName, currentCat);

      await saveTutorMessage({
        conversationId,
        userId: currentUid,
        role: 'assistant',
        content: `🧹 **Chat History Cleared for ${selectedDate}**. How can I help you master your curriculum today?`
      });

      setFeedbackNotice(`Chat history for ${selectedDate} has been cleared.`);
      setTimeout(() => setFeedbackNotice(null), 4000);
    } catch (err) {
      console.error('Failed to clear chat:', err);
      setFeedbackNotice('Failed to clear chat history. Please try again.');
      setTimeout(() => setFeedbackNotice(null), 4000);
    } finally {
      setClearing(false);
    }
  };

  if (somaLoading || initializing) {
    return <div className="p-12 text-center text-neutral-500 font-medium">Initializing SOMA AI Mentor & Academic Intelligence...</div>;
  }

  return (
    <div className="flex flex-col h-[calc(100vh-20px)] sm:h-[calc(100vh-24px)] max-w-5xl sm:max-w-6xl mx-auto px-3 sm:px-6 pb-2 sm:pb-4">
      {/* Responsive Header Bar */}
      <div className="flex items-center justify-between py-3 sm:py-3.5 px-4 sm:px-6 bg-white rounded-2xl border border-neutral-200/80 shadow-xs mb-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-purple-600 text-white flex items-center justify-center font-bold text-sm shadow-sm shrink-0">✨</div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xs sm:text-sm font-bold text-neutral-900">SOMA AI Mentor</h1>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase hidden sm:inline-block ${
                riskLevel === 'CRITICAL' ? 'bg-red-100 text-red-700' :
                riskLevel === 'HIGH' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'
              }`}>
                Risk: {riskLevel}
              </span>
            </div>
            <p className="text-[10px] sm:text-[11px] text-neutral-500">Synced with {selectedSem?.name || 'Semester 1'} • Active: {activeDayDisplay}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {sortedDays.length > 0 && (
            <select
              value={selectedDayId}
              onChange={(e) => {
                const chosenDay = sortedDays.find(d => d.id === e.target.value);
                if (chosenDay) {
                  setSelectedDayId(chosenDay.id);
                  setSelectedDate(formatDayDate(chosenDay));
                }
              }}
              className="text-xs bg-white border text-neutral-700 rounded-lg px-2 py-1 font-medium shadow-2xs"
            >
              {sortedDays.map((d) => (
                <option key={d.id} value={d.id}>{d.dayOfWeek} ({formatDayDate(d)})</option>
              ))}
            </select>
          )}

          <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase sm:hidden ${
            riskLevel === 'CRITICAL' ? 'bg-red-100 text-red-700' :
            riskLevel === 'HIGH' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'
          }`}>
            {riskLevel}
          </span>

          <button
            type="button"
            onClick={() => setShowClearModal(true)}
            disabled={messages.length === 0 || clearing}
            className="text-xs font-semibold text-neutral-700 hover:text-red-600 px-3 py-1 rounded-lg border bg-white shadow-2xs transition-colors disabled:opacity-40"
          >
            Clean Chat
          </button>
        </div>
      </div>

      {/* Chat Conversation Window - Gemini Style */}
      <div className="bg-white rounded-2xl border shadow-sm overflow-hidden flex flex-col flex-grow">

        {/* Feedback Notice Banner */}
        {feedbackNotice && (
          <div className="mx-4 mt-2 p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-center justify-between shrink-0">
            <span>{feedbackNotice}</span>
            <button type="button" onClick={() => setFeedbackNotice(null)} className="text-emerald-700 font-bold ml-2">✕</button>
          </div>
        )}

        {/* Chat Messages */}
        <div className="p-4 sm:p-6 flex-grow space-y-4 overflow-y-auto pr-2">
          {messages.length === 0 && !loading && (
            <div className="py-12 px-4 text-center space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto">
                <Sparkles className="w-6 h-6" />
              </div>
              <h4 className="font-bold text-neutral-800 text-sm">Clean Academic Session Ready</h4>
              <p className="text-xs text-neutral-500 max-w-sm mx-auto">
                No active chat messages for {activeDayDisplay}. Type a message below, pick a topic drill, or submit handwritten notes to get started!
              </p>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={`p-4 rounded-2xl text-sm leading-relaxed ${m.role === 'user' ? 'bg-blue-600 text-white ml-12' : 'bg-neutral-100 text-neutral-900 mr-12'}`}>
              <div className="flex justify-between items-center mb-1">
                <span className="font-bold text-xs opacity-75">{m.role === 'user' ? 'You' : 'SOMA AI Mentor'}</span>
                <span className="text-[10px] opacity-60">
                  {new Intl.DateTimeFormat('en-GB', {
                    timeZone: 'Africa/Maputo',
                    hour: '2-digit',
                    minute: '2-digit'
                  }).format(new Date(m.createdAt))} CAT
                </span>
              </div>
              <div className="mt-1 text-sm leading-relaxed text-neutral-900">
                {renderMessageWithChartsAndTables(m.content)}
              </div>

              {/* SOMA Action Cards */}
              {m.action?.type === 'SCHEDULE_CAT' && (
                <div className="mt-3 p-4 bg-red-50/95 border border-red-200/90 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-neutral-900 shadow-xs">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-red-800">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse"></span>
                      <span className="uppercase tracking-wider text-[11px] font-extrabold text-red-700">Official Continuous Assessment Test (CAT) Committed</span>
                    </div>
                    <div className="text-sm font-extrabold text-neutral-950">
                      {m.action.title || `${m.action.moduleName} CAT 1`}
                    </div>
                    <div className="text-xs text-neutral-600 flex items-center gap-2 flex-wrap">
                      <span className="flex items-center gap-1 font-semibold text-red-950 bg-red-100 px-2 py-0.5 rounded-md">
                        <Calendar className="w-3.5 h-3.5 text-red-700" />
                        <span>{m.action.date || selectedDate}</span>
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1 font-medium text-neutral-700">
                        <Clock className="w-3.5 h-3.5 text-neutral-400" />
                        <span>{m.action.startTime} – {m.action.endTime} CAT</span>
                      </span>
                      <span>•</span>
                      <span className="font-bold text-red-700">Critical Exam Priority</span>
                    </div>
                    <div className="text-[11px] text-red-700 font-semibold pt-0.5">
                      ✓ Saved to Assessments Collection • Active on Timetable • Synced to Google Calendar (Tomato Red Alert)
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <span className="px-3.5 py-2 bg-red-600 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1">
                      🔥 CAT Scheduled
                    </span>
                  </div>
                </div>
              )}

              {m.action?.type === 'SCHEDULE_CLASS' && (
                <div className="mt-3 p-3.5 bg-blue-50 border border-blue-200/90 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-neutral-900 shadow-xs">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-blue-800">
                      <span>🏛️</span>
                      <span>Timetable Class Lecture Committed</span>
                    </div>
                    <div className="text-sm font-bold text-neutral-900">
                      {m.action.title || `${m.action.moduleName} Lecture / Class Session`}
                    </div>
                    <div className="text-xs text-neutral-600 flex items-center gap-2">
                      <span className="flex items-center gap-1 font-medium text-blue-900">
                        <Calendar className="w-3.5 h-3.5 text-blue-600" />
                        <span>{m.action.date || selectedDate}</span>
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1 font-medium text-neutral-700">
                        <Clock className="w-3.5 h-3.5 text-neutral-400" />
                        <span>{m.action.startTime} – {m.action.endTime} CAT</span>
                      </span>
                    </div>
                    <div className="text-[11px] text-blue-700 font-medium">
                      ✓ Added to Master Timetable & Synced with Google Calendar (Orange Lecture Alert)
                    </div>
                  </div>
                </div>
              )}

              {m.action?.type === 'ADD_CLASS_ALL_WEEKS' && (
                <div className="mt-3 p-3.5 bg-blue-50 border border-blue-200/90 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-neutral-900 shadow-xs">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-blue-800">
                      <span>🏛️</span>
                      <span>Master Timetable: Class Added Across All Weeks</span>
                    </div>
                    <div className="text-sm font-bold text-neutral-900">
                      {m.action.moduleName} — Every {m.action.day || 'Tuesday'}
                    </div>
                    <div className="text-xs text-neutral-600 flex items-center gap-2">
                      <span className="flex items-center gap-1 font-medium text-neutral-700">
                        <Clock className="w-3.5 h-3.5 text-neutral-400" />
                        <span>{m.action.startTime} – {m.action.endTime} CAT</span>
                      </span>
                      <span>•</span>
                      <span className="text-blue-700 font-semibold">Weeks {m.action.startWeek || 1} to {m.action.endWeek || 18}</span>
                    </div>
                    <div className="text-[11px] text-blue-700 font-medium">
                      ✓ Committed to Master Timetable and synced to Google Calendar bridge
                    </div>
                  </div>
                </div>
              )}

              {m.action?.type === 'MOVE_CLASS_ALL_WEEKS' && (
                <div className="mt-3 p-3.5 bg-indigo-50 border border-indigo-200/90 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-neutral-900 shadow-xs">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-800">
                      <span>🔄</span>
                      <span>Master Timetable: Class Moved Across All Weeks</span>
                    </div>
                    <div className="text-sm font-bold text-neutral-900">
                      {m.action.moduleName}
                    </div>
                    <div className="text-xs text-neutral-600 flex items-center gap-2">
                      <span className="text-neutral-500 line-through">{m.action.sourceDay}</span>
                      <span>➔</span>
                      <span className="font-bold text-indigo-900">{m.action.targetDay} ({m.action.startTime} – {m.action.endTime} CAT)</span>
                      <span>•</span>
                      <span className="text-indigo-700 font-semibold">Weeks {m.action.startWeek || 1} to {m.action.endWeek || 18}</span>
                    </div>
                    <div className="text-[11px] text-indigo-700 font-medium">
                      ✓ Moved and reconciled across all semester weeks in Academic Timeline
                    </div>
                  </div>
                </div>
              )}

              {m.action?.type === 'DELETE_EVENT' && (
                <div className="mt-3 p-3.5 bg-neutral-100 border border-neutral-300 rounded-2xl flex items-center gap-3 text-neutral-900 shadow-xs">
                  <div className="w-8 h-8 rounded-xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </div>
                  <div className="space-y-0.5 text-xs">
                    <div className="font-bold text-neutral-900">
                      Event Cleared from System & Calendar
                    </div>
                    <div className="text-neutral-700 font-semibold">
                      {m.action.assessmentTitle || m.action.moduleName}
                    </div>
                    <div className="text-[11px] text-emerald-700 font-medium">
                      ✓ Removed from timetable milestones, daily planner, and Google Calendar
                    </div>
                  </div>
                </div>
              )}

              {m.action?.type === 'SCHEDULE_EXAM' && (
                <div className="mt-3 p-4 bg-purple-50/95 border border-purple-200/90 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-neutral-900 shadow-xs">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-purple-800">
                      <span>🎓</span>
                      <span className="uppercase tracking-wider text-[11px] font-extrabold text-purple-700">University Examination Scheduled</span>
                    </div>
                    <div className="text-sm font-extrabold text-neutral-950">
                      {m.action.title || `${m.action.moduleName} Examination`}
                    </div>
                    <div className="text-xs text-neutral-600 flex items-center gap-2">
                      <span className="font-semibold text-purple-950 bg-purple-100 px-2 py-0.5 rounded-md">
                        {m.action.date || selectedDate}
                      </span>
                      <span>•</span>
                      <span>{m.action.startTime} – {m.action.endTime} CAT</span>
                    </div>
                    <div className="text-[11px] text-purple-700 font-semibold">
                      ✓ Committed to Assessments, Timetable, and Google Calendar
                    </div>
                  </div>
                </div>
              )}

              {m.action?.type === 'SCHEDULE_QUIZ' && (
                <div className="mt-3 p-3.5 bg-indigo-50 border border-indigo-200/90 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-neutral-900 shadow-xs">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-800">
                      <span>📝</span>
                      <span>Diagnostic Quiz Milestone Scheduled</span>
                    </div>
                    <div className="text-sm font-bold text-neutral-900">
                      {m.action.title || `${m.action.moduleName} Quiz`}
                    </div>
                    <div className="text-xs text-neutral-600 flex items-center gap-2">
                      <span>{m.action.date || selectedDate}</span>
                      <span>•</span>
                      <span>{m.action.startTime} – {m.action.endTime} CAT</span>
                    </div>
                  </div>
                </div>
              )}

              {m.action?.type === 'SCHEDULE_ASSIGNMENT' && (
                <div className="mt-3 p-3.5 bg-amber-50 border border-amber-200/90 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-neutral-900 shadow-xs">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-amber-800">
                      <span>📋</span>
                      <span>Coursework Assignment Deadline Committed</span>
                    </div>
                    <div className="text-sm font-bold text-neutral-900">
                      {m.action.title || `${m.action.moduleName} Assignment`}
                    </div>
                    <div className="text-xs text-neutral-600 flex items-center gap-2">
                      <span>Due: {m.action.date || m.action.newDueDate || selectedDate}</span>
                    </div>
                  </div>
                </div>
              )}

              {m.action?.type === 'SCHEDULE_STUDY' && (
                <div className="mt-3 p-3.5 bg-emerald-50 border border-emerald-200/90 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-neutral-900 shadow-xs">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>SOMA Study Session Confirmed & Synced</span>
                    </div>
                    <div className="text-sm font-bold text-neutral-900">
                      {m.action.moduleName} {m.action.topicName ? `• ${m.action.topicName}` : ''}
                    </div>
                    <div className="text-xs text-neutral-600 flex items-center gap-2">
                      <span className="flex items-center gap-1 font-medium text-emerald-900">
                        <Calendar className="w-3.5 h-3.5 text-emerald-600" />
                        <span>{m.action.date || selectedDate}</span>
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1 font-medium text-neutral-700">
                        <Clock className="w-3.5 h-3.5 text-neutral-400" />
                        <span>{m.action.startTime} – {m.action.endTime} CAT</span>
                      </span>
                    </div>
                    <div className="text-[11px] text-emerald-700 font-medium">
                      ✓ Committed to Timetable & Google Calendar Bridge
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const sessionObj = todaySessions.find(s => s.moduleName.toLowerCase() === m.action.moduleName?.toLowerCase()) || {
                        module: m.action.moduleName,
                        topic: m.action.topicName,
                        title: `${m.action.moduleName} Study Session`
                      };
                      handleStartSession(sessionObj);
                    }}
                    className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs shrink-0 cursor-pointer"
                  >
                    🚀 Start Session Now
                  </button>
                </div>
              )}

              {m.action?.type === 'UPDATE_ASSESSMENT' && (
                <div className="mt-3 p-3.5 bg-blue-50 border border-blue-200/90 rounded-2xl flex items-center gap-3 text-neutral-900 shadow-xs">
                  <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                    <Calendar className="w-4 h-4" />
                  </div>
                  <div className="space-y-0.5 text-xs">
                    <div className="font-bold text-blue-900">
                      Authoritative Deadline Updated in Firestore
                    </div>
                    <div className="font-semibold text-neutral-800">
                      {m.action.assessmentTitle}: Due {m.action.newDueDate}
                    </div>
                    <div className="text-[11px] text-neutral-500">
                      Synchronized across SOMA assessments, daily planner, and calendar
                    </div>
                  </div>
                </div>
              )}

              {m.action?.type === 'PROACTIVE_NEXT_SESSION' && m.action.session && (
                <div className="mt-3 p-3.5 bg-purple-50 border border-purple-200/90 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-neutral-900 shadow-xs">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-purple-800">
                      <Sparkles className="w-4 h-4 text-purple-600" />
                      <span>Next Recommended Study Session</span>
                    </div>
                    <div className="text-sm font-bold text-neutral-900">
                      {m.action.session.module || m.action.session.title}
                    </div>
                    <div className="text-xs text-neutral-600 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-neutral-400" />
                      <span>{m.action.session.startTime} – {m.action.session.endTime} CAT</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleStartSession(m.action.session)}
                    className="px-3.5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs shrink-0 cursor-pointer"
                  >
                    🚀 Start Session Now
                  </button>
                </div>
              )}

              {m.score !== undefined && (
                <div className="mt-2 pt-2 border-t border-black/10 flex items-center gap-2 text-xs font-bold text-emerald-700">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Evaluation: {m.score}/10 — Recorded to Academic Dashboard Evidence</span>
                </div>
              )}
              {m.attachmentUrl && (
                <div className="mt-3">
                  <img src={m.attachmentUrl} alt="Student attachment" className="max-h-48 rounded-xl border border-white/20 object-cover" />
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="p-4 bg-purple-50 text-purple-700 rounded-2xl text-sm animate-pulse flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-600" />
              <span>SOMA is synthesizing your lectures, topic mastery, and academic calendar...</span>
            </div>
          )}
          <div ref={chatBottomRef} />
        </div>

        {/* Input & Image Upload */}
        <div className="p-4 sm:p-6 pt-3 border-t bg-white space-y-3 sticky bottom-0 z-10 shadow-lg">
          {imageAttachments.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              {imageAttachments.map((img, idx) => (
                <div key={idx} className="relative flex items-center gap-2 p-1.5 bg-neutral-50 rounded-xl border">
                  <img src={img} alt={`Page ${idx + 1}`} className="w-12 h-12 object-cover rounded-lg" />
                  <span className="text-[10px] font-bold bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded">Page {idx + 1}</span>
                  <button 
                    type="button"
                    onClick={() => setImageAttachments(prev => prev.filter((_, i) => i !== idx))} 
                    className="text-red-500 font-bold hover:text-red-700 px-1.5 text-xs"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={e => { e.preventDefault(); handleSend(); }} className="flex items-center gap-2 sm:gap-3">
            <label className="cursor-pointer bg-neutral-100 hover:bg-neutral-200 p-3 sm:p-3.5 rounded-2xl text-neutral-600 transition-colors flex items-center gap-1.5 shrink-0" title="Upload multiple handwritten pages for grading">
              <span>📷</span>
              <span className="text-xs font-semibold hidden sm:inline">Add Pages</span>
              <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
            </label>

            <input
              type="text"
              placeholder="Ask mentor, submit answers, or paste notes..."
              value={input}
              onChange={e => setInput(e.target.value)}
              className="flex-grow p-3 sm:p-3.5 border rounded-2xl text-xs sm:text-sm bg-neutral-50 focus:bg-white transition-all shadow-xs focus:outline-hidden focus:border-blue-500 min-w-0"
            />

            <button
              type="submit"
              disabled={loading || (!input.trim() && imageAttachments.length === 0)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 sm:px-6 py-3 sm:py-3.5 rounded-2xl font-medium text-xs sm:text-sm transition-all shadow-sm disabled:opacity-50 shrink-0"
            >
              Send →
            </button>
          </form>
        </div>
      </div>

      {/* Clean Chat Confirmation Modal */}
      {showClearModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-xl border border-neutral-100 space-y-4">
            <div className="flex items-center justify-between">
              <div className="w-10 h-10 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center">
                <Trash2 className="w-5 h-5" />
              </div>
              <button 
                type="button"
                onClick={() => setShowClearModal(false)}
                className="text-neutral-400 hover:text-neutral-600 p-1.5 rounded-xl hover:bg-neutral-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-bold text-neutral-900">
                Clean Chat History for {activeDayDisplay}?
              </h3>
              <p className="text-xs text-neutral-600 leading-relaxed">
                You currently have <strong className="text-neutral-900">{messages.length} message(s)</strong> in this session. 
                Cleaning will delete the conversation messages for <strong className="text-neutral-900">this active day only ({selectedDate})</strong>.
              </p>
              <div className="p-3 bg-neutral-50 rounded-2xl border border-neutral-200 text-[11px] text-neutral-600 space-y-1.5">
                <p className="flex items-center gap-1.5 font-medium text-emerald-700">
                  <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>Other days' chat folders in your Academic Timeline remain completely untouched.</span>
                </p>
                <p className="flex items-center gap-1.5 font-medium text-emerald-700">
                  <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>Your academic risk profile and recorded topic scores are NOT deleted.</span>
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowClearModal(false)}
                disabled={clearing}
                className="px-4 py-2.5 rounded-xl border border-neutral-200 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClearDayChat}
                disabled={clearing}
                className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                {clearing ? (
                  <>
                    <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                    <span>Cleaning...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clean This Day's Chat</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
