import { db } from './firebase';
import { 
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, writeBatch, query, where 
} from 'firebase/firestore';
import { fetchPrimaryCalendarEvents, createGoogleCalendarEvent, updateGoogleCalendarEvent, deleteGoogleCalendarEvent } from './calendarApi';
import { AcademicActivity, AcademicAssessment, ExternalCalendarEvent, CalendarSyncMapping } from '../types';

export const SYNC_HORIZON_DAYS = 14;

// 1. Fetch External events from Google Calendar and import into SOMA as constraints
export async function syncGoogleEventsToSOMA(userId: string) {
  if (!db) return;
  
  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + SYNC_HORIZON_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Fetch events
  const googleEvents = await fetchPrimaryCalendarEvents(timeMin, timeMax);
  
  // Clean old external events for this user that are in the horizon to do a full refresh
  const extEventsRef = collection(db, 'external_calendar_events');
  const q = query(extEventsRef, where('userId', '==', userId));
  const existingDocs = await getDocs(q);
  
  const batch = writeBatch(db);
  const timestamp = new Date().toISOString();
  
  // Delete all existing external events to refresh them simply (in a real app you might want to do differential sync)
  existingDocs.forEach(d => {
    batch.delete(d.ref);
  });

  // Create new ones
  for (const ge of googleEvents) {
    // Skip events created by SOMA (we can identify them by a custom property or if we have mapping)
    // SOMA events will have "SOMA:" in the description, or we rely on our mapping collection.
    // For simplicity, let's say if it doesn't have somaEntityId in extendedProperties it's external.
    if (ge.extendedProperties?.private?.somaEntityId) continue;
    
    // Ignore full day events without specific time for now, or treat them as 00:00 to 23:59.
    const start = ge.start?.dateTime || (ge.start?.date ? `${ge.start.date}T00:00:00Z` : null);
    const end = ge.end?.dateTime || (ge.end?.date ? `${ge.end.date}T23:59:59Z` : null);
    
    if (!start || !end) continue;

    const extEvent: ExternalCalendarEvent = {
      id: `ext_${ge.id}`,
      userId,
      externalEventId: ge.id,
      calendarId: 'primary',
      title: ge.summary || 'Busy',
      start,
      end,
      timezone: ge.start?.timeZone,
      status: ge.status === 'cancelled' ? 'cancelled' : 'confirmed',
      lastSyncedAt: timestamp,
      source: 'google_calendar'
    };

    batch.set(doc(db, 'external_calendar_events', extEvent.id), extEvent);
  }

  await batch.commit();
}

export function ensureCATRFC3339(dt: string): string {
  if (!dt) return new Date().toISOString();
  if (/(?:[+-]\d{2}:\d{2}|Z)$/.test(dt)) return dt;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(dt)) return `${dt}+02:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dt)) return `${dt}:00+02:00`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dt)) return `${dt}T09:00:00+02:00`;
  return `${dt}+02:00`;
}

// 2. Sync SOMA Entity to Google Calendar
export async function syncSOMAEntityToGoogle(
  userId: string, 
  entityId: string, 
  entityType: 'timetable' | 'study_session' | 'assessment', 
  eventData: { title: string; start: string; end: string; description?: string }
): Promise<{ success: boolean; googleEventId?: string; error?: string }> {
  if (!db) return { success: false, error: 'Database unavailable' };
  
  const token = (await import('./auth')).getAccessToken();
  const mappingRef = doc(db, 'calendar_mappings', entityId);
  const mappingSnap = await getDoc(mappingRef);
  const timestamp = new Date().toISOString();

  // If there is no active Google access token, do not lie with a fake 'synced' status.
  if (!token) {
    const unlinkedMapping: CalendarSyncMapping = {
      somaEntityId: entityId,
      somaEntityType: entityType,
      googleCalendarId: 'primary',
      googleEventId: '',
      syncDirection: 'soma_to_google',
      syncStatus: 'pending_auth',
      lastSyncedAt: timestamp
    };
    await setDoc(mappingRef, unlinkedMapping, { merge: true });

    if (entityType === 'study_session' || entityType === 'timetable') {
      await setDoc(doc(db, 'activities', entityId), { calendarSyncStatus: 'needs_auth' }, { merge: true });
    } else if (entityType === 'assessment') {
      await setDoc(doc(db, 'assessments', entityId), { calendarSyncStatus: 'needs_auth' }, { merge: true });
    }
    return { success: false, error: 'NO_TOKEN' };
  }

  const startRFC = ensureCATRFC3339(eventData.start);
  const endRFC = ensureCATRFC3339(eventData.end);

  const googleEventPayload = {
    summary: eventData.title,
    description: eventData.description || 'Synced from SOMA Academic Intelligence',
    start: { dateTime: startRFC, timeZone: 'Africa/Maputo' },
    end: { dateTime: endRFC, timeZone: 'Africa/Maputo' },
    colorId: entityType === 'assessment' ? '11' : (entityType === 'study_session' ? '5' : '6'), // 11=Tomato(red), 5=Yellow, 6=Orange
    extendedProperties: {
      private: {
        somaEntityId: entityId,
        somaEntityType: entityType
      }
    }
  };

  if (mappingSnap.exists()) {
    // Update existing real event
    const mapping = mappingSnap.data() as CalendarSyncMapping;
    if (mapping.googleEventId && !mapping.googleEventId.startsWith('soma_gcal_')) {
      try {
        await updateGoogleCalendarEvent(mapping.googleEventId, googleEventPayload);
        await setDoc(mappingRef, { syncStatus: 'synced', lastSyncedAt: timestamp }, { merge: true });
        if (entityType === 'study_session' || entityType === 'timetable') {
          await setDoc(doc(db, 'activities', entityId), { googleEventId: mapping.googleEventId, calendarSyncStatus: 'synced' }, { merge: true });
        } else if (entityType === 'assessment') {
          await setDoc(doc(db, 'assessments', entityId), { googleEventId: mapping.googleEventId, calendarSyncStatus: 'synced' }, { merge: true });
        }
        return { success: true, googleEventId: mapping.googleEventId };
      } catch (err: any) {
        if (!err.message?.includes('404')) {
          console.warn("Failed to update existing Google Calendar event:", err?.message);
        }
        // Event deleted or not found on Google, will recreate below
      }
    }
  }

  // Create real event on Google Calendar
  try {
    const createdEvent = await createGoogleCalendarEvent(googleEventPayload);
    
    const newMapping: CalendarSyncMapping = {
      somaEntityId: entityId,
      somaEntityType: entityType,
      googleCalendarId: 'primary',
      googleEventId: createdEvent.id,
      syncDirection: 'soma_to_google',
      syncStatus: 'synced',
      lastSyncedAt: timestamp
    };

    await setDoc(mappingRef, newMapping);
    
    if (entityType === 'study_session' || entityType === 'timetable') {
      await setDoc(doc(db, 'activities', entityId), { googleEventId: createdEvent.id, calendarSyncStatus: 'synced' }, { merge: true });
    } else if (entityType === 'assessment') {
      await setDoc(doc(db, 'assessments', entityId), { googleEventId: createdEvent.id, calendarSyncStatus: 'synced' }, { merge: true });
    }
    return { success: true, googleEventId: createdEvent.id };
  } catch (err: any) {
    console.warn("External Google Calendar API call notice:", err?.message);
    const isTokenErr = err?.message?.includes('token') || err?.message?.includes('401');
    const newMapping: CalendarSyncMapping = {
      somaEntityId: entityId,
      somaEntityType: entityType,
      googleCalendarId: 'primary',
      googleEventId: '',
      syncDirection: 'soma_to_google',
      syncStatus: isTokenErr ? 'pending_auth' : 'error',
      lastSyncedAt: timestamp
    };

    await setDoc(mappingRef, newMapping);
    
    if (entityType === 'study_session' || entityType === 'timetable') {
      await setDoc(doc(db, 'activities', entityId), { calendarSyncStatus: isTokenErr ? 'needs_auth' : 'error' }, { merge: true });
    } else if (entityType === 'assessment') {
      await setDoc(doc(db, 'assessments', entityId), { calendarSyncStatus: isTokenErr ? 'needs_auth' : 'error' }, { merge: true });
    }
    return { success: false, error: err?.message };
  }
}

// 3. Remove SOMA Entity from Google Calendar
export async function deleteSOMAEntityFromGoogle(entityId: string, entityType: 'timetable' | 'study_session' | 'assessment') {
  if (!db) return;
  const mappingRef = doc(db, 'calendar_mappings', entityId);
  const mappingSnap = await getDoc(mappingRef);
  
  if (mappingSnap.exists()) {
    const mapping = mappingSnap.data() as CalendarSyncMapping;
    if (mapping.googleEventId && !mapping.googleEventId.startsWith('soma_gcal_')) {
      const token = (await import('./auth')).getAccessToken();
      if (token) {
        try {
          await deleteGoogleCalendarEvent(mapping.googleEventId);
        } catch (e: any) {
          console.info('Google Calendar event delete noticed (already cleared or removed):', e?.message || e);
        }
      }
    }
    await deleteDoc(mappingRef);
  }
}

// 4. Batch push all pending SOMA assessments & study sessions to Google Calendar
export async function syncAllPendingSOMAEntitiesToGoogle(userId: string): Promise<number> {
  if (!db) return 0;
  const token = (await import('./auth')).getAccessToken();
  if (!token) return 0;

  let syncedCount = 0;

  try {
    // 1. Sync pending assessments
    const asmRef = collection(db, 'assessments');
    const asmSnap = await getDocs(query(asmRef, where('userId', '==', userId)));

    for (const d of asmSnap.docs) {
      const data = d.data() as AcademicAssessment;
      const isPending = data.calendarSyncStatus === 'needs_auth' || 
                        data.calendarSyncStatus === 'pending_auth' ||
                        !data.googleEventId ||
                        data.googleEventId.startsWith('soma_gcal_');

      if (isPending && data.dueDate) {
        const dueDate = data.dueDate;
        const startTime = '09:00';
        const endTime = data.durationMinutes ? `${Math.floor((9 * 60 + data.durationMinutes) / 60).toString().padStart(2, '0')}:${((9 * 60 + data.durationMinutes) % 60).toString().padStart(2, '0')}` : '10:30';
        const typeLabel = data.type ? data.type.toUpperCase() : 'ASSESSMENT';

        const res = await syncSOMAEntityToGoogle(userId, d.id, 'assessment', {
          title: `SOMA ${typeLabel}: ${data.title || data.moduleName || 'Assessment'}`,
          start: `${dueDate}T${startTime}:00+02:00`,
          end: `${dueDate}T${endTime}:00+02:00`,
          description: `Official ${typeLabel} for ${data.moduleName || 'Academic Course'}.\nDate: ${dueDate}\nTime: ${startTime} – ${endTime} CAT.\nPriority: Examination Milestone.\nManaged by SOMA Intelligence.`
        });
        if (res.success) syncedCount++;
      }
    }

    // 2. Sync pending activities (exams, cats, quizzes only)
    const actRef = collection(db, 'activities');
    const actSnap = await getDocs(query(actRef, where('userId', '==', userId)));

    for (const d of actSnap.docs) {
      const data = d.data() as AcademicActivity;
      const isImportantType = data.type === 'cat' || data.type === 'exam' || data.type === 'quiz' || data.type === 'assignment';
      const isPending = data.calendarSyncStatus === 'needs_auth' ||
                        data.calendarSyncStatus === 'pending_auth' ||
                        !data.googleEventId ||
                        data.googleEventId.startsWith('soma_gcal_');

      if (isImportantType && isPending && data.date && data.startTime && data.endTime) {
        const res = await syncSOMAEntityToGoogle(userId, d.id, 'assessment', {
          title: `SOMA: ${data.title || data.moduleName || 'Activity'}`,
          start: `${data.date}T${data.startTime}:00+02:00`,
          end: `${data.date}T${data.endTime}:00+02:00`,
          description: `Module: ${data.moduleName || 'Curriculum'} | Scheduled by SOMA Intelligence`
        });
        if (res.success) syncedCount++;
      }
    }
  } catch (e) {
    console.warn('Error during batch sync of pending entities:', e);
  }

  return syncedCount;
}
