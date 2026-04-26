import type { LessonResponse, RoomSummaryResponse } from './types';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'ws://localhost:8080';

function httpBaseFromWs(url: string) {
  if (url.startsWith('wss://')) return url.replace(/^wss:\/\//, 'https://');
  if (url.startsWith('ws://')) return url.replace(/^ws:\/\//, 'http://');
  return url;
}

const API_BASE = httpBaseFromWs(SERVER_URL).replace(/\/$/, '');

async function requestSummary(path: string, init?: RequestInit): Promise<RoomSummaryResponse> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const message = res.status === 404 ? 'No summary found for that room code yet.' : 'Could not load the room summary.';
    throw new Error(message);
  }
  return res.json() as Promise<RoomSummaryResponse>;
}

function roomSummaryPath(roomCode: string, lang: string, action: 'summary' | 'finalize') {
  const code = encodeURIComponent(roomCode.trim().toUpperCase());
  const targetLang = encodeURIComponent(lang);
  return `/rooms/${code}/${action}?lang=${targetLang}`;
}

export function getRoomSummary(roomCode: string, lang: string) {
  return requestSummary(roomSummaryPath(roomCode, lang, 'summary'));
}

export function finalizeRoomSummary(roomCode: string, lang: string) {
  return requestSummary(roomSummaryPath(roomCode, lang, 'finalize'), {
    method: 'POST',
  });
}

export async function getRoomLesson(roomCode: string, userLang: string, targetLang: string): Promise<LessonResponse> {
  const code = encodeURIComponent(roomCode.trim().toUpperCase());
  const res = await fetch(`${API_BASE}/rooms/${code}/lesson?lang=${encodeURIComponent(userLang)}&target_lang=${encodeURIComponent(targetLang)}`);
  if (!res.ok) {
    const message = res.status === 404
      ? 'No conversation transcript found for that room.'
      : 'Could not generate lesson.';
    throw new Error(message);
  }
  return res.json() as Promise<LessonResponse>;
}
