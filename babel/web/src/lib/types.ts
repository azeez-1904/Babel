export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error' | 'connecting';
export type Screen = 'hero' | 'conversation' | 'lesson' | 'solo';

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
  transcript: TranscriptEntry[];
  transcript_count: number;
  updated_at: number;
}

// ─── Language Learning Mode types ─────────────────────────────────────────────

export interface LessonPhrase {
  id: string;
  original: string;
  phonetic: string;
  translation: string;
  category: 'greeting' | 'question' | 'technical' | 'common_response' | 'expression';
  context: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
}

export interface LessonResponse {
  room_code: string;
  source_lang: string;
  target_lang: string;
  phrases: LessonPhrase[];
}

// ─── Solo Practice Mode types ─────────────────────────────────────────────────

export interface VocabCard {
  word: string;
  phonetic: string;
  translation: string;
  example_sentence: string;
  example_translation: string;
}

export interface SoloResponse {
  translation: string;
  phonetic: string;
  correction?: string;
  correction_note?: string;
  encouragement: string;
  vocab_cards: VocabCard[];
  suggested_reply: string;
  suggested_reply_translation: string;
  suggested_reply_phonetic: string;
  difficulty_level: 'beginner' | 'intermediate' | 'advanced';
}

export interface SoloSummary {
  total_exchanges: number;
  words_learned: VocabCard[];
  phrases_practiced: string[];
  tips: string[];
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
