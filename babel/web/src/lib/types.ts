export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error' | 'connecting';
export type Screen = 'hero' | 'conversation';

export interface Utterance {
  id: string;
  from_user: string;
  isMine: boolean;
  original_text: string;
  displayed_text: string; // translated for others, original for self
  source_lang: string;
  distress_flag: boolean;
  tone_note: string;
  timestamp: number;
  error?: boolean;
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

export interface RoomSummaryResponse {
  room_code: string;
  summary: RoomSummary | null;
  technical_notes: TechnicalNote[];
  follow_up_questions: string[];
  transcript_count: number;
  updated_at: number;
}

export const LANGUAGES: { code: string; label: string; flag: string }[] = [
  { code: 'en-US', label: 'English',    flag: '🇺🇸' },
  { code: 'es-ES', label: 'Spanish',    flag: '🇪🇸' },
  { code: 'fr-FR', label: 'French',     flag: '🇫🇷' },
  { code: 'de-DE', label: 'German',     flag: '🇩🇪' },
  { code: 'zh-CN', label: 'Mandarin',   flag: '🇨🇳' },
  { code: 'ja-JP', label: 'Japanese',   flag: '🇯🇵' },
  { code: 'ko-KR', label: 'Korean',     flag: '🇰🇷' },
  { code: 'pt-BR', label: 'Portuguese', flag: '🇧🇷' },
  { code: 'ar-SA', label: 'Arabic',     flag: '🇸🇦' },
  { code: 'hi-IN', label: 'Hindi',      flag: '🇮🇳' },
  { code: 'it-IT', label: 'Italian',    flag: '🇮🇹' },
  { code: 'ru-RU', label: 'Russian',    flag: '🇷🇺' },
  { code: 'nl-NL', label: 'Dutch',      flag: '🇳🇱' },
  { code: 'pl-PL', label: 'Polish',     flag: '🇵🇱' },
  { code: 'tr-TR', label: 'Turkish',    flag: '🇹🇷' },
];
