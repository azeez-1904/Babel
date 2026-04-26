import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import Anthropic from '@anthropic-ai/sdk';

const HOST = process.env.HOST ?? '0.0.0.0';
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

// ─── Translation ──────────────────────────────────────────────────────────────

async function translate(text: string, targetLang: string): Promise<TranslationResult> {
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: `You are a real-time spoken-word interpreter. Translate speech naturally and faithfully.

Rules:
- Auto-detect the source language from context
- Translate to the specified target language
- Preserve tone, register, and cultural expression — NEVER flatten AAVE, regional dialects, code-switching, or accented speech patterns into "standard" forms
- Maintain emotional weight: urgency stays urgent, warmth stays warm
- If ANY of these distress signals appear (chest pain, can't breathe, can't breathe, emergency, help me, I'm dying, stroke, heart attack, choking, unconscious, seizure): set distress_flag to true
- Return ONLY valid JSON — no markdown, no explanation, no surrounding text

Response schema:
{"source_lang":"<detected language name>","translated_text":"<translation>","distress_flag":false,"tone_note":"<one word: casual|formal|urgent|warm|playful>"}`,
    messages: [{ role: 'user', content: `Target language: ${targetLang}\nTranslate: "${text}"` }],
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

  const translationPromises = recipients.map(async (uid) => {
    const recipient = clients.get(uid);
    if (!recipient?.lang) return;

    try {
      const result = await translate(msg.original_text, recipient.lang);

      if (result.distress_flag) {
        broadcast(room!, {
          type: 'distress_alert',
          from_user: client.userId,
          message: msg.original_text,
        });
      }

      send(recipient, {
        type: 'utterance',
        from_user: client.userId,
        original_text: msg.original_text,
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
        translated_text: msg.original_text, // fallback: show original
        source_lang: client.lang,
        distress_flag: false,
        tone_note: 'casual',
        timestamp,
        error: true,
      });
    }
  });

  await Promise.all(translationPromises);

  // Also echo original back to sender for their own transcript
  send(client, {
    type: 'utterance_echo',
    original_text: msg.original_text,
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

httpServer.listen(PORT, HOST, () => {
  console.log(`Babel server listening on ws://${HOST}:${PORT}`);
  console.log(`ESP bridge target: ws://172.20.10.3:${PORT}`);
  console.log(`Health: http://172.20.10.3:${PORT}/health`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('WARNING: ANTHROPIC_API_KEY not set — translation will fail');
  }
});
