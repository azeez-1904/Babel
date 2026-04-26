import type { RoomSummaryResponse } from './types';

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

export function getRoomSummary(roomCode: string) {
  return requestSummary(`/rooms/${encodeURIComponent(roomCode.trim().toUpperCase())}/summary`);
}

export function finalizeRoomSummary(roomCode: string) {
  return requestSummary(`/rooms/${encodeURIComponent(roomCode.trim().toUpperCase())}/finalize`, {
    method: 'POST',
  });
}
