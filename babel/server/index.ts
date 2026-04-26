import 'dotenv/config';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import Anthropic from '@anthropic-ai/sdk';

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
type IncomingMsg = JoinRoomMsg | UtteranceMsg | StateChangeMsg | DevicePingMsg | RequestPeersMsg;

interface TranslationResult {
  source_lang: string;
  translated_text: string;
  cleaned_original: string;
  distress_flag: boolean;
  tone_note: string;
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

async function translate(text: string, targetLangCode: string): Promise<TranslationResult> {
  const targetLangName = langName(targetLangCode);

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
  // Strip markdown code fences Claude sometimes adds (```json ... ```)
  const raw = content.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(raw) as TranslationResult;
}

// ─── Message handlers ─────────────────────────────────────────────────────────

async function handleJoin(client: BabelClient, msg: JoinRoomMsg) {
  const code = msg.room_code.toUpperCase().slice(0, 6);
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

  // Echo cleaned text back to sender so their own "YOU SAID" card is also SFW
  send(client, {
    type: 'utterance_echo',
    original_text: cleanedOriginal,
    timestamp,
  });

  broadcast(room, { type: 'state_change', user: client.userId, state: 'idle' });
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

// ─── Server ───────────────────────────────────────────────────────────────────

const httpServer = createServer((req, res) => {
  // Health check + CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, clients: clients.size }));
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
