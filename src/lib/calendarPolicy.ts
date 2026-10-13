import { AcademicActivity, AcademicAssessment } from '../types';
import { syncSOMAEntityToGoogle, deleteSOMAEntityFromGoogle } from './calendarSync';
import { safeParseDueDate } from './safeDateUtils';

export type CalendarSyncMode = 'essential' | 'academic' | 'full';

export async function evaluateAndSyncSession(
  userId: string,
  session: AcademicActivity,
  syncMode: CalendarSyncMode,
  isUserRequested = false,
  explicitDateStr?: string
) {
  // User Rule: Google Calendar events are strictly for CATs, Quizzes, Assignments, and Exams.
  // Routine classes and timetable operations must NOT be synced to Google Calendar.
  const isAssessmentOrCritical = 
    session.type === 'exam' || 
    session.type === 'cat' || 
    session.type === 'quiz' || 
    session.type === 'assignment';

  if (!isAssessmentOrCritical) {
    return; // Do not sync routine classes or timetable edits to Google Calendar
  }

  const baseDateStr = explicitDateStr || session.date || new Date().toISOString().split('T')[0];
  const startDateTime = `${baseDateStr}T${session.startTime || '09:00'}:00`;
  const endDateTime = `${baseDateStr}T${session.endTime || '10:30'}:00`;

  try {
    await syncSOMAEntityToGoogle(userId, session.id, 'assessment', {
      title: `SOMA — ${session.title || session.moduleName || 'Exam/CAT'}`,
      start: `${baseDateStr}T${session.startTime || '09:00'}:00+02:00`,
      end: `${baseDateStr}T${session.endTime || '10:30'}:00+02:00`,
      description: `Official Academic Milestone (${(session.type || 'activity').toUpperCase()}): ${session.moduleName || ''}`
    });
  } catch (e) {
    console.error('Failed to sync session to Google Calendar:', e);
  }
}

export async function evaluateAndSyncAssessment(
  userId: string,
  assessment: AcademicAssessment,
  syncMode: CalendarSyncMode
) {
  // Assessments are ALWAYS eligible under Essential, Academic, and Full
  const parsed = safeParseDueDate(assessment.dueDate);
  const dateStr = parsed.isoDateString || assessment.dueDate;
  const startDateTime = `${dateStr}T09:00:00`;
  const endDateTime = `${dateStr}T10:00:00`;

  try {
    await syncSOMAEntityToGoogle(userId, assessment.id, 'assessment', {
      title: `🚨 ${(assessment.type || 'assessment').toUpperCase()}: ${assessment.title}`,
      start: startDateTime,
      end: endDateTime,
      description: `Assessment Deadline. Module: ${assessment.moduleName || 'Academic Module'}`
    });
  } catch (e) {
    console.error('Failed to sync assessment to Google Calendar:', e);
  }
}
