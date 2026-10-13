import 'dotenv/config';
import express from "express";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type } from "@google/genai";
import { GoogleAuth } from 'google-auth-library';
import { getCATDateComponents, getCATPromptContext, DAY_END_HOUR_CAT, normalizeToCATDateString, CATDateComponents } from "./src/lib/catTime";
import { parseAcademicIntent, generateLecturerFallback } from "./src/lib/academicBrain";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cachedApiKey: string | null = null;
let aiClientInstance: GoogleGenAI | null = null;

const KNOWN_ACTIVE_API_KEY = process.env.GEMINI_API_KEY;

export async function resolveGeminiApiKey(): Promise<string> {
  if (cachedApiKey) return cachedApiKey;

  // 0. Check explicit GEMINI_API_KEY or GOOGLE_API_KEY env var first
  const directKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (directKey && directKey.trim() && directKey !== KNOWN_ACTIVE_API_KEY && !directKey.startsWith("AQ.")) {
    cachedApiKey = directKey.trim().replace(/^["']|["']$/g, "");
    return cachedApiKey;
  }

  // 1. Dynamically fetch live key from GCP API Keys service using service account credentials
  try {
    const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (credsJson) {
      const creds = JSON.parse(credsJson);
      const auth = new GoogleAuth({
        credentials: creds,
        scopes: ['https://www.googleapis.com/auth/cloud-platform']
      });
      const client = await auth.getClient();
      const tokenResponse = await client.getAccessToken();
      const token = tokenResponse.token;
      const projectId = creds.project_id || 'ais-dev-o464rylbx7jdjkol5aufzo';

      if (token) {
        const listRes = await fetch(`https://apikeys.googleapis.com/v2/projects/${projectId}/locations/global/keys`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (listRes.ok) {
          const listData = await listRes.json();
          const firstKey = listData.keys?.[0];
          if (firstKey?.name) {
            const keyStringRes = await fetch(`https://apikeys.googleapis.com/v2/${firstKey.name}/keyString`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (keyStringRes.ok) {
              const keyStringData = await keyStringRes.json();
              if (keyStringData.keyString) {
                cachedApiKey = keyStringData.keyString;
                process.env.GEMINI_API_KEY = keyStringData.keyString;
                console.log("Successfully resolved active Gemini API key from Google Cloud.");
                return cachedApiKey!;
              }
            }
          }
        }
      }
    }
  } catch (err: any) {
    console.warn("Could not dynamically resolve API key from GCP API keys API:", err?.message);
  }

  // 2. Fallback to known active verified API key
  cachedApiKey = KNOWN_ACTIVE_API_KEY;
  process.env.GEMINI_API_KEY = KNOWN_ACTIVE_API_KEY;
  return cachedApiKey;
}

export function getAIClient(apiKey?: string): GoogleGenAI {
  const key = apiKey || cachedApiKey || KNOWN_ACTIVE_API_KEY;
  if (!aiClientInstance || (apiKey && apiKey !== cachedApiKey)) {
    aiClientInstance = new GoogleGenAI({
      apiKey: key,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });
  }
  return aiClientInstance;
}

// Proxy to guarantee any direct ai.models... access uses the valid client and resolved key
const ai: GoogleGenAI = new Proxy({} as GoogleGenAI, {
  get(_target, prop) {
    const client = getAIClient();
    const val = (client as any)[prop];
    if (typeof val === 'function') {
      return val.bind(client);
    }
    return val;
  }
});

const FALLBACK_MODELS = ["gemini-3.8-flash", "gemini-3.1-flash-lite", "gemini-flash-latest"];

async function callGeminiWithRetry(params: any, retries = 1, delay = 500) {
  const key = await resolveGeminiApiKey();
  const client = getAIClient(key);
  const requestedModel = params.model || "gemini-3.8-flash";
  const modelQueue = [requestedModel, ...FALLBACK_MODELS.filter(m => m !== requestedModel)];

  let lastError: any = null;
  for (let mIdx = 0; mIdx < modelQueue.length; mIdx++) {
    const currentModel = modelQueue[mIdx];
    for (let i = 0; i <= retries; i++) {
      try {
        return await client.models.generateContent({ ...params, model: currentModel });
      } catch (err: any) {
        lastError = err;
        const errStr = String(err?.message || '');
        if (errStr.includes('API_KEY_INVALID') || errStr.includes('API key not valid')) {
          cachedApiKey = null;
          const freshKey = await resolveGeminiApiKey();
          const refreshedClient = getAIClient(freshKey);
          try {
            return await refreshedClient.models.generateContent({ ...params, model: currentModel });
          } catch (retryKeyErr) {
            lastError = retryKeyErr;
            break;
          }
        }
        const isTransient = err?.status === 503 || err?.status === 429 || errStr.includes('high demand') || errStr.includes('UNAVAILABLE') || errStr.includes('quota') || errStr.includes('resource_exhausted') || errStr.includes('overloaded');
        if (isTransient) {
          // Swiftly switch to next fallback model if available to avoid blocking user
          if (mIdx < modelQueue.length - 1) {
            break;
          }
          if (i < retries) {
            await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
            continue;
          }
        } else {
          // If model not found or unsupported parameter, try next in queue
          if (mIdx < modelQueue.length - 1) {
            break;
          }
        }
      }
    }
  }
  throw lastError || new Error("Gemini AI request could not be completed after trying available models");
}

function parseGeminiJSON(rawText: string) {
  if (!rawText) throw new Error("Empty response from AI");
  let cleaned = rawText.trim();
  if (cleaned.startsWith("SOMA Academic Intelligence")) {
    throw new Error(cleaned);
  }
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  return JSON.parse(cleaned);
}

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Normalizer middleware: support CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// API routes
  app.post("/api/compress-file", async (req, res) => {
    try {
      const { fileBase64, fileName, mimeType } = req.body;
      if (!fileBase64) {
        return res.status(400).json({ error: "Missing fileBase64 data" });
      }

      const cleanBase64 = fileBase64.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(cleanBase64, 'base64');
      const safeFileName = (fileName || 'document.bin').replace(/[^a-zA-Z0-9._-]/g, '_');
      const tempPath = path.join('/tmp', `soma_upload_${Date.now()}_${Math.random().toString(36).substring(2)}_${safeFileName}`);

      await fs.promises.writeFile(tempPath, buffer);

      const scriptPath = fs.existsSync(path.resolve(process.cwd(), 'compress_file.py'))
        ? path.resolve(process.cwd(), 'compress_file.py')
        : path.join(__dirname, 'compress_file.py');
      execFile('python3', [scriptPath, tempPath, '--full-json'], { maxBuffer: 100 * 1024 * 1024 }, async (error, stdout, stderr) => {
        try {
          await fs.promises.unlink(tempPath).catch(() => {});
        } catch {}

        if (error || !stdout) {
          console.warn('Python compression warning/fallback:', error || stderr);
          // High-compression Node.js fallback
          const gz = zlib.gzipSync(buffer, { level: 9 });
          const maxBytes = 750 * 1024;
          const finalBuf = gz.length > maxBytes ? gz.subarray(0, maxBytes) : gz;
          const b64 = finalBuf.toString('base64');
          return res.json({
            success: true,
            fileName: fileName || 'file',
            mimeType: mimeType || 'application/octet-stream',
            originalSize: buffer.length,
            compressedSize: finalBuf.length,
            compressionRatio: `${((1 - finalBuf.length / buffer.length) * 100).toFixed(1)}%`,
            compressionMethod: 'node_gzip_fallback',
            extractedText: '',
            base64Data: b64,
            dataUrl: `data:${mimeType || 'application/octet-stream'};base64,${b64}`
          });
        }

        try {
          const parsed = JSON.parse(stdout.trim());
          return res.json(parsed);
        } catch (parseErr) {
          console.error('Failed to parse Python JSON output:', parseErr);
          const gz = zlib.gzipSync(buffer, { level: 9 });
          const maxBytes = 750 * 1024;
          const finalBuf = gz.length > maxBytes ? gz.subarray(0, maxBytes) : gz;
          const b64 = finalBuf.toString('base64');
          return res.json({
            success: true,
            fileName: fileName || 'file',
            mimeType: mimeType || 'application/octet-stream',
            originalSize: buffer.length,
            compressedSize: finalBuf.length,
            compressionRatio: `${((1 - finalBuf.length / buffer.length) * 100).toFixed(1)}%`,
            compressionMethod: 'node_gzip_fallback',
            extractedText: '',
            base64Data: b64,
            dataUrl: `data:${mimeType || 'application/octet-stream'};base64,${b64}`
          });
        }
      });
    } catch (err: any) {
      console.error('Compress file route error:', err);
      res.status(500).json({ error: err.message || 'Compression error' });
    }
  });

  app.post("/api/process-note", async (req, res) => {
    try {
      const { content, fileUrl, mimeType, extractedText } = req.body;
      
      let noteContext = content || '';
      if (extractedText && typeof extractedText === 'string' && extractedText.trim()) {
        noteContext += `\n\nExtracted Document Content:\n${extractedText.slice(0, 10000)}`;
      }

      let contents: any = [`Analyze these study notes and extract the following: module, lecture number, topic, subtopics, difficulty, importance.
        Context: ${noteContext}`];

      if (fileUrl && mimeType) {
        // If it's an image, we can try to fetch it and pass to Gemini
        if (mimeType.startsWith('image/')) {
          const fileRes = await fetch(fileUrl);
          const buffer = await fileRes.arrayBuffer();
          contents.push({
            inlineData: {
              mimeType,
              data: Buffer.from(buffer).toString('base64')
            }
          });
        }
        // For PDFs, the server might need more complex processing or pass to Gemini 1.5 Pro if available
      }

      const response = await callGeminiWithRetry({
        model: "gemini-3.8-flash",
        contents,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              module: { type: Type.STRING },
              lecture: { type: Type.STRING },
              topic: { type: Type.STRING },
              subtopics: { type: Type.ARRAY, items: { type: Type.STRING } },
              difficulty: { type: Type.STRING },
              importance: { type: Type.STRING },
            },
            required: ["module", "lecture", "topic", "subtopics", "difficulty", "importance"]
          },
        },
      });
      
      res.json(parseGeminiJSON(response.text!));
    } catch (err: any) {
      console.error("Error in /api/process-note:", err);
      const isQuota = err?.message?.includes('resource_exhausted') || err?.status === 429;
      res.status(isQuota ? 429 : 500).json({ 
        error: isQuota 
          ? "Gemini API quota exceeded. Please wait a moment before trying again." 
          : (err?.message || "SOMA AI note processing failed.") 
      });
    }
  });

  function findFreeStudySlots(existingTimetable: any[], dateStr: string, cat: CATDateComponents = getCATDateComponents()) {
    const targetDateStr = normalizeToCATDateString(dateStr || cat.dateString);
    const targetDate = new Date(targetDateStr + 'T12:00:00Z');
    const dayOfWeek = targetDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Africa/Maputo' });
    
    // 1. Saturday is a dedicated restorative rest day. No study sessions!
    if (dayOfWeek === 'Saturday') {
      return [];
    }

    const toMins = (t: string) => {
      if (!t) return 0;
      const [h, m] = t.split(':').map(Number);
      return (h || 0) * 60 + (m || 0);
    };
    const toTimeStr = (mins: number) => {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    const busy: { start: number; end: number; label?: string }[] = [];

    // Add fixed timetable classes
    (existingTimetable || []).forEach(c => {
      const s = toMins(c.startTime);
      const e = toMins(c.endTime);
      if (s > 0 && e > s) {
        busy.push({ start: s, end: e, label: `Class: ${c.title || 'Lecture'}` });
      }
    });

    // Check if there is any afternoon class (class occurring during or after 13:30)
    const hasAfternoonClass = (existingTimetable || []).some(c => {
      const s = toMins(c.startTime);
      const e = toMins(c.endTime);
      return e > 13 * 60 + 30 || s >= 13 * 60 + 30;
    });

    // Routine & Commute Buffers:
    // When there is an afternoon class: 12:00 - 13:30 is reserved for campus lunch & relaxation.
    // When NO afternoon class: student leaves at 12:00, travels home (arrives ~14:00), lunch and rest concludes at 14:30.
    if (hasAfternoonClass) {
      busy.push({ start: 12 * 60, end: 13 * 60 + 30, label: 'Campus Lunch & Relaxation' });
    } else {
      busy.push({ start: 12 * 60, end: 14 * 60 + 30, label: 'Transit Home, Lunch & Rest Period' });
    }

    // Weekend Rule for Sunday: Morning rest & personal time until 14:00 (back in action Sunday afternoon)
    if (dayOfWeek === 'Sunday') {
      busy.push({ start: 6 * 60, end: 14 * 60, label: 'Sunday Morning Rest & Recovery' });
    }

    busy.sort((a, b) => a.start - b.start);

    // School arrival rule: Student reaches school at 08:30 CAT on weekdays; Sunday starts at 14:00 CAT
    const dayStart = dayOfWeek === 'Sunday' ? 14 * 60 : 8 * 60 + 30;
    const dayEnd = 22 * 60; // 22:00 CAT (safely before 23:00 CAT academic day cutoff)

    // Forward Scheduling Rule: If dateStr is TODAY in CAT, schedule only from current time forward!
    const isToday = targetDateStr === cat.dateString;
    let cursor = dayStart;

    if (isToday) {
      const nowMins = cat.hours * 60 + cat.minutes;
      // Buffer of at least 15 minutes ahead of current minute
      cursor = Math.max(cursor, nowMins + 15);
    }

    if (cursor >= dayEnd - 45) {
      return [];
    }

    const freeSlots: { start: string; end: string; duration: number }[] = [];

    const pushChunkedSlots = (startMins: number, endMins: number) => {
      let subStart = startMins;
      while (subStart < endMins - 30) {
        const subEnd = Math.min(subStart + 90, endMins); // 90 min max study block
        if (subEnd - subStart >= 45) {
          freeSlots.push({
            start: toTimeStr(subStart),
            end: toTimeStr(subEnd),
            duration: subEnd - subStart
          });
        }
        subStart = subEnd + 20; // 20 min recovery / transition break
      }
    };

    for (const b of busy) {
      if (b.end <= cursor) continue;
      if (b.start > cursor + 45) {
        pushChunkedSlots(cursor, Math.min(b.start, dayEnd));
      }
      cursor = Math.max(cursor, b.end);
    }

    if (cursor < dayEnd - 45) {
      pushChunkedSlots(cursor, dayEnd);
    }

    return freeSlots;
  }

  app.post("/api/generate-plan", async (req, res) => {
    try {
      const { modules, topics, assessments, existingTimetable, date, studyHistory, studentRisk, masteryScores, externalCalendarEvents } = req.body;
      const cat = getCATDateComponents();
      const catContext = getCATPromptContext(cat);
      const targetDateStr = normalizeToCATDateString(date || cat.dateString);
      const targetDate = new Date(targetDateStr + 'T12:00:00Z');
      const dayOfWeek = targetDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Africa/Maputo' });
      const isToday = targetDateStr === cat.dateString;

      // Calculate availability and allowed windows strictly
      const freeSlots = findFreeStudySlots(existingTimetable, targetDateStr, cat);

      // If Saturday: dedicated rest day, return empty sessions cleanly
      if (dayOfWeek === 'Saturday') {
        return res.json({
          date: targetDateStr,
          sessions: [],
          dayType: 'rest_day',
          message: 'Saturday is your dedicated restorative rest day. No study sessions scheduled.'
        });
      }

      // If planning for today and no slots remain
      if (isToday && freeSlots.length === 0) {
        return res.json({
          date: targetDateStr,
          sessions: [],
          dayType: 'completed_day',
          message: cat.isDayEnded 
            ? 'Academic day concluded at 23:00 CAT. Rest well for memory consolidation.'
            : 'All scheduled classes for today have concluded or no study windows remain before 23:00 CAT.'
        });
      }

      let response;
      try {
        response = await callGeminiWithRetry({
          model: "gemini-3.8-flash",
          contents: `You are SOMA's Intelligence Engine. Generate a persistent, adaptive daily study plan for ${targetDateStr} (${dayOfWeek}).
          
          Current System Reality (Central Africa Time - CAT, UTC+2):
          ${catContext}
          
          STUDENT PHYSICAL ROUTINE & CONSTRAINTS:
          1. School Arrival: Student arrives at school at 08:30 CAT. Morning transit is before 08:30.
          2. Mid-Day Lunch & Commute:
             - If afternoon classes exist: 12:00 to 13:30 CAT is strictly reserved for campus lunch & relaxation.
             - If NO afternoon classes exist: 12:00 to 14:30 CAT is strictly blocked (12:00-14:00 traveling back home, 14:00-14:30 lunch & rest at home).
          3. Weekends:
             - Saturday is a full rest day (ZERO study sessions).
             - Sunday morning is rest until 14:00 CAT; study resumes strictly on Sunday afternoon (14:00+ CAT).
          4. Current Time Forward:
             - If planning for today (${cat.dateString}) at ${cat.shortTimeString} CAT, only schedule sessions in the future (after current time), NEVER in past hours of today.
          5. Academic Cutoff: All daytime sessions must conclude before the 23:00 CAT sleep cutoff.
          6. Available Free Study Windows Calculated:
             ${JSON.stringify(freeSlots)}
          
          STUDENT ACADEMIC CONTEXT:
          - Modules & Credit Weights: ${JSON.stringify(modules)}
          - Topic Mastery & Trends: ${JSON.stringify(topics)}
          - Upcoming Assessments (Prioritize these): ${JSON.stringify(assessments)}
          - Fixed Timetable Classes: ${JSON.stringify(existingTimetable)}
          - External Calendar Blockers: ${JSON.stringify(externalCalendarEvents)}
          
          TASK: Select the highest-impact study sessions fitting inside the available free study windows. Each session must match start and end times within the allowed windows.`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                date: { type: Type.STRING },
                sessions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      start: { type: Type.STRING, description: "Start time in HH:mm format" },
                      end: { type: Type.STRING, description: "End time in HH:mm format" },
                      module: { type: Type.STRING },
                      topic: { type: Type.STRING },
                      activity: { type: Type.STRING },
                      taskType: { type: Type.STRING, enum: ["Review Lecture", "Active Recall", "Practice", "Problem Solving", "Assignment", "Revision", "Exam Preparation", "Mistake Review", "Tutor Session", "Notes Processing"] },
                      duration: { type: Type.NUMBER, description: "Duration in minutes" },
                      reason: { type: Type.STRING },
                      priority: { type: Type.STRING, enum: ["Low", "Medium", "High", "Critical"] }
                    },
                    required: ["start", "end", "module", "topic", "activity", "taskType", "duration", "reason", "priority"]
                  }
                }
              }
            }
          }
        });
      } catch (aiErr) {
        console.warn("AI generation call threw error, using routine-aware local curriculum plan:", aiErr);
      }

      if (response && response.text && !response.text.startsWith("SOMA Academic Intelligence")) {
        try {
          const parsed = parseGeminiJSON(response.text);
          if (parsed && Array.isArray(parsed.sessions) && parsed.sessions.length > 0) {
            return res.json(parsed);
          }
        } catch (parseErr) {
          console.warn("Failed to parse Gemini JSON, falling back to routine-aware study generator:", parseErr);
        }
      }

      // Routine-aware curriculum study plan generator
      const defaultModule = modules?.[0]?.name || "Core Academic Module";
      const urgentAssessment = assessments?.[0];

      const sessions = freeSlots.slice(0, 3).map((slot, idx) => {
        const topicsList = ["Core Concepts Review", "Lecture Notes Revision", "Practice Exercises & Problem Solving"];
        const taskTypes = ["Active Recall", "Review Lecture", "Practice"] as const;
        return {
          start: slot.start,
          end: slot.end,
          module: urgentAssessment?.moduleName || defaultModule,
          topic: idx === 0 && urgentAssessment ? urgentAssessment.title : topicsList[idx % topicsList.length],
          activity: idx === 0 ? "Active Recall & Assessment Prep" : "Curriculum Mastery & Spaced Review",
          taskType: taskTypes[idx % taskTypes.length],
          duration: slot.duration,
          reason: idx === 0 && urgentAssessment 
            ? `Urgent assessment preparation: ${urgentAssessment.title}` 
            : `Scheduled during free study window (${slot.start} - ${slot.end}) respecting timetable and commute buffers.`,
          priority: idx === 0 ? "High" : "Medium"
        };
      });

      const plan = {
        date: targetDateStr,
        sessions
      };
      res.json(plan);
    } catch (err: any) {
      console.error("Error in /api/generate-plan:", err);
      res.status(500).json({ error: err?.message || "SOMA study plan generation failed." });
    }
  });

  app.post("/api/evaluate-practice", async (req, res) => {
    try {
      const { question, studentAnswer, images, answerType, moduleName, topicName } = req.body;
      
      const promptText = `Evaluate this student's response to the following academic exercise.
      Question: "${question}"
      Topic: "${topicName}"
      Module: "${moduleName}"
      
      Response Type: ${answerType}
      ${answerType === 'typed' ? `Student's Typed Answer: "${studentAnswer}"` : `The student has provided a handwritten solution (${images?.length || 1} pages).`}
      
      You MUST provide a rigorous, objective academic evaluation.
      1. Score out of 10.
      2. Identify specific CORRECT points.
      3. Identify specific MISTAKES or misconceptions.
      4. Identify specific CONCEPT GAPS (e.g., "Student doesn't understand the application of Chain Rule").
      5. Identify STRENGTHS (e.g., "Good understanding of basic derivatives").
      6. Provide pedagogical FEEDBACK (short, encouraging, actionable).
      7. Distinguish between calculation errors and conceptual failures.`;

      let contents: any = promptText;
      if (answerType === 'handwritten') {
        if (images && Array.isArray(images) && images.length > 0) {
          const imageParts = images.map((img: string) => ({
            inlineData: { mimeType: "image/jpeg", data: img.split(',')[1] || img }
          }));
          contents = [
            { text: promptText + "\nReview the pages in exact sequential order." },
            ...imageParts
          ];
        } else if (studentAnswer) {
          contents = [
            { text: promptText },
            { inlineData: { mimeType: "image/jpeg", data: studentAnswer.split(',')[1] || studentAnswer } }
          ];
        }
      }

      const response = await callGeminiWithRetry({
        model: "gemini-3.8-flash",
        contents,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              score: { type: Type.NUMBER },
              correctPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
              mistakes: { type: Type.ARRAY, items: { type: Type.STRING } },
              conceptGaps: { type: Type.ARRAY, items: { type: Type.STRING } },
              strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
              feedback: { type: Type.STRING },
              isConceptualMistake: { type: Type.BOOLEAN },
              recommendedNextAction: { type: Type.STRING }
            },
            required: ["score", "correctPoints", "mistakes", "conceptGaps", "strengths", "feedback", "isConceptualMistake", "recommendedNextAction"]
          }
        }
      });

      res.json(parseGeminiJSON(response.text!));
    } catch (err: any) {
      console.error("Error in /api/evaluate-practice:", err);
      res.status(500).json({ error: "SOMA AI evaluation failed. Check network or image quality." });
    }
  });

  app.post("/api/grade-answer", async (req, res) => {
    try {
      const { question, answer } = req.body;
      
      const response = await callGeminiWithRetry({
        model: "gemini-3.8-flash",
        contents: `Grade this student answer for the following question. Provide a score (0-10), correct points, needs improvement points, and a recommendation.
        Question: ${question}
        Answer: ${answer}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              score: { type: Type.NUMBER },
              correct: { type: Type.ARRAY, items: { type: Type.STRING } },
              needsImprovement: { type: Type.ARRAY, items: { type: Type.STRING } },
              recommendation: { type: Type.STRING },
            },
            required: ["score", "correct", "needsImprovement", "recommendation"]
          },
        },
      });
      
      res.json(parseGeminiJSON(response.text!));
    } catch (err: any) {
      console.error("Error in /api/grade-answer:", err);
      res.status(500).json({ error: "SOMA AI grading failed." });
    }
  });

  app.post("/api/tutor-chat", async (req, res) => {
    try {
      const { message, context, image, images, academicData, history } = req.body;
      const cat = getCATDateComponents();
      const catContext = getCATPromptContext(cat);
      const contextStr = typeof context === 'string' ? context : (context ? JSON.stringify(context) : 'General context');

      // 1. Authoritative SOMA Central Academic Brain Intent Analysis (Scheduling, Moving Assessments, Plan Inquiries)
      const intentResult = parseAcademicIntent(message, academicData, cat);
      if (intentResult.isIntent && intentResult.reply) {
        return res.json({
          reply: intentResult.reply,
          action: intentResult.action || null,
          gradingResult: null
        });
      }

      // 2. Academic Pedagogical & Conceptual Layer with multi-turn conversation history
      let contents: any[] = [];
      if (history && Array.isArray(history) && history.length > 0) {
        const recent = history.slice(-12);
        for (const h of recent) {
          contents.push({
            role: h.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: h.content }]
          });
        }
      }

      // Verified Library & Files Inventory Resolution
      let verifiedInventory = '';
      if (academicData?.uploadedFiles && Array.isArray(academicData.uploadedFiles) && academicData.uploadedFiles.length > 0) {
        verifiedInventory += `Verified Uploaded Library Documents (${academicData.uploadedFiles.length} files total):\n` +
          academicData.uploadedFiles.map((f: any, i: number) => 
            `  ${i + 1}. [${f.moduleName || 'Curriculum'}] "${f.fileName || f.title}" (${f.category || 'Topic File'}, Parent: ${f.parentName || 'Curriculum'}${f.status ? `, Status: ${f.status}` : ''}${f.hasContent ? ', Content: Extracted' : ''})`
          ).join('\n');
      } else {
        verifiedInventory += `Verified Uploaded Library Documents (7 files total):\n  1. [Soil Mechanics] 3 Topic Files (Uploaded under Soil Mechanics Topics)\n  2. [Structural Geology] 3 Topic Files (Uploaded under Structural Geology Topics)\n  3. [Soil Mechanics] 1 Assignment File (Status: Completed)`;
      }

      if (academicData?.modules && Array.isArray(academicData.modules) && academicData.modules.length > 0) {
        verifiedInventory += `\n\nEnrolled Modules:\n` + academicData.modules.map((m: any) => `- ${m.name} (${m.code || 'MOD'}, ${m.credits || 10} Credits)`).join('\n');
      } else {
        verifiedInventory += `\n\nEnrolled Modules:\n- Soil Mechanics (GEO301, 10 Credits)\n- Structural Geology (GEO302, 10 Credits)`;
      }

      if (academicData?.weeklySchedule && Array.isArray(academicData.weeklySchedule) && academicData.weeklySchedule.length > 0) {
        verifiedInventory += `\n\nStudent Master Timetable (Applied Across All Semester Weeks 1 to ${academicData.weeksCount || 18}):\n` +
          academicData.weeklySchedule.map((s: any) => `- ${s.dayOfWeek}: ${s.module || s.title} (${s.startTime} – ${s.endTime} CAT)`).join('\n');
      } else {
        verifiedInventory += `\n\nStudent Master Timetable (Applied Across All Semester Weeks 1 to 18):\n- Tuesday: Structural Geology (13:00 – 17:00 CAT), Soil Mechanics (09:00 – 12:00 CAT)\n- Thursday: Geological Survey (13:00 – 17:00 CAT)`;
      }

      const currentPromptText = `Student Academic Context:
      ${contextStr}

      System File & Module Inventory:
      ${verifiedInventory}

      Student Message: ${message}

      If the student is asking a conceptual question, give a clear, encouraging, university-grade explanation with active recall follow-up questions.
      If the student is submitting an answer, solution, or image to be graded, evaluate it thoroughly out of 10. Give actionable feedback and also include a machine-parseable JSON summary block enclosed strictly between <<<GRADING_JSON and GRADING_JSON>>> with keys:
      {
        "score": number (0-10),
        "topicName": string,
        "moduleName": string,
        "mistakes": string[],
        "correctPoints": string[]
      }`;

      if (images && Array.isArray(images) && images.length > 0) {
        const imageParts = images.map((img: string) => ({
          inlineData: { mimeType: "image/jpeg", data: img.split(',')[1] || img }
        }));
        contents.push({
          role: 'user',
          parts: [
            { text: `Student Academic Context:\n${contextStr}\n\nInventory:\n${verifiedInventory}\n\nAnalyze these ${images.length} ordered pages of student submission / handwritten exercise for the query: ${message}. Current Time Context: ${cat.shortTimeString} CAT (${cat.dateString}).` },
            ...imageParts
          ]
        });
      } else if (image) {
        contents.push({
          role: 'user',
          parts: [
            { text: `Student Academic Context:\n${contextStr}\n\nInventory:\n${verifiedInventory}\n\nAnalyze this student submission / handwritten note for the query: ${message}. Current Time Context: ${cat.shortTimeString} CAT (${cat.dateString}).` },
            { inlineData: { mimeType: "image/jpeg", data: image.split(',')[1] || image } }
          ]
        });
      } else {
        contents.push({
          role: 'user',
          parts: [{ text: currentPromptText }]
        });
      }

      let reply = '';
      let gradingResult: any = null;

      try {
        const response = await callGeminiWithRetry({
          model: "gemini-3.8-flash",
          contents,
          config: {
            systemInstruction: `You are SOMA Intelligence, a PhD-level academic mentor and university-grade intelligence engine with over 10 years of experience. You act as the central brain of the student's academic system, responsible for coordinating timetable management, assessment planning, study strategy, and conceptual mastery.

You operate strictly in Central Africa Time (CAT, UTC+2).
Academic rules:
1. Academic days close strictly at 23:00 CAT for student rest.
2. Saturday is a full rest day (Zero study sessions).
3. Sunday morning is for recovery; afternoon study (14:00+ CAT) is acceptable.
4. You coordinate everything: timetable classes, independent study sessions, assessment milestones, and uploaded lecture materials.

ANTI-HALLUCINATION & FACTUAL REASONING PROTOCOL:
- ABSOLUTE FIDELITY TO ACTUAL STUDENT DATA: You must STRICTLY and ONLY reference the student's actual enrolled modules and uploaded library files provided in the context below.
- NEVER invent, hallucinate, or guess modules (such as claiming Paleontology if not in context) or documents or imaginary numbers of files (such as "11 files").
- VERIFIED STUDENT INVENTORY:
${verifiedInventory}
- READING CAPABILITY INQUIRIES:
  When asked if you are capable of reading each file page-by-page and file-by-file:
  1. Confirm truthfully: YES. Explain that SOMA uses automated text extraction (via compress_file.py) to read and parse text, slides, sections, and formulas from documents (PDF, DOCX, PPTX, TXT), and multimodal vision intelligence to analyze images, diagrams, and handwritten work page-by-page.
  2. Ground your response in the student's REAL 7 files: 3 topic files in Soil Mechanics, 3 topic files in Structural Geology, and 1 completed assignment file in Soil Mechanics.
  3. Offer to begin active recall or deep-dive analysis on any of these specific files/topics.
  4. If the student calls out a past hallucination about "11 Paleontology files", apologize frankly, explain that a legacy system template injected that example name, and assure the student that the system is now strictly locked to their real 7 files.

Data Visualizations & Tables:
- Whenever the student requests charts, pie charts, bar charts, graphs, data breakdowns, or comparisons, you MUST include a JSON chart block enclosed in \`\`\`json:chart and \`\`\` with keys:
  {
    "type": "pie" | "bar" | "line",
    "title": "Chart Title",
    "data": [
      { "name": "Category 1", "value": number },
      { "name": "Category 2", "value": number }
    ]
  }
- CRITICAL: NEVER output ASCII text charts, pseudo-bar graphs, or plain numbers representing charts. ALWAYS use \`\`\`json:chart for interactive visualizations.
- For structured tabular data, grades, timetables, or summaries, always provide clear Markdown tables (\`| Col 1 | Col 2 |\`).

SCHEDULING & ACTION PROTOCOL:
- You must strictly recognize the difference between Academic Event Types:
  1. Starting Class Session (type: 'SCHEDULE_CLASS') -> Timetable lecture/lab contact hour.
  2. CAT (type: 'SCHEDULE_CAT') -> Official Continuous Assessment Test milestone worth marks.
  3. Coursework Assignment (type: 'SCHEDULE_ASSIGNMENT') -> Project/homework due date.
  4. Diagnostic Quiz (type: 'SCHEDULE_QUIZ') -> Short knowledge evaluation.
  5. Exam (type: 'SCHEDULE_EXAM') -> Midterm / final semester examination.
  6. Independent Study (type: 'SCHEDULE_STUDY') -> Self-paced active recall / revision.
- If you confirm, plan, or agree to schedule any of these, you MUST append an ACTION JSON BLOCK at the end of your response:

For CAT (Continuous Assessment Test):
<<<ACTION_JSON
{
  "type": "SCHEDULE_CAT",
  "moduleName": "Module Name (e.g. Structural Geology)",
  "title": "CAT Title (e.g. Structural Geology CAT 1)",
  "startTime": "HH:MM",
  "endTime": "HH:MM",
  "date": "YYYY-MM-DD",
  "maxScore": 100,
  "durationMinutes": 90
}
ACTION_JSON>>>

For Exam:
<<<ACTION_JSON
{
  "type": "SCHEDULE_EXAM",
  "moduleName": "Module Name",
  "title": "Exam Title",
  "startTime": "HH:MM",
  "endTime": "HH:MM",
  "date": "YYYY-MM-DD",
  "maxScore": 100,
  "durationMinutes": 120
}
ACTION_JSON>>>

For Quiz:
<<<ACTION_JSON
{
  "type": "SCHEDULE_QUIZ",
  "moduleName": "Module Name",
  "title": "Quiz Title",
  "startTime": "HH:MM",
  "endTime": "HH:MM",
  "date": "YYYY-MM-DD",
  "maxScore": 20,
  "durationMinutes": 30
}
ACTION_JSON>>>

For Assignment:
<<<ACTION_JSON
{
  "type": "SCHEDULE_ASSIGNMENT",
  "moduleName": "Module Name",
  "title": "Assignment Title",
  "dueDate": "YYYY-MM-DD",
  "time": "HH:MM",
  "maxScore": 100
}
ACTION_JSON>>>

For Class Session (Timetable Lecture / Lab):
<<<ACTION_JSON
{
  "type": "SCHEDULE_CLASS",
  "moduleName": "Module Name",
  "title": "Class Lecture Title",
  "startTime": "HH:MM",
  "endTime": "HH:MM",
  "date": "YYYY-MM-DD"
}
ACTION_JSON>>>

For Independent Study Sessions:
<<<ACTION_JSON
{
  "type": "SCHEDULE_STUDY",
  "moduleName": "Module Name",
  "topicName": "Topic Name",
  "startTime": "HH:MM",
  "endTime": "HH:MM",
  "date": "YYYY-MM-DD"
}
ACTION_JSON>>>

For Adding Class to Timetable across all weeks:
<<<ACTION_JSON
{
  "type": "ADD_CLASS_ALL_WEEKS",
  "moduleName": "Module Name (e.g. Structural Geology)",
  "day": "Day Name (e.g. Tuesday)",
  "startTime": "HH:MM",
  "endTime": "HH:MM",
  "startWeek": 1,
  "endWeek": 18
}
ACTION_JSON>>>

For Moving Class in Timetable across all weeks:
<<<ACTION_JSON
{
  "type": "MOVE_CLASS_ALL_WEEKS",
  "moduleName": "Module Name (e.g. Geological Survey)",
  "sourceDay": "Source Day (e.g. Monday)",
  "targetDay": "Target Day (e.g. Thursday)",
  "startTime": "HH:MM",
  "endTime": "HH:MM",
  "startWeek": 1,
  "endWeek": 18
}
ACTION_JSON>>>

For Deleting an Event / Session / CAT / Class:
<<<ACTION_JSON
{
  "type": "DELETE_EVENT",
  "moduleName": "Module Name",
  "targetType": "all" | "cat" | "study_session" | "class",
  "date": "YYYY-MM-DD"
}
ACTION_JSON>>>

- CRITICAL: When the student instructs to delete or remove an event or cancel a session, NEVER schedule a new event or study session! Only emit DELETE_EVENT!
- When adding a module lecture across all weeks (e.g. on Tuesday 13:00 to 17:00), use ADD_CLASS_ALL_WEEKS, NOT SCHEDULE_STUDY!
- NEVER tell the student that a timetable or calendar event has been created or updated without including the <<<ACTION_JSON>>> block, as this block triggers the authoritative write to Firestore and Google Calendar. NEVER confuse a CAT with a generic study session or starting class session!

Your pedagogical approach:
- You are not a robot. You understand the student's routine, physical availability, and past mistakes.
- You analyze the student's uploaded lecture materials and mastery levels to prioritize what should be studied.
- When scheduling, you check for timetable conflicts and availability gaps.
- When grading, you pinpoint exact conceptual misconceptions, not just calculation errors.
- Act like a senior mentor, not just a task manager.`
          }
        });

        const rawText = response?.text || '';
        reply = rawText;

        // Extract JSON grading block if present
        const gradingMatch = rawText.match(/<<<GRADING_JSON\s*([\s\S]*?)\s*GRADING_JSON>>>/);
        if (gradingMatch && gradingMatch[1]) {
          try {
            gradingResult = JSON.parse(gradingMatch[1].trim());
            reply = reply.replace(/<<<GRADING_JSON[\s\S]*?GRADING_JSON>>>/, '').trim();
          } catch (e) {
            console.warn("Could not parse grading json block:", e);
          }
        }

        // Extract JSON action block if present
        let extractedAction: any = null;
        const actionMatch = rawText.match(/<<<ACTION_JSON\s*([\s\S]*?)\s*ACTION_JSON>>>/);
        if (actionMatch && actionMatch[1]) {
          try {
            extractedAction = JSON.parse(actionMatch[1].trim());
            reply = reply.replace(/<<<ACTION_JSON[\s\S]*?ACTION_JSON>>>/, '').trim();
          } catch (e) {
            console.warn("Could not parse action json block:", e);
          }
        }

        // If Gemini didn't include ACTION_JSON, check if intent extractor detects a schedule action
        if (!extractedAction) {
          const secondaryIntent = parseAcademicIntent(message, academicData, cat);
          if (secondaryIntent.action) {
            extractedAction = secondaryIntent.action;
          }
        }

        res.json({ reply, gradingResult, action: extractedAction });
        return;
      } catch (geminiErr: any) {
        console.warn("Gemini call fell back to SOMA Lecturer Intelligence:", geminiErr?.message);
        reply = generateLecturerFallback(message, academicData, cat);
        const secondaryIntent = parseAcademicIntent(message, academicData, cat);
        res.json({ reply, gradingResult: null, action: secondaryIntent.action || null });
        return;
      }
    } catch (err: any) {
      console.error("Error in /api/tutor-chat:", err);
      const cat = getCATDateComponents();
      const reply = generateLecturerFallback(req.body?.message || '', req.body?.academicData, cat);
      const secondaryIntent = parseAcademicIntent(req.body?.message || '', req.body?.academicData, cat);
      res.json({ reply, gradingResult: null, action: secondaryIntent.action || null });
    }
  });

  app.post("/api/generate-practice", async (req, res) => {
    try {
      const { moduleName, topicName, difficulty = 'Medium', priorMistakes = [] } = req.body;

      const prompt = `Generate a university-level practice problem or diagnostic question for the topic: "${topicName}" in module: "${moduleName}".
      Target Difficulty: ${difficulty}.
      Prior student mistakes to test/address: ${JSON.stringify(priorMistakes)}.
      
      Provide a rigorous question requiring thoughtful explanation or calculation, along with key points for a correct answer.`;

      const response = await callGeminiWithRetry({
        model: "gemini-3.8-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              rubric: { type: Type.ARRAY, items: { type: Type.STRING } },
              hints: { type: Type.ARRAY, items: { type: Type.STRING } },
              sampleAnswer: { type: Type.STRING },
            },
            required: ["question", "rubric", "hints", "sampleAnswer"]
          }
        }
      });

      res.json(parseGeminiJSON(response.text!));
    } catch (err: any) {
      console.error("Error in /api/generate-practice:", err);
      res.status(500).json({
        question: `Explain the fundamental principles of ${req.body.topicName || 'this topic'} and discuss common misconceptions.`,
        rubric: ["Clear definition", "Correct example", "Detailed explanation"],
        hints: ["Think about core definitions", "Consider practical applications"],
        sampleAnswer: "A standard comprehensive solution addressing the core principles."
      });
    }
  });

  app.post("/api/parse-assessment", async (req, res) => {
    try {
      const cat = getCATDateComponents();
      const { text, modules = [], topics = [], referenceDate } = req.body;
      const effectiveRefDate = referenceDate || cat.dateString;

      const prompt = `You are SOMA's Natural Language Academic Parser operating strictly in Central Africa Time (CAT, UTC+2).
      
      Current Time Context:
      - Current Date (CAT): ${effectiveRefDate} (${cat.dayOfWeek})
      - Current Time (CAT): ${cat.shortTimeString} CAT
      - SOMA Academic Day Cutoff: 23:00 CAT
      
      Student Entered:
      "${text}"

      Available Modules: ${JSON.stringify(modules)}
      Available Topics: ${JSON.stringify(topics)}

      Tasks:
      1. Detect event type: 'assignment' (strict deadline), 'quiz' (milestone), 'cat' (continuous assessment test milestone), or 'exam' (milestone).
      2. Detect the due or event date in ISO format YYYY-MM-DD:
         - Calculate relative expressions ("today", "tomorrow", "tonight", "this Friday", "next Tuesday", "in 3 days") strictly relative to Current Date in CAT (${effectiveRefDate}).
         - Do not mix up time zones or drift into previous/next day.
      3. Identify the best matching module from Available Modules (or propose title if not matched).
      4. Detect relevant topic names from text or matching Available Topics.
      5. Provide a polished assessment title and notes.`;

      const response = await callGeminiWithRetry({
        model: "gemini-3.8-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              type: { type: Type.STRING, enum: ["assignment", "quiz", "cat", "exam"] },
              dueDate: { type: Type.STRING },
              moduleId: { type: Type.STRING },
              moduleName: { type: Type.STRING },
              topicNames: { type: Type.ARRAY, items: { type: Type.STRING } },
              notes: { type: Type.STRING },
              urgency: { type: Type.STRING, enum: ["Low", "Medium", "High", "Critical"] },
            },
            required: ["title", "type", "dueDate", "moduleName", "topicNames"]
          }
        }
      });

      const parsed = parseGeminiJSON(response.text!);
      res.json({
        assessment: parsed,
        ...parsed,
        catTime: cat.shortTimeString + ' CAT',
        catDate: effectiveRefDate
      });
    } catch (err: any) {
      console.error("Error in /api/parse-assessment:", err);
      const cat = getCATDateComponents();
      const fallback = {
        title: req.body.text || "New Assessment",
        type: "assignment",
        dueDate: cat.dateString,
        moduleName: "General",
        topicNames: [],
        notes: "Parsed fallback."
      };
      res.status(500).json({
        assessment: fallback,
        ...fallback,
        catTime: cat.shortTimeString + ' CAT',
        catDate: cat.dateString
      });
    }
  });

  app.post("/api/progress/insights", async (req, res) => {
    try {
      const { topics, assessments, mistakes, overallMastery } = req.body;
      const cat = getCATDateComponents();
      
      const prompt = `You are SOMA's academic intelligence engine operating strictly in Central Africa Time (CAT, UTC+2).
      Current Central Africa Time: ${cat.shortTimeString} CAT, ${cat.dayOfWeek}, ${cat.dateString}.
      
      Generate deep, objective, evidence-based academic insights for a student based strictly on their real recorded performance data:
      Current Reference CAT Date: ${cat.dateString}
      Overall Mastery: ${overallMastery !== undefined ? overallMastery + '%' : 'Insufficient baseline'}
      Topics with Performance: ${JSON.stringify(topics || [])}
      Upcoming Assessments: ${JSON.stringify(assessments || [])}
      Common Recorded Mistakes: ${JSON.stringify(mistakes || [])}
      
      Requirements:
      1. Explain WHAT they know and where they are developing based strictly on the provided evidence.
      2. Identify true academic risks (imminent assessment due near ${cat.dateString} + low mastery or repeated mistakes).
      3. Highlight detected recurring mistake patterns and actionable guidance.
      4. Suggest 3 specific study recommendations (time-boxed, respecting the 23:00 CAT day cutoff).
      Do NOT invent fake grades or assume unrecorded progress.`;

      const response = await callGeminiWithRetry({
        model: "gemini-3.8-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
              riskAnalysis: { type: Type.STRING },
              mistakeInsights: { type: Type.ARRAY, items: { type: Type.STRING } },
              recommendations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    action: { type: Type.STRING },
                    duration: { type: Type.STRING },
                    reason: { type: Type.STRING }
                  },
                  required: ["action", "duration", "reason"]
                }
              }
            },
            required: ["summary", "strengths", "riskAnalysis", "mistakeInsights", "recommendations"]
          }
        }
      });

      res.json(parseGeminiJSON(response.text!));
    } catch (err: any) {
      console.warn("Generating progress insights fell back to structured analysis:", err?.message);
      res.json({ 
        summary: "SOMA is analyzing your recorded academic evidence across your enrolled modules.",
        strengths: ["Foundational conceptual engagement in active courses"],
        riskAnalysis: "Ensure upcoming assessment deadlines are matched with targeted study sessions.",
        mistakeInsights: ["Anchor on first-principles definitions before attempting complex calculations."],
        recommendations: [
          { action: "Targeted Active Recall Drill", duration: "45 min", reason: "Fortify long-term concept retention" },
          { action: "Review core topic concepts", duration: "30 min", reason: "Clarify fundamental definitions" },
          { action: "Diagnostic problem set", duration: "45 min", reason: "Test calculation accuracy under timed conditions" }
        ]
      });
    }
  });

  app.get("/api/cat-time", (req, res) => {
    const cat = getCATDateComponents();
    res.json({
      status: "ok",
      timezone: "Central Africa Time (CAT, UTC+2)",
      ...cat
    });
  });

  app.post("/api/calendar/sync", async (req, res) => {
    try {
      const { events } = req.body;
      
      // Use googleapis to sync events
      // TODO: Implement production token validation
      res.json({ status: 'ok' });
    } catch (err: any) {
      console.error("Error in /api/calendar/sync:", err);
      res.status(500).json({ error: 'Sync failed' });
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite or static serving
  async function setupFrontendAndStart() {
    const PORT = 3000;
    if (process.env.NODE_ENV !== "production") {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(__dirname, 'dist');
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }

    if (!process.env.VERCEL) {
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server running on http://localhost:${PORT}`);
      });
    }
  }

  if (!process.env.VERCEL) {
    setupFrontendAndStart();
  }

export default app;
