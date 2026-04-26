import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getRoomLesson } from '../lib/api';
import { speakText } from '../hooks/useSpeech';
import { LANGUAGES } from '../lib/types';
import type { LessonPhrase, LessonResponse } from '../lib/types';

interface Props {
  roomCode: string;
  userLang: string;
  targetLang: string;
  onBack: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  greeting: 'Greeting',
  question: 'Question',
  technical: 'Technical',
  common_response: 'Response',
  expression: 'Expression',
};

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: '#4CAF50',
  intermediate: '#FF9800',
  advanced: '#E8744C',
};

function PhraseCard({ phrase, targetLang }: { phrase: LessonPhrase; targetLang: string }) {
  const [speaking, setSpeaking] = useState(false);

  const handleSpeak = useCallback(() => {
    setSpeaking(true);
    speakText(phrase.original, targetLang, undefined, () => setSpeaking(false));
  }, [phrase.original, targetLang]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl p-5"
      style={{
        background: 'rgba(255,255,255,0.72)',
        border: '1px solid rgba(42,42,42,0.07)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1">
          <p
            className="text-ink leading-snug mb-1"
            style={{ fontFamily: 'Fraunces, serif', fontSize: '1.25rem', fontWeight: 400 }}
          >
            {phrase.original}
          </p>
          <p
            className="text-charcoal/50 italic"
            style={{ fontFamily: 'DM Sans', fontSize: '0.9rem' }}
          >
            {phrase.phonetic}
          </p>
        </div>
        <button
          onClick={handleSpeak}
          className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-90"
          style={{
            background: speaking
              ? 'linear-gradient(135deg, #E8744C, #D4973A)'
              : 'rgba(232,116,76,0.1)',
          }}
          aria-label="Listen to pronunciation"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M11 5L6 9H2v6h4l5 4V5z"
              fill={speaking ? 'white' : '#E8744C'}
            />
            <path
              d="M15.54 8.46a5 5 0 010 7.07"
              stroke={speaking ? 'white' : '#E8744C'}
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <p className="text-charcoal/70 mb-3" style={{ fontFamily: 'DM Sans', fontSize: '0.95rem' }}>
        {phrase.translation}
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <span
          className="px-2.5 py-1 rounded-full text-xs uppercase tracking-wider"
          style={{
            fontFamily: 'DM Sans',
            background: 'rgba(232,116,76,0.1)',
            color: '#E8744C',
            fontSize: '0.6rem',
          }}
        >
          {CATEGORY_LABELS[phrase.category] ?? phrase.category}
        </span>
        <span
          className="px-2.5 py-1 rounded-full text-xs uppercase tracking-wider"
          style={{
            fontFamily: 'DM Sans',
            background: `${DIFFICULTY_COLORS[phrase.difficulty] ?? '#888'}18`,
            color: DIFFICULTY_COLORS[phrase.difficulty] ?? '#888',
            fontSize: '0.6rem',
          }}
        >
          {phrase.difficulty}
        </span>
        {phrase.context && (
          <span
            className="text-charcoal/40 text-xs"
            style={{ fontFamily: 'DM Sans', fontSize: '0.7rem' }}
          >
            {phrase.context}
          </span>
        )}
      </div>
    </motion.div>
  );
}

function FlashcardQuiz({
  phrases,
  targetLang,
  onExit,
}: {
  phrases: LessonPhrase[];
  targetLang: string;
  onExit: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);

  const current = phrases[index];
  const total = phrases.length;
  const progress = ((index + 1) / total) * 100;

  const handleReveal = () => setRevealed(true);

  const handleNext = (knew: boolean) => {
    if (knew) setScore(s => s + 1);
    setRevealed(false);
    if (index < total - 1) {
      setIndex(i => i + 1);
    }
  };

  const handleSpeak = () => {
    speakText(current.original, targetLang);
  };

  const isLast = index === total - 1;

  return (
    <div className="flex flex-col h-full">
      {/* Progress bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span style={{ fontFamily: 'DM Sans', fontSize: '0.75rem', color: '#2A2A2A60' }}>
            {index + 1} of {total}
          </span>
          <span style={{ fontFamily: 'DM Sans', fontSize: '0.75rem', color: '#E8744C' }}>
            {score} correct
          </span>
        </div>
        <div className="w-full h-1.5 rounded-full bg-charcoal/8 overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ background: 'linear-gradient(135deg, #E8744C, #D4973A)' }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </div>

      {/* Card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -40 }}
          transition={{ duration: 0.25 }}
          className="flex-1 flex flex-col items-center justify-center text-center px-4"
        >
          <p
            className="text-charcoal/50 mb-2 uppercase tracking-wider"
            style={{ fontFamily: 'DM Sans', fontSize: '0.65rem' }}
          >
            What does this mean?
          </p>
          <p
            className="text-ink mb-4"
            style={{ fontFamily: 'DM Sans', fontSize: '1rem' }}
          >
            {current.translation}
          </p>

          {!revealed ? (
            <button
              onClick={handleReveal}
              className="px-8 py-3 rounded-2xl text-white font-medium transition-all active:scale-95"
              style={{
                background: 'linear-gradient(135deg, #E8744C, #D4973A)',
                fontFamily: 'DM Sans',
                boxShadow: '0 4px 20px rgba(232,116,76,0.35)',
              }}
            >
              Reveal answer
            </button>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center gap-3"
            >
              <p style={{ fontFamily: 'Fraunces, serif', fontSize: '1.5rem', fontWeight: 400, color: '#1A1612' }}>
                {current.original}
              </p>
              <p className="text-charcoal/50 italic" style={{ fontFamily: 'DM Sans', fontSize: '0.9rem' }}>
                {current.phonetic}
              </p>
              <button
                onClick={handleSpeak}
                className="w-10 h-10 rounded-full flex items-center justify-center mt-1"
                style={{ background: 'rgba(232,116,76,0.1)' }}
                aria-label="Listen"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M11 5L6 9H2v6h4l5 4V5z" fill="#E8744C" />
                  <path d="M15.54 8.46a5 5 0 010 7.07" stroke="#E8744C" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>

              <div className="flex gap-3 mt-4">
                {isLast && revealed ? (
                  <button
                    onClick={onExit}
                    className="px-6 py-3 rounded-2xl text-white font-medium"
                    style={{
                      background: 'linear-gradient(135deg, #E8744C, #D4973A)',
                      fontFamily: 'DM Sans',
                    }}
                  >
                    Done — {score + 1}/{total} correct
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => handleNext(false)}
                      className="px-5 py-2.5 rounded-2xl text-charcoal/60 font-medium text-sm"
                      style={{
                        background: 'rgba(42,42,42,0.06)',
                        fontFamily: 'DM Sans',
                      }}
                    >
                      Still learning
                    </button>
                    <button
                      onClick={() => handleNext(true)}
                      className="px-5 py-2.5 rounded-2xl text-white font-medium text-sm"
                      style={{
                        background: 'linear-gradient(135deg, #4CAF50, #66BB6A)',
                        fontFamily: 'DM Sans',
                      }}
                    >
                      I knew it
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </motion.div>
      </AnimatePresence>

      <button
        onClick={onExit}
        className="self-center mt-4 text-charcoal/40 text-sm active:opacity-60"
        style={{ fontFamily: 'DM Sans' }}
      >
        Exit quiz
      </button>
    </div>
  );
}

export function LessonScreen({ roomCode, userLang, targetLang, onBack }: Props) {
  const [lesson, setLesson] = useState<LessonResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [quizMode, setQuizMode] = useState(false);

  const targetLabel = LANGUAGES.find(l => l.code === targetLang)?.label ?? targetLang;
  const targetFlag = LANGUAGES.find(l => l.code === targetLang)?.flag ?? '';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    getRoomLesson(roomCode, userLang, targetLang)
      .then(data => {
        if (!cancelled) setLesson(data);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load lesson');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [roomCode, userLang, targetLang]);

  const groupedPhrases = lesson?.phrases.reduce<Record<string, LessonPhrase[]>>((acc, p) => {
    const cat = p.category;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(p);
    return acc;
  }, {});

  return (
    <div className="relative h-full flex flex-col safe-top safe-bottom" style={{ background: '#FAF7F2' }}>
      {/* Header */}
      <div className="relative z-10 px-5 pt-4 pb-3" style={{ borderBottom: '1px solid rgba(42,42,42,0.06)' }}>
        <div className="flex items-center justify-between">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-charcoal/50 active:opacity-60"
            style={{ fontFamily: 'DM Sans', fontSize: '0.875rem' }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back
          </button>
          {lesson && lesson.phrases.length > 1 && !quizMode && (
            <button
              onClick={() => setQuizMode(true)}
              className="px-4 py-2 rounded-full text-xs font-medium uppercase tracking-wider active:scale-95 transition-all"
              style={{
                background: 'linear-gradient(135deg, #E8744C, #D4973A)',
                color: 'white',
                fontFamily: 'DM Sans',
                fontSize: '0.65rem',
              }}
            >
              Flashcard quiz
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-5">
        {loading && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <motion.div
              className="w-10 h-10 rounded-full border-2 border-coral/30 border-t-coral"
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            />
            <p className="text-charcoal/45 text-sm" style={{ fontFamily: 'DM Sans' }}>
              Generating your lesson...
            </p>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <p className="text-red-400 text-sm" style={{ fontFamily: 'DM Sans' }}>{error}</p>
            <button onClick={onBack} className="text-coral text-sm" style={{ fontFamily: 'DM Sans' }}>
              Go back
            </button>
          </div>
        )}

        {lesson && !quizMode && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            <div className="mb-2">
              <h1
                style={{ fontFamily: 'Fraunces, serif', fontSize: 'clamp(1.6rem, 5vw, 2.2rem)', fontWeight: 300, color: '#1A1612' }}
              >
                {targetFlag} Learn {targetLabel}
              </h1>
              <p className="text-charcoal/50 text-sm mt-1" style={{ fontFamily: 'DM Sans' }}>
                Key phrases from room {roomCode}
              </p>
            </div>

            {groupedPhrases && Object.entries(groupedPhrases).map(([category, phrases]) => (
              <div key={category}>
                <h3
                  className="text-coral text-xs uppercase tracking-wider mb-3"
                  style={{ fontFamily: 'DM Sans' }}
                >
                  {CATEGORY_LABELS[category] ?? category}
                </h3>
                <div className="space-y-3">
                  {phrases.map(phrase => (
                    <PhraseCard key={phrase.id} phrase={phrase} targetLang={targetLang} />
                  ))}
                </div>
              </div>
            ))}
          </motion.div>
        )}

        {lesson && quizMode && (
          <FlashcardQuiz
            phrases={lesson.phrases}
            targetLang={targetLang}
            onExit={() => setQuizMode(false)}
          />
        )}
      </div>
    </div>
  );
}
