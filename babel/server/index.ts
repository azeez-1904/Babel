import 'dotenv/config';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import Anthropic from '@anthropic-ai/sdk';
import twilio from 'twilio';
import {
  appendTranscript,
  getArchive,
  getLessonFromArchive,
  mergeTechnicalNotes,
  normalizeRoomCode,
  saveLesson,
  saveSummary,
  type LessonCache,
  type LessonPhrase,
  type RoomArchive,
  type RoomSummary,
  type TechnicalNote,
  type TranscriptTranslation,
} from './roomArchive';

const HOST = process.env.HOST ?? '0.0.0.0';
const PORT = parseInt(process.env.PORT ?? '8080');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const twilioClient = (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

// ─── Types ────────────────────────────────────────────────────────────────────

interface BabelClient {
  ws: WebSocket;
  userId: string;
  room?: string;
  lang?: string;
  isDevice?: boolean;
}

interface SmsClient {
  phone: string;
  room: string;
  lang: string;
  userId: string;
}

type State = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

interface JoinRoomMsg    { type: 'join_room';     room_code: string; user_lang: string; is_device?: boolean }
interface UtteranceMsg   { type: 'utterance';     original_text: string }
interface StateChangeMsg { type: 'state_change';  state: State }
interface DevicePingMsg  { type: 'device_ping';   device_id: string }
interface RequestPeersMsg{ type: 'request_peers' }
interface UpdateLangMsg  { type: 'update_lang';   lang: string }
interface JoinSoloMsg    { type: 'join_solo';     native_lang: string; target_lang: string }
interface SoloUtteranceMsg { type: 'solo_utterance'; original_text: string; attempted_target?: boolean }
interface SoloEndMsg     { type: 'solo_end' }
interface SoloRequestPromptMsg { type: 'solo_request_prompt' }
type IncomingMsg = JoinRoomMsg | UtteranceMsg | StateChangeMsg | DevicePingMsg | RequestPeersMsg | UpdateLangMsg | JoinSoloMsg | SoloUtteranceMsg | SoloEndMsg | SoloRequestPromptMsg;

interface TranslationResult {
  source_lang: string;
  translated_text: string;
  cleaned_original: string;
  distress_flag: boolean;
  tone_note: string;
}

interface TechnicalAnalysisResult {
  technical_notes: Omit<TechnicalNote, 'id' | 'created_at'>[];
  remove_note_ids?: string[];
}

interface SummaryResult {
  simple_summary: string;
  key_points: string[];
  suggested_follow_up_questions: string[];
}

// ─── Solo session types ──────────────────────────────────────────────────────

interface SoloExchange {
  userText: string;
  attemptedTarget: boolean;
  response: SoloTutorResult;
}

interface SoloSession {
  userId: string;
  nativeLang: string;
  targetLang: string;
  exchanges: SoloExchange[];
  allVocab: SoloVocabCard[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  recentPrompts: string[];
}

interface SoloVocabCard {
  word: string;
  phonetic: string;
  translation: string;
  example_sentence: string;
  example_translation: string;
}

interface SoloTutorResult {
  translation: string;
  phonetic: string;
  correction?: string;
  correction_note?: string;
  encouragement: string;
  vocab_cards: SoloVocabCard[];
  suggested_reply: string;
  suggested_reply_translation: string;
  suggested_reply_phonetic: string;
  difficulty_level: 'beginner' | 'intermediate' | 'advanced';
}

interface SoloSummaryResult {
  total_exchanges: number;
  words_learned: SoloVocabCard[];
  phrases_practiced: string[];
  tips: string[];
}

// ─── State ────────────────────────────────────────────────────────────────────

const clients = new Map<string, BabelClient>();
const rooms = new Map<string, Set<string>>();
const soloSessions = new Map<string, SoloSession>();
const smsClients = new Map<string, SmsClient>(); // phone → SmsClient
const smsUserIds = new Map<string, string>();    // userId → phone

let userCounter = 0;
function nextId() { return `u${++userCounter}`; }

function roomOf(userId: string) {
  const c = clients.get(userId);
  return c?.room ? rooms.get(c.room) ?? null : null;
}

function broadcast(room: Set<string>, payload: object, exclude?: string) {
  const data = JSON.stringify(payload);
  for (const uid of room) {
    if (uid === exclude) continue;
    const c = clients.get(uid);
    if (c?.ws.readyState === WebSocket.OPEN) c.ws.send(data);
  }
}

function broadcastHumans(room: Set<string>, payload: object) {
  const data = JSON.stringify(payload);
  for (const uid of room) {
    const c = clients.get(uid);
    if (!c || c.isDevice || c.ws.readyState !== WebSocket.OPEN) continue;
    c.ws.send(data);
  }
}

function broadcastPeers(roomCode: string) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const peers = [...room].map(uid => {
    const c = clients.get(uid);
    if (c) return { userId: uid, lang: c.lang ?? '', isDevice: c.isDevice ?? false };
    const phone = smsUserIds.get(uid);
    const sms = phone ? smsClients.get(phone) : null;
    if (sms) return { userId: uid, lang: sms.lang, isDevice: false };
    return null;
  }).filter(Boolean);
  broadcast(room, { type: 'peers_update', peers });
}

function send(client: BabelClient, payload: object) {
  if (client.ws.readyState === WebSocket.OPEN)
    client.ws.send(JSON.stringify(payload));
}

async function sendSms(to: string, body: string) {
  if (!twilioClient || !process.env.TWILIO_PHONE_NUMBER) {
    console.log(`[SMS] (no Twilio) → ${to}: ${body.slice(0, 80)}`);
    return;
  }
  const from = process.env.TWILIO_PHONE_NUMBER;
  // WhatsApp sandbox: prefix recipient number with whatsapp:
  const toAddr = from.startsWith('whatsapp:') && !to.startsWith('whatsapp:')
    ? `whatsapp:${to}`
    : to;
  try {
    await twilioClient.messages.create({ from, to: toAddr, body });
  } catch (err) {
    console.error(`[SMS] Failed to send to ${to}:`, err);
  }
}

// ─── Language code → human name ──────────────────────────────────────────────

const LANG_NAMES: Record<string, string> = {
  'en-US': 'English',    'en-GB': 'English',
  'es-ES': 'Spanish',    'es-MX': 'Spanish',
  'fr-FR': 'French',     'de-DE': 'German',
  'zh-CN': 'Mandarin Chinese', 'zh-TW': 'Traditional Chinese',
  'ja-JP': 'Japanese',   'ko-KR': 'Korean',
  'pt-BR': 'Brazilian Portuguese', 'pt-PT': 'European Portuguese',
  'ar-SA': 'Arabic',     'hi-IN': 'Hindi',
  'it-IT': 'Italian',    'ru-RU': 'Russian',
  'nl-NL': 'Dutch',      'pl-PL': 'Polish',
  'tr-TR': 'Turkish',    'sv-SE': 'Swedish',
  'da-DK': 'Danish',     'fi-FI': 'Finnish',
  'nb-NO': 'Norwegian',  'he-IL': 'Hebrew',
  'vi-VN': 'Vietnamese', 'th-TH': 'Thai',
};

function langName(code: string): string {
  return LANG_NAMES[code] ?? code;
}

// ─── Translation ──────────────────────────────────────────────────────────────

function parseClaudeJson<T>(text: string) {
  const raw = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(raw) as T;
}

async function translate(text: string, targetLang: string): Promise<TranslationResult> {
  const targetLangName = langName(targetLang);
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: `You are a professional real-time spoken-word interpreter. Your ONLY job is to translate speech into a completely different language, safely and accurately.

CRITICAL RULES:
- Output the text ENTIRELY in the target language. Every word must be in that language.
- Do NOT modify the source words with accents or diacritics. That is NOT translation.
- Do NOT keep any English words (or source language words) in your output unless they are proper nouns with no equivalent.
- Example: translating "hello how are you" to Spanish → WRONG: "héllo hów áre yöu" | CORRECT: "hola ¿cómo estás?"
- Preserve tone, register, and natural phrasing — do not make it stilted or word-for-word literal
- Preserve dialect, AAVE, code-switching, and cultural expression — never flatten them
- Auto-detect the source language

CONTENT SAFETY (apply to BOTH original and translation):
- Replace profanity and slurs with neutral equivalents that preserve meaning (e.g. "fuck you" → "screw you", "what the f***" → "what the heck")
- Explicit sexual language → clinical/neutral terms
- Hate speech or slurs → neutral descriptor with same sentiment
- Graphic violent threats → softened equivalents
- Keep emotional tone intact — just remove the explicit wording
- cleaned_original is the SFW version of the INPUT text in its original language

DISTRESS DETECTION:
- If any of these appear: chest pain, can't breathe, emergency, help me, I'm dying, stroke, heart attack, choking, seizure, unconscious → set distress_flag to true

- Return ONLY valid JSON — no markdown fences, no explanation

Response schema (JSON only):
{"source_lang":"<detected language name>","translated_text":"<full SFW translation in target language>","cleaned_original":"<SFW version of the original input text>","distress_flag":false,"tone_note":"<casual|formal|urgent|warm|playful>"}`,
    messages: [{ role: 'user', content: `Translate the following into ${targetLangName}. Write the entire response in ${targetLangName}.\n\n"${text}"` }],
  });

  const content = msg.content[0];
  if (content.type !== 'text') throw new Error('Unexpected Claude response type');
  return parseClaudeJson<TranslationResult>(content.text);
}

function recentContextForNotes(archive: RoomArchive) {
  return archive.transcript
    .slice(-8)
    .map(entry => `${entry.from_user} (${entry.source_lang}): ${entry.original_text}`)
    .join('\n');
}

async function analyzeTechnicalLanguage(text: string, archive: RoomArchive): Promise<TechnicalAnalysisResult> {
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1100,
    system: `You create high-quality technical notes for people in a live conversation.

Rules:
- Use the full recent conversation context, not just the latest sentence.
- Only create a note when it would genuinely help a normal person understand the conversation.
- Do NOT create notes for greetings, casual chat, song lyrics, ordinary words, or terms already explained well by an existing note.
- Speech recognition may mishear technical terms. Correct obvious mistakes using context before creating a note.
- If an earlier phrase conflicts with later context, prefer the interpretation that makes technical sense. Example: "GPS pins" near ESP32, input/output, sensors, or device control should be treated as "GPIO pins"; do not make a GPS note unless location/navigation is clearly discussed.
- The "phrase" should be the corrected technical phrase users should remember.
- "simple_explanation" should explain the term plainly.
- "conversation_context" should explain what that term means in THIS conversation specifically.
- "why_it_matters" should say why this concept matters for the user's situation, not a generic dictionary reason.
- Suggest practical follow-up questions that fit this conversation.
- Some terms have multiple technical meanings across domains. If the recent context does not clearly choose one, briefly mention the plausible meanings in simple_explanation and ask a clarification question. Example: "transformer" could mean an electrical device that changes voltage, or an AI/neural network architecture; ask which one they mean.
- If context clearly chooses one meaning, explain that meaning but you may briefly note the other common meaning only if it would prevent confusion.
- If an existing note is wrong, generic, stale, duplicated, or based on a misheard term disproven by later context, include its id in remove_note_ids.
- If the correct meaning is uncertain and there are not clear plausible meanings, return no note instead of guessing.
- Prefer 0 or 1 excellent note per utterance. Return at most 2.
- Confidence must be 0.7 or higher for any emitted note.
- Do not give professional medical, legal, financial, or safety advice.
- Return ONLY valid JSON — no markdown, no explanation, no surrounding text.

Response schema:
{"technical_notes":[{"phrase":"<corrected technical phrase>","simple_explanation":"<simple meaning>","conversation_context":"<what it means in this conversation>","why_it_matters":"<why it matters here>","follow_up_questions":["<question>"],"confidence":0.85,"source_text":"<source utterance>"}],"remove_note_ids":["<existing note id to remove>"]}`,
    messages: [{
      role: 'user',
      content: `Latest utterance:\n"${text}"\n\nRecent transcript:\n${recentContextForNotes(archive)}\n\nExisting notes:\n${JSON.stringify(archive.technical_notes.slice(-10))}`,
    }],
  });

  const content = msg.content[0];
  if (content.type !== 'text') throw new Error('Unexpected Claude response type');
  const result = parseClaudeJson<TechnicalAnalysisResult>(content.text);
  return {
    technical_notes: (result.technical_notes ?? [])
      .filter(note => note.phrase && note.simple_explanation && Number(note.confidence) >= 0.7)
      .slice(0, 2)
      .map(note => ({
        phrase: String(note.phrase).slice(0, 120),
        simple_explanation: String(note.simple_explanation).slice(0, 500),
        conversation_context: String(note.conversation_context ?? '').slice(0, 500),
        why_it_matters: String(note.why_it_matters ?? '').slice(0, 500),
        follow_up_questions: (note.follow_up_questions ?? []).map(String).filter(Boolean).slice(0, 3),
        confidence: Math.max(0, Math.min(1, Number(note.confidence) || 0)),
        source_text: String(note.source_text || text).slice(0, 1000),
      })),
    remove_note_ids: (result.remove_note_ids ?? []).map(String).filter(Boolean).slice(0, 10),
  };
}

function transcriptForPrompt(archive: RoomArchive) {
  return archive.transcript
    .slice(-30)
    .map(entry => {
      const translations = entry.translations
        .map(t => `${langName(t.target_lang)}: ${t.translated_text}`)
        .join('\n');
      return `${new Date(entry.timestamp).toISOString()} ${entry.from_user} (${entry.source_lang}): ${entry.original_text}${translations ? `\nTranslations:\n${translations}` : ''}`;
    })
    .join('\n\n');
}

async function generateRoomSummary(archive: RoomArchive, targetLang: string): Promise<RoomSummary> {
  const targetLangName = langName(targetLang);
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1200,
    system: `Summarize a multilingual conversation in simple language for the person reading it.

Rules:
- Write the entire response in ${targetLangName}.
- Write for a normal person with little or no technical background.
- Explain important technical concepts inside the summary and key points using plain everyday language.
- If a concept has to be named, briefly define it the first time it appears.
- Avoid unexplained jargon, acronyms, and specialist shorthand.
- Produce a logically correct summary, not a raw transcript recap.
- Speech recognition may mishear technical terms. Resolve likely misheard words using the full conversation context.
- If an earlier word conflicts with later context, prefer the interpretation that makes technical sense. Example: if "GPS pins" appears near "ESP32", "input/output", "control devices", or "GPIO", summarize it as GPIO pins and do not mention GPS unless location/navigation was clearly discussed.
- Do not preserve contradictions, impossible claims, or obvious transcription mistakes in the summary. Correct them silently when context is strong.
- If the correct meaning is uncertain, say it was unclear instead of presenting a questionable fact.
- Do not invent new facts beyond the conversation.
- Do not include follow-up questions. This summary is read after the meeting is done.
- If the conversation includes professional topics like medical, legal, or financial issues, do not give advice; suggest questions to ask a qualified professional.
- Return ONLY valid JSON — no markdown, no surrounding text.

Response schema:
{"simple_summary":"<short plain-language paragraph that explains technical concepts>","key_points":["<plain-language point with any needed concept explained>"],"suggested_follow_up_questions":[]}`,
    messages: [{
      role: 'user',
      content: `Room code: ${archive.room_code}\n\nTranscript:\n${transcriptForPrompt(archive)}\n\nTechnical notes already detected:\n${JSON.stringify(archive.technical_notes.slice(-12))}`,
    }],
  });

  const content = msg.content[0];
  if (content.type !== 'text') throw new Error('Unexpected Claude response type');
  const result = parseClaudeJson<SummaryResult>(content.text);
  return {
    room_code: archive.room_code,
    language: targetLang,
    simple_summary: String(result.simple_summary || 'No summary is available yet.'),
    key_points: (result.key_points ?? []).map(String).filter(Boolean).slice(0, 8),
    suggested_follow_up_questions: [],
    updated_at: Date.now(),
    transcript_count: archive.transcript.length,
  };
}

async function getSummaryForLanguage(archive: RoomArchive, targetLang: string) {
  return archive.summaries?.[targetLang] ?? null;
}

// ─── Lesson generation ────────────────────────────────────────────────────────

interface LessonResult {
  phrases: Omit<LessonPhrase, 'id'>[];
}

async function generateLesson(archive: RoomArchive, userLang: string, targetLang: string): Promise<LessonCache> {
  const userLangName = langName(userLang);
  const targetLangName = langName(targetLang);

  const transcript = archive.transcript
    .slice(-40)
    .map(e => `${e.from_user} (${e.source_lang}): ${e.original_text}`)
    .join('\n');

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1500,
    system: `You are a language learning assistant. Extract 5-10 key phrases from a conversation transcript that would be most useful for a ${userLangName} speaker to learn in ${targetLangName}.

Rules:
- Focus on phrases spoken in ${targetLangName} (or the target language) from the transcript.
- If the conversation was between two different languages, pick phrases from the language the user wants to learn (${targetLangName}).
- For each phrase provide: the original phrase, a romanized phonetic pronunciation guide readable by a ${userLangName} speaker, a natural translation in ${userLangName}, a category, a one-line context note, and a difficulty level.
- Categories: greeting, question, technical, common_response, expression
- Difficulty: beginner (everyday), intermediate (situational), advanced (nuanced/idiomatic)
- Phonetic guide should use the script familiar to ${userLangName} speakers (Latin alphabet for English speakers, etc.)
- Keep translations natural, not literal word-for-word.
- If there are not enough phrases in the target language, extract useful phrases and provide their ${targetLangName} equivalents.
- Return ONLY valid JSON — no markdown fences, no explanation.

Response schema:
{"phrases":[{"original":"<phrase in target language>","phonetic":"<pronunciation guide>","translation":"<meaning in user language>","category":"<greeting|question|technical|common_response|expression>","context":"<when/how it was used>","difficulty":"<beginner|intermediate|advanced>"}]}`,
    messages: [{
      role: 'user',
      content: `Generate a lesson for a ${userLangName} speaker learning ${targetLangName} from this conversation:\n\n${transcript}`,
    }],
  });

  const content = msg.content[0];
  if (content.type !== 'text') throw new Error('Unexpected Claude response type');
  const result = parseClaudeJson<LessonResult>(content.text);

  const now = Date.now();
  const phrases: LessonPhrase[] = (result.phrases ?? [])
    .filter(p => p.original && p.translation)
    .slice(0, 10)
    .map((p, i) => ({
      id: `${now}-${i}`,
      original: String(p.original),
      phonetic: String(p.phonetic || ''),
      translation: String(p.translation),
      category: (['greeting', 'question', 'technical', 'common_response', 'expression'].includes(p.category) ? p.category : 'expression') as LessonPhrase['category'],
      context: String(p.context || ''),
      difficulty: (['beginner', 'intermediate', 'advanced'].includes(p.difficulty) ? p.difficulty : 'beginner') as LessonPhrase['difficulty'],
    }));

  const lesson: LessonCache = {
    room_code: archive.room_code,
    source_lang: userLang,
    target_lang: targetLang,
    phrases,
    created_at: now,
  };

  await saveLesson(archive.room_code, lesson);
  return lesson;
}

async function handleLessonRequest(roomCode: string, userLang: string, targetLang: string) {
  const archive = await getArchive(roomCode);
  if (!archive || archive.transcript.length === 0) return null;

  const cached = getLessonFromArchive(archive, userLang, targetLang);
  if (cached) return cached;

  return generateLesson(archive, userLang, targetLang);
}

async function generateAndSaveSummary(archive: RoomArchive, targetLang: string) {
  const summary = await generateRoomSummary(archive, targetLang);
  return saveSummary(archive.room_code, targetLang, summary);
}

async function broadcastLocalizedSummaries(roomCode: string, room: Set<string>, archive: RoomArchive) {
  const summariesByLang = new Map<string, RoomSummary>();

  for (const uid of room) {
    const client = clients.get(uid);
    if (!client || client.isDevice || client.ws.readyState !== WebSocket.OPEN) continue;

    const lang = client.lang ?? 'en-US';
    let summary = summariesByLang.get(lang);
    if (!summary) {
      summary = await generateAndSaveSummary(archive, lang);
      summariesByLang.set(lang, summary);
    }

    send(client, { type: 'summary_update', room_code: roomCode, summary });
  }
}

async function analyzeAndBroadcast(roomCode: string, text: string) {
  try {
    const room = rooms.get(roomCode);
    if (!room) return;

    const archive = await getArchive(roomCode);
    if (!archive) return;

    const analysis = await analyzeTechnicalLanguage(text, archive);
    if (analysis.technical_notes.length > 0 || (analysis.remove_note_ids?.length ?? 0) > 0) {
      const updatedArchive = await mergeTechnicalNotes(roomCode, analysis.technical_notes, analysis.remove_note_ids ?? []);
      broadcastHumans(room, {
        type: 'technical_notes_update',
        room_code: updatedArchive.room_code,
        technical_notes: updatedArchive.technical_notes,
        follow_up_questions: updatedArchive.follow_up_questions,
      });
    }

    const updatedArchive = await getArchive(roomCode);
    if (updatedArchive && updatedArchive.transcript.length >= 2 && updatedArchive.transcript.length % 3 === 0) {
      await broadcastLocalizedSummaries(roomCode, room, updatedArchive);
    }
  } catch (err) {
    console.error(`[room ${roomCode}] technical analysis error:`, err);
  }
}

// ─── Solo Practice ────────────────────────────────────────────────────────────

async function soloTutor(session: SoloSession, text: string, attemptedTarget: boolean): Promise<SoloTutorResult> {
  const nativeName = langName(session.nativeLang);
  const targetName = langName(session.targetLang);

  const historyLines = session.exchanges.slice(-10).map((ex, i) =>
    `Turn ${i + 1}:\nUser: "${ex.userText}"${ex.attemptedTarget ? ' (attempted target language)' : ''}\nTutor translation: "${ex.response.translation}"\nTutor phonetic: "${ex.response.phonetic}"${ex.response.correction ? `\nCorrection: "${ex.response.correction}" — ${ex.response.correction_note}` : ''}`
  ).join('\n\n');

  const exchangeCount = session.exchanges.length;
  const difficultyHint = exchangeCount < 5 ? 'beginner' : exchangeCount < 12 ? 'intermediate' : 'advanced';

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1000,
    system: `You are a friendly, encouraging language tutor helping a ${nativeName} speaker learn ${targetName}.

Current difficulty target: ${difficultyHint}. Exchanges so far: ${exchangeCount}.

Rules:
- Translate the user's text into ${targetName}.
- Provide a romanized phonetic pronunciation guide readable by a ${nativeName} speaker.
- If the user attempted to speak in ${targetName} (attempted_target=true), check for errors and provide a corrected version with a brief, kind explanation. If they got it right, congratulate them.
- Give a short encouraging comment (1 sentence).
- Provide 2-3 vocabulary cards with words from this exchange that are useful to learn. Each card has: word (in ${targetName}), phonetic, translation (in ${nativeName}), example_sentence (in ${targetName}), example_translation (in ${nativeName}).
- Suggest a reply the user could try saying next in ${targetName}, with translation and phonetic guide.
- Difficulty level: ${difficultyHint}. For beginner, use simple everyday phrases. For intermediate, use situational and slightly complex structures. For advanced, introduce idioms and nuanced expressions.
- Do not include vocabulary the user has already learned: ${JSON.stringify(session.allVocab.map(v => v.word).slice(-30))}
- Return ONLY valid JSON — no markdown fences, no explanation.

Response schema:
{"translation":"<text in ${targetName}>","phonetic":"<pronunciation guide>","correction":"<corrected version if attempted_target, else omit>","correction_note":"<brief explanation if corrected, else omit>","encouragement":"<short positive comment>","vocab_cards":[{"word":"<${targetName}>","phonetic":"<guide>","translation":"<${nativeName}>","example_sentence":"<${targetName}>","example_translation":"<${nativeName}>"}],"suggested_reply":"<phrase in ${targetName}>","suggested_reply_translation":"<in ${nativeName}>","suggested_reply_phonetic":"<guide>","difficulty_level":"${difficultyHint}"}`,
    messages: [{
      role: 'user',
      content: `${historyLines ? `Conversation history:\n${historyLines}\n\n` : ''}User says: "${text}"${attemptedTarget ? '\n(The user attempted to speak in the target language)' : ''}`,
    }],
  });

  const content = msg.content[0];
  if (content.type !== 'text') throw new Error('Unexpected Claude response type');
  return parseClaudeJson<SoloTutorResult>(content.text);
}

async function generateSoloSummary(session: SoloSession): Promise<SoloSummaryResult> {
  const nativeName = langName(session.nativeLang);
  const targetName = langName(session.targetLang);

  const exchangeLog = session.exchanges.map((ex, i) =>
    `${i + 1}. User: "${ex.userText}" → ${targetName}: "${ex.response.translation}"${ex.response.correction ? ` (corrected: "${ex.response.correction}")` : ''}`
  ).join('\n');

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1000,
    system: `Summarize a solo language practice session for a ${nativeName} speaker learning ${targetName}. Write your response in ${nativeName}.

Return:
- total_exchanges: number of turns
- words_learned: the most important vocabulary cards from the session (up to 10)
- phrases_practiced: list of key ${targetName} phrases the user encountered (up to 8)
- tips: 2-3 practical study tips based on what the user practiced

Return ONLY valid JSON — no markdown fences.

Response schema:
{"total_exchanges":<number>,"words_learned":[{"word":"<${targetName}>","phonetic":"<guide>","translation":"<${nativeName}>","example_sentence":"<${targetName}>","example_translation":"<${nativeName}>"}],"phrases_practiced":["<phrase>"],"tips":["<tip>"]}`,
    messages: [{
      role: 'user',
      content: `Session log (${session.exchanges.length} exchanges):\n${exchangeLog}\n\nAll vocabulary encountered:\n${JSON.stringify(session.allVocab)}`,
    }],
  });

  const content = msg.content[0];
  if (content.type !== 'text') throw new Error('Unexpected Claude response type');
  return parseClaudeJson<SoloSummaryResult>(content.text);
}

function handleJoinSolo(client: BabelClient, msg: JoinSoloMsg) {
  const session: SoloSession = {
    userId: client.userId,
    nativeLang: msg.native_lang,
    targetLang: msg.target_lang,
    exchanges: [],
    allVocab: [],
    difficulty: 'beginner',
    recentPrompts: [],
  };
  soloSessions.set(client.userId, session);
  send(client, { type: 'solo_joined', session_id: client.userId });
  console.log(`[solo] ${client.userId} started ${langName(msg.native_lang)} → ${langName(msg.target_lang)}`);
}

async function handleSoloUtterance(client: BabelClient, msg: SoloUtteranceMsg) {
  const session = soloSessions.get(client.userId);
  if (!session) {
    send(client, { type: 'error', message: 'No active solo session' });
    return;
  }

  send(client, { type: 'state_change', user: client.userId, state: 'thinking' });

  try {
    const result = await soloTutor(session, msg.original_text, msg.attempted_target ?? false);

    const exchange: SoloExchange = {
      userText: msg.original_text,
      attemptedTarget: msg.attempted_target ?? false,
      response: result,
    };
    session.exchanges.push(exchange);
    session.allVocab.push(...(result.vocab_cards ?? []));

    if (session.exchanges.length >= 12) session.difficulty = 'advanced';
    else if (session.exchanges.length >= 5) session.difficulty = 'intermediate';

    send(client, { type: 'solo_response', ...result });
  } catch (err) {
    console.error(`[solo] tutor error for ${client.userId}:`, err);
    send(client, { type: 'error', message: 'Tutor error — try again' });
  }

  send(client, { type: 'state_change', user: client.userId, state: 'idle' });
}

async function handleSoloEnd(client: BabelClient) {
  const session = soloSessions.get(client.userId);
  if (!session) {
    send(client, { type: 'error', message: 'No active solo session' });
    return;
  }

  send(client, { type: 'solo_ended' });
  soloSessions.delete(client.userId);
  console.log(`[solo] ${client.userId} ended session (${session.exchanges.length} exchanges)`);
}

async function handleSoloRequestPrompt(client: BabelClient) {
  const session = soloSessions.get(client.userId);
  if (!session) {
    send(client, { type: 'error', message: 'No active solo session' });
    return;
  }

  const nativeName = langName(session.nativeLang);
  const targetName = langName(session.targetLang);
  const exchangeCount = session.exchanges.length;
  const difficultyHint = exchangeCount < 5 ? 'beginner' : exchangeCount < 12 ? 'intermediate' : 'advanced';

  const recentPhrases = session.recentPrompts.slice(-10);

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 400,
      system: `You are a language tutor. Generate a single practice phrase in ${targetName} for a ${nativeName} speaker to try saying aloud.

Difficulty: ${difficultyHint}.
${recentPhrases.length > 0 ? `You MUST NOT repeat or rephrase any of these previously given phrases: ${JSON.stringify(recentPhrases)}. Generate something completely different.` : ''}
${session.allVocab.length > 0 ? `The user has already learned: ${JSON.stringify(session.allVocab.map(v => v.word).slice(-20))}. Try to include some of these words so they can practice them.` : ''}

IMPORTANT RULES:
- Do NOT include any proper names or personal names in the phrase.
- Keep phrases generic and universally useful.
- The phrase must be short enough to repeat easily (max ~8 words).

For beginner: simple greetings, polite phrases, numbers, common questions, basic responses.
For intermediate: ordering food, asking for directions, describing things, making plans.
For advanced: expressing opinions, idioms, complex situations.

Return ONLY valid JSON:
{"phrase":"<phrase in ${targetName}>","phonetic":"<pronunciation guide for ${nativeName} speaker>","translation":"<translation in ${nativeName}>","context":"<one-line situational hint, e.g. 'greeting someone' or 'ordering at a café'>"}`,
      messages: [{ role: 'user', content: 'Generate the next practice phrase.' }],
    });

    const content = msg.content[0];
    if (content.type !== 'text') throw new Error('Unexpected response');
    const result = parseClaudeJson<{ phrase: string; phonetic: string; translation: string; context: string }>(content.text);
    session.recentPrompts.push(result.phrase);
    send(client, { type: 'solo_prompt', ...result });
  } catch (err) {
    console.error(`[solo] prompt generation error:`, err);
    send(client, { type: 'error', message: 'Could not generate prompt' });
  }
}

// ─── Message handlers ─────────────────────────────────────────────────────────

async function handleJoin(client: BabelClient, msg: JoinRoomMsg) {
  const code = normalizeRoomCode(msg.room_code);
  client.room = code;
  client.lang = msg.user_lang;
  client.isDevice = msg.is_device ?? false;

  if (!rooms.has(code)) rooms.set(code, new Set());
  rooms.get(code)!.add(client.userId);

  const roomSize = rooms.get(code)!.size;
  send(client, { type: 'joined', room_code: code, user_id: client.userId, room_size: roomSize });

  const room = rooms.get(code)!;
  broadcast(room, { type: 'peer_joined', room_size: roomSize }, client.userId);
  broadcastPeers(code);

  console.log(`[room ${code}] ${client.isDevice ? 'device' : 'user'} ${client.userId} joined (lang: ${client.lang}) — ${roomSize} in room`);
}

async function handleUtterance(client: BabelClient, msg: UtteranceMsg) {
  if (!client.room || !client.lang) return;
  const room = rooms.get(client.room);
  if (!room) return;

  const timestamp = Date.now();
  const translations: TranscriptTranslation[] = [];
  let detectedSourceLang = client.lang;

  // Notify everyone we're thinking
  broadcast(room, { type: 'state_change', user: client.userId, state: 'thinking' });

  // Translate for each recipient with a different language (WS + SMS)
  const recipients = [...room].filter(uid => {
    if (uid === client.userId) return false;
    const c = clients.get(uid);
    if (c) return !c.isDevice;
    return smsUserIds.has(uid);
  });

  let cleanedOriginal: string = msg.original_text;
  let distressFired = false;

  const translationPromises = recipients.map(async (uid) => {
    const wsRecipient = clients.get(uid);
    const smsPhone = smsUserIds.get(uid);
    const smsRecipient = smsPhone ? smsClients.get(smsPhone) : null;
    const recipientLang = wsRecipient?.lang ?? smsRecipient?.lang;
    if (!recipientLang) return;

    try {
      const result = await translate(msg.original_text, recipientLang);
      detectedSourceLang = result.source_lang || detectedSourceLang;
      translations.push({
        to_user: uid,
        target_lang: recipientLang,
        translated_text: result.translated_text,
      });

      cleanedOriginal = result.cleaned_original ?? msg.original_text;

      if (result.distress_flag && !distressFired) {
        distressFired = true;
        broadcast(room!, { type: 'distress_alert', from_user: client.userId, message: cleanedOriginal });
      }

      if (wsRecipient) {
        send(wsRecipient, {
          type: 'utterance',
          from_user: client.userId,
          original_text: cleanedOriginal,
          translated_text: result.translated_text,
          source_lang: result.source_lang,
          distress_flag: result.distress_flag,
          tone_note: result.tone_note,
          timestamp,
        });
      } else if (smsRecipient) {
        await sendSms(smsRecipient.phone, result.translated_text);
      }
    } catch (err) {
      console.error(`Translation error for ${uid}:`, err);
      if (wsRecipient) {
        send(wsRecipient, {
          type: 'utterance',
          from_user: client.userId,
          original_text: msg.original_text,
          translated_text: msg.original_text,
          source_lang: client.lang,
          distress_flag: false,
          tone_note: 'casual',
          timestamp,
          error: true,
        });
      } else if (smsRecipient) {
        await sendSms(smsRecipient.phone, msg.original_text);
      }
    }
  });

  await Promise.all(translationPromises);
  await appendTranscript(client.room, {
    id: `${timestamp}-${client.userId}`,
    from_user: client.userId,
    original_text: msg.original_text,
    source_lang: detectedSourceLang,
    timestamp,
    translations,
  });

  // Echo cleaned text back to sender so their own "YOU SAID" card is also SFW
  send(client, {
    type: 'utterance_echo',
    original_text: cleanedOriginal,
    timestamp,
  });

  broadcast(room, { type: 'state_change', user: client.userId, state: 'idle' });
  void analyzeAndBroadcast(client.room, msg.original_text);
}

function handleStateChange(client: BabelClient, msg: StateChangeMsg) {
  if (!client.room) return;
  const room = rooms.get(client.room);
  if (!room) return;
  // Broadcast to everyone in room including devices
  broadcast(room, { type: 'state_change', user: client.userId, state: msg.state });
}

function handleDevicePing(client: BabelClient, msg: DevicePingMsg) {
  send(client, { type: 'pong', device_id: msg.device_id, ts: Date.now() });
}

function handleUpdateLang(client: BabelClient, msg: UpdateLangMsg) {
  if (!client.room) return;
  client.lang = msg.lang;
  broadcastPeers(client.room);
  console.log(`[room ${client.room}] ${client.userId} switched lang → ${msg.lang}`);
}

function handleRequestPeers(client: BabelClient) {
  if (!client.room) return;
  const room = rooms.get(client.room);
  if (!room) return;
  const peers = [...room].map(uid => {
    const c = clients.get(uid);
    return { userId: uid, lang: c?.lang ?? '', isDevice: c?.isDevice ?? false };
  });
  send(client, { type: 'peers_update', peers });
}

function handleDisconnect(client: BabelClient) {
  if (client.room) {
    const room = rooms.get(client.room);
    if (room) {
      room.delete(client.userId);
      if (room.size === 0) {
        rooms.delete(client.room);
        console.log(`[room ${client.room}] closed (empty)`);
      } else {
        broadcast(room, { type: 'peer_left', user: client.userId, room_size: room.size });
        broadcastPeers(client.room);
      }
    }
  }
  soloSessions.delete(client.userId);
  clients.delete(client.userId);
  console.log(`[disconnect] ${client.userId}`);
}

async function handleSummaryRequest(roomCode: string, targetLang: string) {
  const archive = await getArchive(roomCode);
  if (!archive) return null;

  let summary = await getSummaryForLanguage(archive, targetLang);
  if (!summary && archive.transcript.length > 0) {
    summary = await generateAndSaveSummary(archive, targetLang);
  }

  const updatedArchive = await getArchive(roomCode);
  return updatedArchive ? {
    room_code: updatedArchive.room_code,
    summary: updatedArchive.summaries?.[targetLang] ?? summary ?? null,
    technical_notes: updatedArchive.technical_notes,
    follow_up_questions: updatedArchive.follow_up_questions,
    transcript: updatedArchive.transcript,
    transcript_count: updatedArchive.transcript.length,
    updated_at: updatedArchive.updated_at,
  } : null;
}

async function handleFinalizeRequest(roomCode: string, targetLang: string) {
  const archive = await getArchive(roomCode);
  if (!archive) return null;
  if (archive.transcript.length > 0) {
    await generateAndSaveSummary(archive, targetLang);
  }
  return handleSummaryRequest(roomCode, targetLang);
}

// ─── SMS bridge ───────────────────────────────────────────────────────────────

async function handleSmsUtterance(phone: string, text: string) {
  const smsClient = smsClients.get(phone);
  if (!smsClient) return;

  const { room: roomCode, lang, userId } = smsClient;
  const room = rooms.get(roomCode);
  if (!room) {
    await sendSms(phone, `Room ${roomCode} has closed. Text "JOIN <code>" to rejoin.`);
    return;
  }

  const timestamp = Date.now();
  broadcast(room, { type: 'state_change', user: userId, state: 'thinking' });

  const recipients = [...room].filter(uid => {
    if (uid === userId) return false;
    const c = clients.get(uid);
    return c && !c.isDevice;
  });

  const translations: TranscriptTranslation[] = [];
  let detectedSourceLang = lang;
  let cleanedOriginal = text;
  let distressFired = false;

  await Promise.all(recipients.map(async uid => {
    const recipient = clients.get(uid);
    if (!recipient?.lang) return;

    try {
      const result = await translate(text, recipient.lang);
      detectedSourceLang = result.source_lang || detectedSourceLang;
      cleanedOriginal = result.cleaned_original ?? text;
      translations.push({ to_user: uid, target_lang: recipient.lang, translated_text: result.translated_text });

      if (result.distress_flag && !distressFired) {
        distressFired = true;
        broadcast(room, { type: 'distress_alert', from_user: userId, message: cleanedOriginal });
      }

      send(recipient, {
        type: 'utterance',
        from_user: userId,
        original_text: cleanedOriginal,
        translated_text: result.translated_text,
        source_lang: result.source_lang,
        distress_flag: result.distress_flag,
        tone_note: result.tone_note,
        timestamp,
      });
    } catch (err) {
      console.error(`[SMS] Translation error for ${uid}:`, err);
      send(recipient, {
        type: 'utterance',
        from_user: userId,
        original_text: text,
        translated_text: text,
        source_lang: lang,
        distress_flag: false,
        tone_note: 'casual',
        timestamp,
        error: true,
      });
    }
  }));

  await appendTranscript(roomCode, {
    id: `${timestamp}-${userId}`,
    from_user: userId,
    original_text: text,
    source_lang: detectedSourceLang,
    timestamp,
    translations,
  });

  await sendSms(phone, `✓ "${cleanedOriginal}"`);
  broadcast(room, { type: 'state_change', user: userId, state: 'idle' });
  void analyzeAndBroadcast(roomCode, text);
}

async function handleSmsWebhook(req: import('http').IncomingMessage, res: import('http').ServerResponse) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk as ArrayBuffer));
  const body = Buffer.concat(chunks).toString('utf8');

  // Respond to Twilio immediately with empty TwiML
  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end('<?xml version="1.0" encoding="UTF-8"?><Response/>');

  const params = new URLSearchParams(body);
  const from = params.get('From')?.trim() ?? '';
  const rawText = params.get('Body')?.trim() ?? '';
  if (!from || !rawText) return;

  console.log(`[SMS] ${from}: ${rawText.slice(0, 80)}`);

  const parts = rawText.trim().split(/\s+/);
  const cmd = parts[0].toUpperCase();

  if (cmd === 'JOIN' && parts.length >= 2) {
    const roomCode = normalizeRoomCode(parts[1]);
    const lang = (parts[2] && /^[a-z]{2}-[A-Z]{2}$/i.test(parts[2])) ? parts[2] : 'en-US';

    // Remove previous session if rejoining
    const existing = smsClients.get(from);
    if (existing) {
      const oldRoom = rooms.get(existing.room);
      if (oldRoom) {
        oldRoom.delete(existing.userId);
        if (oldRoom.size === 0) rooms.delete(existing.room);
        else { broadcast(oldRoom, { type: 'peer_left', user: existing.userId, room_size: oldRoom.size }); broadcastPeers(existing.room); }
      }
      smsUserIds.delete(existing.userId);
    }

    const userId = nextId();
    const smsClient: SmsClient = { phone: from, room: roomCode, lang, userId };
    smsClients.set(from, smsClient);
    smsUserIds.set(userId, from);

    if (!rooms.has(roomCode)) rooms.set(roomCode, new Set());
    rooms.get(roomCode)!.add(userId);
    const roomSize = rooms.get(roomCode)!.size;

    broadcast(rooms.get(roomCode)!, { type: 'peer_joined', room_size: roomSize }, userId);
    broadcastPeers(roomCode);

    await sendSms(from, `Joined room ${roomCode} as ${langName(lang)} speaker 🌐\nJust text normally — everything is auto-translated!\nText LEAVE to exit.`);
    console.log(`[SMS] ${from} joined room ${roomCode} lang=${lang} as ${userId}`);
    return;
  }

  if (cmd === 'LEAVE') {
    const existing = smsClients.get(from);
    if (existing) {
      const room = rooms.get(existing.room);
      if (room) {
        room.delete(existing.userId);
        if (room.size === 0) rooms.delete(existing.room);
        else { broadcast(room, { type: 'peer_left', user: existing.userId, room_size: room.size }); broadcastPeers(existing.room); }
      }
      smsUserIds.delete(existing.userId);
      smsClients.delete(from);
      await sendSms(from, `You left room ${existing.room}. Text "JOIN <code>" to join again.`);
    }
    return;
  }

  if (!smsClients.has(from)) {
    await sendSms(from, `Text "JOIN ABCD" with your room code to join a Babel translation room.\nAdd your language: "JOIN ABCD es-ES"`);
    return;
  }

  await handleSmsUtterance(from, rawText);
}

// ─── Server ───────────────────────────────────────────────────────────────────

const httpServer = createServer(async (req, res) => {
  // Health check + CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/sms') {
    await handleSmsWebhook(req, res);
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, clients: clients.size }));
    return;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const summaryMatch = url.pathname.match(/^\/rooms\/([^/]+)\/summary$/);
  const finalizeMatch = url.pathname.match(/^\/rooms\/([^/]+)\/finalize$/);
  const lessonMatch = url.pathname.match(/^\/rooms\/([^/]+)\/lesson$/);
  const requestedLang = url.searchParams.get('lang') ?? 'en-US';

  try {
    if (summaryMatch && req.method === 'GET') {
      const payload = await handleSummaryRequest(summaryMatch[1], requestedLang);
      if (!payload) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Room summary not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
      return;
    }

    if (finalizeMatch && req.method === 'POST') {
      const payload = await handleFinalizeRequest(finalizeMatch[1], requestedLang);
      if (!payload) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Room summary not found' }));
        return;
      }
      const room = rooms.get(normalizeRoomCode(finalizeMatch[1]));
      const archive = await getArchive(finalizeMatch[1]);
      if (room && archive) {
        await broadcastLocalizedSummaries(normalizeRoomCode(finalizeMatch[1]), room, archive);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
      return;
    }
    if (lessonMatch && req.method === 'GET') {
      const targetLang = url.searchParams.get('target_lang') ?? '';
      if (!targetLang) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'target_lang query parameter is required' }));
        return;
      }
      const lesson = await handleLessonRequest(lessonMatch[1], requestedLang, targetLang);
      if (!lesson) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No transcript found for that room' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(lesson));
      return;
    }
  } catch (err) {
    console.error('HTTP handler error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
    return;
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  const userId = nextId();
  const client: BabelClient = { ws, userId };
  clients.set(userId, client);
  console.log(`[connect] ${userId}`);

  ws.on('message', async (raw) => {
    let msg: IncomingMsg;
    try {
      msg = JSON.parse(raw.toString()) as IncomingMsg;
    } catch {
      return;
    }

    try {
      switch (msg.type) {
        case 'join_room':       await handleJoin(client, msg); break;
        case 'utterance':       await handleUtterance(client, msg); break;
        case 'state_change':    handleStateChange(client, msg); break;
        case 'device_ping':     handleDevicePing(client, msg); break;
        case 'request_peers':   handleRequestPeers(client); break;
        case 'update_lang':     handleUpdateLang(client, msg); break;
        case 'join_solo':       handleJoinSolo(client, msg); break;
        case 'solo_utterance':  await handleSoloUtterance(client, msg); break;
        case 'solo_end':        await handleSoloEnd(client); break;
        case 'solo_request_prompt': await handleSoloRequestPrompt(client); break;
      }
    } catch (err) {
      console.error(`Handler error (${msg.type}):`, err);
      send(client, { type: 'error', message: 'Internal server error' });
    }
  });

  ws.on('close', () => handleDisconnect(client));
  ws.on('error', (err) => {
    console.error(`WS error for ${userId}:`, err);
    handleDisconnect(client);
  });

  send(client, { type: 'connected', user_id: userId });
});

httpServer.listen(PORT, HOST, () => {
  console.log(`Babel server listening on ws://${HOST}:${PORT}`);
  console.log(`ESP bridge target: ws://172.20.10.3:${PORT}`);
  console.log(`Health: http://172.20.10.3:${PORT}/health`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('WARNING: ANTHROPIC_API_KEY not set — translation will fail');
  }
  if (twilioClient) {
    console.log(`SMS bridge: POST http://localhost:${PORT}/sms  (Twilio number: ${process.env.TWILIO_PHONE_NUMBER ?? 'not set'})`);
  } else {
    console.log('SMS bridge: disabled — add TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER to .env to enable');
  }
});
