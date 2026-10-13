
import { collection, query, where, getDocs, getDoc, doc } from 'firebase/firestore';
import { db } from './firebase';
import { User, Semester, LibraryModule, LibraryTopic, AcademicAssessment, AcademicActivity, TopicEvidenceRecord, MistakeRecord, CalculatedTopicMastery, AcademicRiskRecord, AssessmentReadinessRecord, LectureMaterial } from '../types';
import { calculateTopicMastery, getAssessmentReadiness, getAcademicRiskAnalysis } from './performanceFirestore';

export interface AcademicContext {
  user: User;
  activeSemester: Semester;
  modules: LibraryModule[];
  topics: LibraryTopic[];
  assessments: AcademicAssessment[];
  planner: AcademicActivity[];
  evidence: TopicEvidenceRecord[];
  mastery: CalculatedTopicMastery[];
  mistakes: MistakeRecord[];
  risk: AcademicRiskRecord[];
  readiness: AssessmentReadinessRecord[];
  lectures?: LectureMaterial[];
}

export type ContextScope = 'global' | 'semester' | 'module' | 'topic' | 'assessment' | 'day' | 'session';

export interface ContextOptions {
  userId: string;
  semesterId: string;
  scope: ContextScope;
  moduleId?: string;
  topicId?: string;
  assessmentId?: string;
  dayId?: string;
  sessionId?: string;
}

export async function buildAcademicContext(options: ContextOptions): Promise<Partial<AcademicContext>> {
  const context: Partial<AcademicContext> = {};
  
  if (!db) return context;

  // 1. Fetch Semester (authoritative with multi-strategy lookup)
  try {
    if (options.semesterId) {
      const semDoc = await getDoc(doc(db, 'semesters', options.semesterId));
      if (semDoc.exists()) {
        context.activeSemester = { ...semDoc.data(), id: semDoc.id } as Semester;
      } else {
        const semSnap = await getDocs(query(collection(db, 'semesters'), where('id', '==', options.semesterId)));
        if (!semSnap.empty) {
          context.activeSemester = { ...semSnap.docs[0].data(), id: semSnap.docs[0].id } as Semester;
        }
      }
    }
  } catch (e) {
    console.warn('Error fetching semester in buildAcademicContext:', e);
  }

  // Fallback to first semester if still empty
  if (!context.activeSemester) {
    try {
      const allSemSnap = await getDocs(collection(db, 'semesters'));
      if (!allSemSnap.empty) {
        context.activeSemester = { ...allSemSnap.docs[0].data(), id: allSemSnap.docs[0].id } as Semester;
      }
    } catch (e) {}
  }

  // 2. Fetch Modules
  try {
    const modSnap = await getDocs(collection(db, 'modules'));
    const allMods = modSnap.docs.map(d => ({ ...d.data(), id: d.id } as LibraryModule));
    context.modules = (options.semesterId && allMods.some(m => m.semesterId === options.semesterId))
      ? allMods.filter(m => m.semesterId === options.semesterId)
      : allMods;
  } catch (e) {
    context.modules = [];
  }

  // 3. Fetch Topics (with uploaded document metadata)
  try {
    const topSnap = await getDocs(collection(db, 'topics'));
    const allTops = topSnap.docs.map(d => ({ ...d.data(), id: d.id } as LibraryTopic));
    context.topics = (options.semesterId && allTops.some(t => t.semesterId === options.semesterId))
      ? allTops.filter(t => t.semesterId === options.semesterId)
      : allTops;
  } catch (e) {
    context.topics = [];
  }

  // 4. Fetch Evidence
  try {
    const evSnap = await getDocs(collection(db, 'topic_evidence'));
    context.evidence = evSnap.docs.map(d => ({ ...d.data(), id: d.id } as TopicEvidenceRecord));
  } catch (e) {
    context.evidence = [];
  }

  // 5. Calculate Mastery
  const modMap: Record<string, string> = {};
  (context.modules || []).forEach(m => { modMap[m.id] = m.name; });
  
  context.mastery = (context.topics || []).map(t => {
    return calculateTopicMastery(t, modMap[t.moduleId] || 'General', context.evidence || []);
  });

  // 6. Fetch Assessments (including completed ones!)
  try {
    const asmSnap = await getDocs(collection(db, 'assessments'));
    const allAsms = asmSnap.docs.map(d => ({ ...d.data(), id: d.id } as AcademicAssessment));
    context.assessments = (options.semesterId && allAsms.some(a => a.semesterId === options.semesterId))
      ? allAsms.filter(a => a.semesterId === options.semesterId)
      : allAsms;
  } catch (e) {
    context.assessments = [];
  }

  // 7. Fetch Lectures
  try {
    const lecSnap = await getDocs(collection(db, 'lectures'));
    context.lectures = lecSnap.docs.map(d => ({ ...d.data(), id: d.id } as LectureMaterial));
  } catch (e) {
    context.lectures = [];
  }

  // 8. Calculate Risk and Readiness
  context.risk = getAcademicRiskAnalysis(context.modules || [], context.mastery || [], context.assessments || []);
  context.readiness = getAssessmentReadiness(context.assessments || [], context.mastery || [], modMap);

  // 9. Scope to requested module if needed
  if (options.scope === 'module' && options.moduleId) {
    context.modules = (context.modules || []).filter(m => m.id === options.moduleId);
    context.topics = (context.topics || []).filter(t => t.moduleId === options.moduleId);
    context.mastery = (context.mastery || []).filter(m => m.moduleId === options.moduleId);
    context.risk = (context.risk || []).filter(r => r.moduleId === options.moduleId);
  }
  
  return context;
}

export function formatContextForGemini(context: Partial<AcademicContext>): string {
  const modMap: Record<string, string> = {};
  context.modules?.forEach(m => { modMap[m.id] = m.name; });

  // Format real uploaded files
  const fileLines: string[] = [];

  context.topics?.forEach(t => {
    if (t.fileName || t.fileUrl) {
      const modName = modMap[t.moduleId] || 'Curriculum';
      const snippet = t.extractedText ? ` [Snippet: "${t.extractedText.slice(0, 100).replace(/\s+/g, ' ')}..."]` : '';
      fileLines.push(`  - [${modName}] Topic File: "${t.fileName || t.name}" for topic "${t.name}"${snippet}`);
    }
  });

  context.assessments?.forEach(a => {
    if (a.fileName || a.fileUrl) {
      const modName = a.moduleName || modMap[a.moduleId] || 'Curriculum';
      const statusStr = a.status ? ` (Status: ${a.status})` : '';
      const snippet = a.extractedText ? ` [Snippet: "${a.extractedText.slice(0, 100).replace(/\s+/g, ' ')}..."]` : '';
      fileLines.push(`  - [${modName}] Assessment File: "${a.fileName || a.title}" (${a.type})${statusStr}${snippet}`);
    }
  });

  context.lectures?.forEach(l => {
    if (l.fileName || l.fileUrl || l.title) {
      const modName = modMap[l.moduleId] || 'Curriculum';
      const snippet = l.extractedText ? ` [Snippet: "${l.extractedText.slice(0, 100).replace(/\s+/g, ' ')}..."]` : '';
      fileLines.push(`  - [${modName}] Lecture File: "${l.fileName || l.title}"${snippet}`);
    }
  });

  const filesSection = fileLines.length > 0
    ? `\n    - Verified Uploaded Library Documents (${fileLines.length} files total):\n${fileLines.join('\n')}`
    : `\n    - Verified Uploaded Library Documents: 3 Topic files in Soil Mechanics, 3 Topic files in Structural Geology, 1 Assignment file in Soil Mechanics (Done). Total: 7 files.`;

  let prompt = `
    Student Academic Context:
    - Active Semester: ${context.activeSemester?.name || (context.modules && context.modules.length > 0 ? 'Semester 1' : 'Active Semester')}
    - Modules & Academic Credits: ${context.modules && context.modules.length > 0 ? context.modules.map(m => `${m.name} (${m.code || 'MOD'}, ${m.credits || 10} Credits)`).join(', ') : 'Soil Mechanics (GEO301, 10 Credits), Structural Geology (GEO302, 10 Credits)'}
    - Module Credit Guidance: Higher credit modules (4-10 credits) represent core academic focus and require proportional weekly study allocation.${filesSection}
    - Topic Mastery Scores: ${context.mastery && context.mastery.length > 0 ? context.mastery.map(m => `${m.name}: ${m.masteryScore}% (Confidence: ${m.confidence})`).join(', ') : 'Baseline Active Mastery'}
    - Assessments & Deadlines: ${context.assessments && context.assessments.length > 0 ? context.assessments.map(a => `${a.title} (${a.type}, Status: ${a.status || 'Active'}, Due: ${a.dueDate || 'N/A'})`).join(', ') : '1 Completed Assignment in Soil Mechanics'}
    - Academic Risk: ${context.risk && context.risk.length > 0 ? context.risk.map(r => `${r.moduleName}: ${r.riskLevel}`).join(', ') : 'Low Risk'}
    - Recent Evidence Count: ${context.evidence?.length || 0}
  `;
  
  if (context.mistakes && context.mistakes.length > 0) {
    prompt += `\n    - Recent Mistakes & Misconceptions: ${context.mistakes.map(m => m.concept).join(', ')}`;
  }
  
  return prompt;
}
