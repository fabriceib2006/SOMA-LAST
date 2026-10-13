import { db, auth } from './firebase';
import { 
  collection, 
  getDocs, 
  setDoc, 
  doc, 
  query, 
  where,
  writeBatch,
  orderBy
} from 'firebase/firestore';
import { AcademicActivity, LibraryModule, AcademicAssessment, CalculatedTopicMastery, ExternalCalendarEvent } from '../types';
import { getLibraryModules, getModuleAssessments, getModuleTopics } from './libraryFirestore';
import { getTopicEvidence, calculateTopicMastery } from './performanceFirestore';
import { getCATDateComponents, normalizeToCATDateString } from './catTime';
import { getFirestoreActivities } from './semesterFirestore';
import { cleanUndefined } from './firestoreUtils';

export const generateAndPersistDailyPlan = async (
  userId: string,
  semesterId: string,
  dayId: string,
  date: string
): Promise<AcademicActivity[]> => {
  try {
    // 1. Gather all required context
    const modules = await getLibraryModules(semesterId);
    
    let assessments: AcademicAssessment[] = [];
    let rawTopics: any[] = [];
    for (const m of modules) {
      const asms = await getModuleAssessments(m.id);
      assessments = [...assessments, ...asms];
      const topics = await getModuleTopics(m.id);
      rawTopics = [...rawTopics, ...topics];
    }

    const evidenceList = await getTopicEvidence(semesterId);
    const calculatedTopics = rawTopics.map(t => {
      const mod = modules.find(m => m.id === t.moduleId);
      return calculateTopicMastery(t, mod?.name || 'General', evidenceList);
    });

    // Gather history and activities
    const existingActivities = await getFirestoreActivities(dayId);
    const classes = existingActivities.filter(a => a.type === 'class');
    
    // NOTE: In a real implementation, you'd fetch more history. 
    // Here we use existing for simplicity.
    const studyHistory = existingActivities.filter(a => a.type === 'study_session');
    
    // Fetch Google Calendar Constraints
    const extEventsRef = collection(db, 'external_calendar_events');
    const q = query(extEventsRef, where('userId', '==', userId));
    const extEventsSnap = await getDocs(q);
    const externalEvents = extEventsSnap.docs.map(d => d.data() as ExternalCalendarEvent);
    

    // 2. Call the AI Planner API with enhanced context
    const response = await fetch('/api/generate-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modules: modules.map(m => ({ id: m.id, name: m.name, code: m.code, credits: m.credits || 3 })),
        topics: calculatedTopics.map(t => ({ 
          id: t.id, 
          name: t.name, 
          moduleName: t.moduleName, 
          status: t.status,
          trend: t.trend
        })),
        masteryScores: calculatedTopics.map(t => ({
          topicId: t.id,
          score: t.masteryScore
        })),
        studentRisk: {
          overall: calculatedTopics.filter(t => t.masteryScore < 50).length > 2 ? 'High' : 'Medium'
        },
        assessments: assessments.map(a => ({
          title: a.title,
          type: a.type,
          dueDate: a.dueDate,
          moduleId: a.moduleId
        })),
        existingTimetable: classes.map(c => ({
          title: c.title,
          startTime: c.startTime,
          endTime: c.endTime
        })),
        studyHistory: studyHistory.map(s => ({
          title: s.title,
          status: s.status,
          date: s.dayId
        })),
        externalCalendarEvents: externalEvents.map(e => ({
          title: e.title,
          start: e.start,
          end: e.end,
          status: e.status
        })),
        date
      })
    });

    const contentType = response.headers.get("content-type");
    if (!response.ok || !contentType || !contentType.includes("application/json")) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Failed to generate plan (${response.status}): ${errorText.substring(0, 150)}`);
    }
    const planData = await response.json();

    // 3. Persist to Firestore: One Canonical Plan per Day (Preserve completed, replace incomplete)
    if (!db) throw new Error("Database unavailable");
    const existingStudySessions = existingActivities.filter(a => a.type === 'study_session');
    const batch = writeBatch(db);

    for (const oldSession of existingStudySessions) {
      if (oldSession.status !== 'Completed' && oldSession.status !== 'In Progress') {
        batch.delete(doc(db, 'activities', oldSession.id));
      }
    }

    const newSessions: AcademicActivity[] = [];
    const timestamp = new Date().toISOString();

    for (const session of (planData.sessions || [])) {
      const id = `study_${dayId}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      const topic = calculatedTopics.find(t => t.name === session.topic || t.id === session.topicId);
      const mod = modules.find(m => m.name === session.module || m.id === session.moduleId);
      
      const activity: AcademicActivity = {
        id,
        dayId,
        userId,
        semesterId,
        type: 'study_session',
        title: session.activity || `${session.topic} Study Session`,
        moduleName: session.module || 'General',
        moduleId: topic?.moduleId || mod?.id || 'mod_general',
        topicName: session.topic || 'General Topic',
        topicId: topic?.id || 'top_general',
        startTime: session.start,
        endTime: session.end,
        duration: session.duration,
        taskType: session.taskType,
        priority: (session.priority as any) || 'Medium',
        reason: session.reason,
        source: 'intelligence_engine',
        status: 'Upcoming',
        createdAt: timestamp,
        updatedAt: timestamp
      };

      newSessions.push(activity);
      batch.set(doc(db, 'activities', id), cleanUndefined(activity));
    }

    await batch.commit();
    return newSessions;
  } catch (error) {
    console.error('Error generating and persisting daily plan:', error);
    throw error;
  }
};

export const getDailyPlan = async (dayId: string): Promise<AcademicActivity[]> => {
  const activities = await getFirestoreActivities(dayId);
  return activities.filter(a => a.type === 'study_session');
};

export const updateSessionStatus = async (
  sessionId: string, 
  status: AcademicActivity['status'],
  dayId: string
): Promise<void> => {
  const timestamp = new Date().toISOString();
  const updates: Partial<AcademicActivity> = { 
    status, 
    updatedAt: timestamp 
  };
  
  if (status === 'Completed') {
    updates.completedAt = timestamp;
  }

  // Update Firestore
  if (db) {
    await setDoc(doc(db, 'activities', sessionId), updates, { merge: true });
  }
};

export const addOrUpdateStudySession = async (
  userId: string,
  semesterId: string,
  dayId: string,
  session: {
    moduleName: string;
    topicName?: string;
    startTime: string;
    endTime: string;
    title?: string;
    priority?: 'Low' | 'Medium' | 'High' | 'Critical';
    reason?: string;
    taskType?: string;
    moduleId?: string;
    topicId?: string;
    date?: string;
  }
): Promise<AcademicActivity> => {
  if (!db) throw new Error("Database unavailable");
  
  const existingActivities = await getFirestoreActivities(dayId);
  const existingStudySessions = existingActivities.filter(a => a.type === 'study_session');
  
  // Rule 7: Update existing plan if same module or overlapping time window instead of creating duplicate
  const matchingExisting = existingStudySessions.find(s => 
    s.moduleName.toLowerCase() === session.moduleName.toLowerCase() ||
    (s.startTime === session.startTime && s.status !== 'Completed')
  );

  const timestamp = new Date().toISOString();
  const id = matchingExisting ? matchingExisting.id : `study_${dayId}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

  // Calculate duration in minutes
  let duration = 90;
  if (session.startTime && session.endTime) {
    const [sh, sm] = session.startTime.split(':').map(Number);
    const [eh, em] = session.endTime.split(':').map(Number);
    if (!isNaN(sh) && !isNaN(eh)) {
      duration = Math.max(30, (eh * 60 + em) - (sh * 60 + sm));
    }
  }

  const activity: AcademicActivity = {
    id,
    dayId,
    userId,
    semesterId,
    type: 'study_session',
    title: session.title || `${session.moduleName} Study Session`,
    moduleName: session.moduleName,
    moduleId: session.moduleId || matchingExisting?.moduleId || 'mod_general',
    topicName: session.topicName || `${session.moduleName} Review`,
    topicId: session.topicId || matchingExisting?.topicId || 'top_general',
    startTime: session.startTime,
    endTime: session.endTime,
    duration,
    taskType: (session.taskType as any) || 'Active Recall',
    priority: session.priority || 'High',
    reason: session.reason || `Scheduled by SOMA Intelligence for targeted module mastery.`,
    source: 'intelligence_engine',
    status: matchingExisting?.status || 'Upcoming',
    createdAt: matchingExisting?.createdAt || timestamp,
    updatedAt: timestamp,
    date: session.date || (matchingExisting as any)?.date
  };

  await setDoc(doc(db, 'activities', id), cleanUndefined(activity), { merge: true });
  return activity;
};
