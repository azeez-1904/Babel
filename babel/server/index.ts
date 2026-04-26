import 'dotenv/config';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import Anthropic from '@anthropic-ai/sdk';
import {
  appendTranscript,
  getArchive,
  mergeTechnicalNotes,
  normalizeRoomCode,
  saveSummary,
  type RoomArchive,
  type RoomSummary,
  type TechnicalNote,
  type TranscriptTranslation,
} from './roomArchive';

const PORT = parseInt(process.env.PORT ?? '8080');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Types ────────────────────────────────────────────────────────────────────

interface BabelClient {
  ws: WebSocket;
  userId: string;
  room?: string;
  lang?: string;
  isDevice?: boolean;
}

type State = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

interface JoinRoomMsg    { type: 'join_room';     room_code: string; user_lang: string; is_device?: boolean }
interface UtteranceMsg   { type: 'utterance';     original_text: string }
interface StateChangeMsg { type: 'state_change';  state: State }
interface DevicePingMsg  { type: 'device_ping';   device_id: string }
interface RequestPeersMsg{ type: 'request_peers' }
interface UpdateLangMsg  { type: 'update_lang';   lang: string }
type IncomingMsg = JoinRoomMsg | UtteranceMsg | StateChangeMsg | DevicePingMsg | RequestPeersMsg | UpdateLangMsg;

interface TranslationResult {
  source_lang: string;
  translated_text: string;
  cleaned_original: string;
  distress_flag: boolean;
  tone_note: string;
}

interface TechnicalAnalysisResult {
  technical_notes: Omit<TechnicalNote, 'id' | 'created_at'>[];
}

interface SummaryResult {
  simple_summary: string;
  key_points: string[];
  suggested_follow_up_questions: string[];
}

// ─── State ────────────────────────────────────────────────────────────────────

const clients = new Map<string, BabelClient>();
// room_code → Set<userId>
const rooms = new Map<string, Set<string>>();

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
    return { userId: uid, lang: c?.lang ?? '', isDevice: c?.isDevice ?? false };
  });
  broadcast(room, { type: 'peers_update', peers });
}

function send(client: BabelClient, payload: object) {
  if (client.ws.readyState === WebSocket.OPEN)
    client.ws.send(JSON.stringify(payload));
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
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
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

async function analyzeTechnicalLanguage(text: string): Promise<TechnicalAnalysisResult> {
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 900,
    system: `You explain technical language in simple terms for people in a live conversation.

Rules:
- Detect specialized terms from any domain: medical, legal, engineering, finance, education, science, government, or other jargon.
- Be conservative. If the phrase is ordinary everyday language, return an empty technical_notes array.
- Explain what the phrase means in plain language without giving professional advice.
- Suggest practical follow-up questions someone could ask to understand the issue better.
- Return ONLY valid JSON — no markdown, no explanation, no surrounding text.

Response schema:
{"technical_notes":[{"phrase":"<exact phrase>","simple_explanation":"<simple meaning>","why_it_matters":"<why a normal person might need to know this>","follow_up_questions":["<question>"],"confidence":0.85,"source_text":"<source utterance>"}]}`,
    messages: [{ role: 'user', content: `Analyze this utterance for technical language:\n"${text}"` }],
  });

  const content = msg.content[0];
  if (content.type !== 'text') throw new Error('Unexpected Claude response type');
  const result = parseClaudeJson<TechnicalAnalysisResult>(content.text);
  return {
    technical_notes: (result.technical_notes ?? [])
      .filter(note => note.phrase && note.simple_explanation)
      .map(note => ({
        phrase: String(note.phrase).slice(0, 120),
        simple_explanation: String(note.simple_explanation).slice(0, 500),
        why_it_matters: String(note.why_it_matters ?? '').slice(0, 500),
        follow_up_questions: (note.follow_up_questions ?? []).map(String).filter(Boolean).slice(0, 3),
        confidence: Math.max(0, Math.min(1, Number(note.confidence) || 0)),
        source_text: String(note.source_text || text).slice(0, 1000),
      })),
  };
}

function transcriptForPrompt(archive: RoomArchive) {
  return archive.transcript
    .slice(-30)
    .map(entry => {
      const translated = entry.translations[0]?.translated_text;
      return `${new Date(entry.timestamp).toISOString()} ${entry.from_user}: ${entry.original_text}${translated ? `\nTranslated: ${translated}` : ''}`;
    })
    .join('\n\n');
}

async function generateRoomSummary(archive: RoomArchive): Promise<RoomSummary> {
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1000,
    system: `Summarize a multilingual conversation in simple language.

Rules:
- Write for a normal person who may not understand technical details.
- Do not invent facts. Only summarize what was said.
- Separate what happened from useful follow-up questions.
- If the conversation includes professional topics like medical, legal, or financial issues, do not give advice; suggest questions to ask a qualified professional.
- Return ONLY valid JSON — no markdown, no surrounding text.

Response schema:
{"simple_summary":"<short simple paragraph>","key_points":["<point>"],"suggested_follow_up_questions":["<question>"]}`,
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
    simple_summary: String(result.simple_summary || 'No summary is available yet.'),
    key_points: (result.key_points ?? []).map(String).filter(Boolean).slice(0, 8),
    suggested_follow_up_questions: (result.suggested_follow_up_questions ?? []).map(String).filter(Boolean).slice(0, 8),
    updated_at: Date.now(),
    transcript_count: archive.transcript.length,
  };
}

async function analyzeAndBroadcast(roomCode: string, text: string) {
  try {
    const room = rooms.get(roomCode);
    if (!room) return;

    const analysis = await analyzeTechnicalLanguage(text);
    if (analysis.technical_notes.length > 0) {
      const archive = await mergeTechnicalNotes(roomCode, analysis.technical_notes);
      broadcastHumans(room, {
        type: 'technical_notes_update',
        room_code: archive.room_code,
        technical_notes: archive.technical_notes,
        follow_up_questions: archive.follow_up_questions,
      });
    }

    const archive = await getArchive(roomCode);
    if (archive && archive.transcript.length >= 2 && archive.transcript.length % 3 === 0) {
      const summary = await generateRoomSummary(archive);
      await saveSummary(roomCode, summary);
      broadcastHumans(room, { type: 'summary_update', summary });
    }
  } catch (err) {
    console.error(`[room ${roomCode}] technical analysis error:`, err);
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

  // Translate for each recipient with a different language
  const recipients = [...room].filter(uid => {
    if (uid === client.userId) return false;
    const c = clients.get(uid);
    return c && !c.isDevice; // devices get state_change, not utterances
  });

  let cleanedOriginal: string = msg.original_text;
  let distressFired = false;

  const translationPromises = recipients.map(async (uid) => {
    const recipient = clients.get(uid);
    if (!recipient?.lang) return;

    try {
      const result = await translate(msg.original_text, recipient.lang);
      detectedSourceLang = result.source_lang || detectedSourceLang;
      translations.push({
        to_user: recipient.userId,
        target_lang: recipient.lang,
        translated_text: result.translated_text,
      });

      // Capture cleaned original from the first result (same input = same cleaning)
      cleanedOriginal = result.cleaned_original ?? msg.original_text;

      if (result.distress_flag && !distressFired) {
        distressFired = true;
        broadcast(room!, {
          type: 'distress_alert',
          from_user: client.userId,
          message: cleanedOriginal,
        });
      }

      send(recipient, {
        type: 'utterance',
        from_user: client.userId,
        original_text: cleanedOriginal,
        translated_text: result.translated_text,
        source_lang: result.source_lang,
        distress_flag: result.distress_flag,
        tone_note: result.tone_note,
        timestamp,
      });
    } catch (err) {
      console.error(`Translation error for ${uid}:`, err);
      send(recipient, {
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
  clients.delete(client.userId);
  console.log(`[disconnect] ${client.userId}`);
}

async function handleSummaryRequest(roomCode: string) {
  const archive = await getArchive(roomCode);
  if (!archive) return null;

  if (!archive.summary && archive.transcript.length > 0) {
    const summary = await generateRoomSummary(archive);
    await saveSummary(roomCode, summary);
  }

  const updatedArchive = await getArchive(roomCode);
  return updatedArchive ? {
    room_code: updatedArchive.room_code,
    summary: updatedArchive.summary ?? null,
    technical_notes: updatedArchive.technical_notes,
    follow_up_questions: updatedArchive.follow_up_questions,
    transcript_count: updatedArchive.transcript.length,
    updated_at: updatedArchive.updated_at,
  } : null;
}

async function handleFinalizeRequest(roomCode: string) {
  const archive = await getArchive(roomCode);
  if (!archive) return null;
  if (archive.transcript.length > 0) {
    const summary = await generateRoomSummary(archive);
    await saveSummary(roomCode, summary);
  }
  return handleSummaryRequest(roomCode);
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

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, clients: clients.size }));
    return;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const summaryMatch = url.pathname.match(/^\/rooms\/([^/]+)\/summary$/);
  const finalizeMatch = url.pathname.match(/^\/rooms\/([^/]+)\/finalize$/);

  try {
    if (summaryMatch && req.method === 'GET') {
      const payload = await handleSummaryRequest(summaryMatch[1]);
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
      const payload = await handleFinalizeRequest(finalizeMatch[1]);
      if (!payload) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Room summary not found' }));
        return;
      }
      const room = rooms.get(normalizeRoomCode(finalizeMatch[1]));
      if (room && payload.summary) {
        broadcastHumans(room, { type: 'summary_update', summary: payload.summary });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
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
        case 'join_room':     await handleJoin(client, msg); break;
        case 'utterance':     await handleUtterance(client, msg); break;
        case 'state_change':  handleStateChange(client, msg); break;
        case 'device_ping':   handleDevicePing(client, msg); break;
        case 'request_peers': handleRequestPeers(client); break;
        case 'update_lang':   handleUpdateLang(client, msg); break;
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

httpServer.listen(PORT, () => {
  console.log(`Babel server listening on ws://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('WARNING: ANTHROPIC_API_KEY not set — translation will fail');
  }
});
