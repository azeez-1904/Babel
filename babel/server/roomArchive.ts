import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

export interface TranscriptTranslation {
  to_user: string;
  target_lang: string;
  translated_text: string;
}

export interface TranscriptEntry {
  id: string;
  from_user: string;
  original_text: string;
  source_lang: string;
  timestamp: number;
  translations: TranscriptTranslation[];
}

export interface TechnicalNote {
  id: string;
  phrase: string;
  simple_explanation: string;
  conversation_context?: string;
  why_it_matters: string;
  follow_up_questions: string[];
  confidence: number;
  source_text: string;
  created_at: number;
}

export interface RoomSummary {
  room_code: string;
  language: string;
  simple_summary: string;
  key_points: string[];
  suggested_follow_up_questions: string[];
  updated_at: number;
  transcript_count: number;
}

export interface RoomArchive {
  room_code: string;
  transcript: TranscriptEntry[];
  technical_notes: TechnicalNote[];
  follow_up_questions: string[];
  summaries?: Record<string, RoomSummary>;
  summary?: RoomSummary;
  updated_at: number;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const ARCHIVE_PATH = path.join(DATA_DIR, 'room-archives.json');
const archives = new Map<string, RoomArchive>();

let loaded = false;
let writeQueue = Promise.resolve();

export function normalizeRoomCode(code: string) {
  return code.trim().toUpperCase().slice(0, 6);
}

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;

  try {
    const raw = await readFile(ARCHIVE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, RoomArchive>;
    for (const [code, archive] of Object.entries(parsed)) {
      archives.set(code, archive);
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      console.warn('Could not load room archive data:', err);
    }
  }
}

async function persist() {
  await mkdir(DATA_DIR, { recursive: true });
  const data = Object.fromEntries([...archives.entries()].sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(ARCHIVE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function queuePersist() {
  writeQueue = writeQueue.then(persist, persist);
  return writeQueue;
}

function emptyArchive(roomCode: string): RoomArchive {
  const now = Date.now();
  return {
    room_code: roomCode,
    transcript: [],
    technical_notes: [],
    follow_up_questions: [],
    summaries: {},
    updated_at: now,
  };
}

async function getOrCreateArchive(roomCode: string) {
  await ensureLoaded();
  const code = normalizeRoomCode(roomCode);
  const existing = archives.get(code);
  if (existing) return existing;

  const archive = emptyArchive(code);
  archives.set(code, archive);
  return archive;
}

export async function appendTranscript(roomCode: string, entry: TranscriptEntry) {
  const archive = await getOrCreateArchive(roomCode);
  archive.transcript.push(entry);
  archive.updated_at = Date.now();
  await queuePersist();
  return archive;
}

export async function mergeTechnicalNotes(
  roomCode: string,
  notes: Omit<TechnicalNote, 'id' | 'created_at'>[],
  removeNoteIds: string[] = [],
) {
  const archive = await getOrCreateArchive(roomCode);
  const now = Date.now();
  const removeIds = new Set(removeNoteIds);
  if (removeIds.size > 0) {
    archive.technical_notes = archive.technical_notes.filter(note => !removeIds.has(note.id));
  }

  const existingByPhrase = new Map(archive.technical_notes.map(note => [note.phrase.toLowerCase(), note]));

  const freshNotes: TechnicalNote[] = [];
  for (const note of notes) {
    const phraseKey = note.phrase.trim().toLowerCase();
    if (!phraseKey) continue;

    const existing = existingByPhrase.get(phraseKey);
    if (existing) {
      existing.simple_explanation = note.simple_explanation;
      existing.conversation_context = note.conversation_context;
      existing.why_it_matters = note.why_it_matters;
      existing.follow_up_questions = note.follow_up_questions;
      existing.confidence = note.confidence;
      existing.source_text = note.source_text;
      existing.created_at = now;
      continue;
    }

    existingByPhrase.set(phraseKey, note as TechnicalNote);
    freshNotes.push({
      ...note,
      id: `${now}-${archive.technical_notes.length + freshNotes.length + 1}`,
      created_at: now,
    });
  }

  if (freshNotes.length === 0 && notes.length === 0 && removeIds.size === 0) return archive;

  archive.technical_notes.push(...freshNotes);
  archive.follow_up_questions = Array.from(new Set(
    archive.technical_notes.flatMap(note => note.follow_up_questions),
  )).slice(-12);
  archive.updated_at = now;
  await queuePersist();
  return archive;
}

export async function saveSummary(
  roomCode: string,
  language: string,
  summary: Omit<RoomSummary, 'room_code' | 'language' | 'updated_at' | 'transcript_count'>,
) {
  const archive = await getOrCreateArchive(roomCode);
  const savedSummary: RoomSummary = {
    ...summary,
    room_code: archive.room_code,
    language,
    updated_at: Date.now(),
    transcript_count: archive.transcript.length,
  };
  archive.summaries = archive.summaries ?? {};
  archive.summaries[language] = savedSummary;
  archive.summary = savedSummary;
  archive.updated_at = archive.summary.updated_at;
  await queuePersist();
  return savedSummary;
}

export async function getArchive(roomCode: string) {
  await ensureLoaded();
  return archives.get(normalizeRoomCode(roomCode)) ?? null;
}
