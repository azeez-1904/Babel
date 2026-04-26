import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { StatusOrb } from './StatusOrb';
import { useSpeechRecognition, speakText } from '../hooks/useSpeech';
import { useNoiseSuppression } from '../hooks/useNoiseSuppression';
import { LANGUAGES } from '../lib/types';
import type { OrbState, VocabCard } from '../lib/types';

interface Props {
  myUserId: string;
  onLeave: () => void;
  send: (payload: object) => void;
  onMessage: (type: string, handler: (msg: Record<string, unknown>) => void) => () => void;
}

interface Exchange {
  userText: string;
  attemptedTarget: boolean;
  translation: string;
  phonetic: string;
  correction?: string;
  correctionNote?: string;
  encouragement: string;
  vocabCards: VocabCard[];
  suggestedReply: string;
  suggestedReplyTranslation: string;
  suggestedReplyPhonetic: string;
}

interface PracticePrompt {
  phrase: string;
  phonetic: string;
  translation: string;
  context: string;
}

type TryFeedback = {
  userSaid: string;
  match: 'good' | 'close' | 'mismatch';
  message: string;
};

function comparePhrases(expected: string, actual: string): TryFeedback['match'] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-záéíóúñüàèìòùâêîôûäëïöü\s]/g, '').trim().split(/\s+/).join(' ');
  const e = norm(expected);
  const a = norm(actual);
  if (a === e) return 'good';
  const eWords = e.split(' ');
  const aWords = a.split(' ');
  let hits = 0;
  for (const w of aWords) { if (eWords.includes(w)) hits++; }
  const ratio = eWords.length > 0 ? hits / eWords.length : 0;
  if (ratio >= 0.6) return 'close';
  return 'mismatch';
}

function VocabCardComponent({ card, targetLang, onSpeak }: { card: VocabCard; targetLang: string; onSpeak: (text: string, lang: string, onEnd?: () => void) => void }) {
  const [speaking, setSpeaking] = useState(false);

  const handleSpeak = () => {
    setSpeaking(true);
    onSpeak(card.word, targetLang, () => setSpeaking(false));
  };

  return (
    <div
      className="rounded-xl p-3"
      style={{ background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(42,42,42,0.06)' }}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <div>
          <span className="text-ink font-medium" style={{ fontFamily: 'DM Sans', fontSize: '0.9rem' }}>
            {card.word}
          </span>
          <span className="text-charcoal/40 italic ml-2" style={{ fontFamily: 'DM Sans', fontSize: '0.75rem' }}>
            {card.phonetic}
          </span>
        </div>
        <button
          onClick={handleSpeak}
          className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center active:scale-90"
          style={{ background: speaking ? 'rgba(232,116,76,0.2)' : 'rgba(232,116,76,0.08)' }}
          aria-label="Listen"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M11 5L6 9H2v6h4l5 4V5z" fill="#E8744C" />
          </svg>
        </button>
      </div>
      <p className="text-charcoal/60 text-xs" style={{ fontFamily: 'DM Sans' }}>{card.translation}</p>
      {card.example_sentence && (
        <p className="text-charcoal/40 text-xs mt-1 italic" style={{ fontFamily: 'DM Sans' }}>
          {card.example_sentence}
        </p>
      )}
    </div>
  );
}

function NoiseButton({ active, onToggle, level }: { active: boolean; onToggle: () => void; level: number }) {
  const bars = 5;
  return (
    <div className="flex flex-col items-center gap-1">
      <motion.button
        onClick={onToggle}
        whileTap={{ scale: 0.92 }}
        className="relative flex items-center justify-center rounded-full transition-all"
        style={{
          width: 40, height: 40,
          background: active
            ? 'linear-gradient(135deg, rgba(212,151,58,0.2), rgba(232,116,76,0.15))'
            : 'rgba(255,255,255,0.8)',
          border: active ? '1.5px solid rgba(212,151,58,0.4)' : '1.5px solid rgba(42,42,42,0.12)',
          backdropFilter: 'blur(8px)',
        }}
        aria-label={active ? 'Disable noise suppression' : 'Enable noise suppression'}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M2 12h2M20 12h2M6 8v8M18 8v8M10 5v14M14 5v14"
            stroke={active ? '#D4973A' : '#2A2A2A80'}
            strokeWidth="1.8" strokeLinecap="round" />
          {active && (
            <motion.line x1="0" y1="12" x2="24" y2="12"
              stroke="rgba(232,116,76,0.3)" strokeWidth="1"
              strokeDasharray="3 3"
              animate={{ x1: [-4, 4], x2: [20, 28] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
            />
          )}
        </svg>
      </motion.button>
      <AnimatePresence>
        {active && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-end gap-0.5"
            style={{ height: 14 }}
          >
            {Array.from({ length: bars }).map((_, i) => {
              const threshold = (i + 1) / bars;
              const lit = level >= threshold - 0.15;
              return (
                <motion.div
                  key={i}
                  className="rounded-sm"
                  style={{
                    width: 3,
                    height: 4 + i * 2,
                    background: lit
                      ? i < 3 ? '#D4973A' : '#E8744C'
                      : 'rgba(42,42,42,0.12)',
                    transition: 'background 0.1s',
                  }}
                />
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
      {active && (
        <span style={{ fontFamily: 'DM Sans', fontSize: '0.55rem', color: '#D4973A', letterSpacing: '0.05em' }}>
          NS ON
        </span>
      )}
    </div>
  );
}

export function SoloPracticeScreen({ myUserId, onLeave, send, onMessage }: Props) {
  const [phase, setPhase] = useState<'setup' | 'practice'>('setup');
  const [nativeLang, setNativeLang] = useState('en-US');
  const [targetLang, setTargetLang] = useState('es-ES');
  const [orbState, setOrbState] = useState<OrbState>('idle');
  const [micActive, setMicActive] = useState(false);
  const [attemptTarget, setAttemptTarget] = useState(false);
  const [speakExchanges, setSpeakExchanges] = useState<Exchange[]>([]);
  const [tryFeedback, setTryFeedback] = useState<TryFeedback | null>(null);
  const [allVocab, setAllVocab] = useState<VocabCard[]>([]);
  const [vocabDrawerOpen, setVocabDrawerOpen] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [noiseSuppress, setNoiseSuppress] = useState(false);
  const [latestSuggestion, setLatestSuggestion] = useState<{
    text: string; translation: string; phonetic: string;
  } | null>(null);
  const [currentPrompt, setCurrentPrompt] = useState<PracticePrompt | null>(null);
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptSpoken, setPromptSpoken] = useState(false);

  const { noiseLevel, isActive: nsActive } = useNoiseSuppression(noiseSuppress);

  const scrollRef = useRef<HTMLDivElement>(null);
  const currentLangRef = useRef(nativeLang);
  currentLangRef.current = attemptTarget ? targetLang : nativeLang;
  const attemptTargetRef = useRef(attemptTarget);
  attemptTargetRef.current = attemptTarget;

  const exchanges = speakExchanges;
  const ttsPlayingRef = useRef(false);
  const currentPromptRef = useRef(currentPrompt);
  currentPromptRef.current = currentPrompt;

  const ttsSpeak = useCallback((text: string, lang: string, extraOnEnd?: () => void) => {
    ttsPlayingRef.current = true;
    setMicActive(false);
    speakText(text, lang, undefined, () => {
      ttsPlayingRef.current = false;
      setTimeout(() => {
        setMicActive(true);
        extraOnEnd?.();
      }, 300);
    });
  }, []);

  const targetLabel = LANGUAGES.find(l => l.code === targetLang)?.label ?? targetLang;
  const targetFlag = LANGUAGES.find(l => l.code === targetLang)?.flag ?? '';
  const nativeLabel = LANGUAGES.find(l => l.code === nativeLang)?.label ?? nativeLang;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [speakExchanges, attemptTarget]);

  const requestPrompt = useCallback(() => {
    setPromptLoading(true);
    setPromptSpoken(false);
    send({ type: 'solo_request_prompt' });
  }, [send]);

  useEffect(() => {
    const unsubs = [
      onMessage('solo_joined', () => {
        setPhase('practice');
        setMicActive(true);
        setOrbState('listening');
      }),
      onMessage('solo_response', (msg) => {
        const responseData = {
          translation: msg.translation as string,
          phonetic: msg.phonetic as string,
          correction: msg.correction as string | undefined,
          correctionNote: msg.correction_note as string | undefined,
          encouragement: msg.encouragement as string,
          vocabCards: (msg.vocab_cards as VocabCard[]) ?? [],
          suggestedReply: msg.suggested_reply as string,
          suggestedReplyTranslation: msg.suggested_reply_translation as string,
          suggestedReplyPhonetic: msg.suggested_reply_phonetic as string,
        };
        if (!attemptTargetRef.current) {
          setSpeakExchanges(prev => {
            const updated = [...prev];
            const last = updated.length > 0 ? updated[updated.length - 1] : null;
            if (last && !last.translation) {
              updated[updated.length - 1] = { ...last, ...responseData };
            } else {
              updated.push({ userText: '', attemptedTarget: false, ...responseData });
            }
            return updated;
          });
          setAllVocab(prev => [...prev, ...(responseData.vocabCards ?? [])]);
          setOrbState('idle');
          setTimeout(() => setMicActive(true), 300);
        } else {
          setOrbState('idle');
        }
      }),
      onMessage('solo_prompt', (msg) => {
        const prompt: PracticePrompt = {
          phrase: msg.phrase as string,
          phonetic: msg.phonetic as string,
          translation: msg.translation as string,
          context: msg.context as string,
        };
        setCurrentPrompt(prompt);
        setPromptLoading(false);
        setPromptSpoken(false);
        setOrbState('idle');
      }),
      onMessage('solo_ended', () => {
        onLeave();
      }),
      onMessage('state_change', (msg) => {
        if (msg.user === myUserId) {
          const state = msg.state as OrbState;
          if (state === 'thinking') setOrbState('thinking');
          else if (state === 'idle') setOrbState('idle');
        }
      }),
    ];
    return () => unsubs.forEach(u => u());
  }, [onMessage, myUserId, onLeave, send]);

  useEffect(() => {
    if (attemptTarget && currentPrompt && !promptSpoken) {
      setPromptSpoken(true);
      setTryFeedback(null);
      ttsSpeak(currentPrompt.phrase, targetLang);
    }
  }, [attemptTarget, currentPrompt, promptSpoken, targetLang, ttsSpeak]);

  useEffect(() => {
    if (attemptTarget && phase === 'practice' && !currentPrompt && !promptLoading) {
      requestPrompt();
    }
  }, [attemptTarget, phase, currentPrompt, promptLoading, requestPrompt]);

  const handleStart = () => {
    send({ type: 'join_solo', native_lang: nativeLang, target_lang: targetLang });
  };

  const handleFinal = useCallback((text: string) => {
    setInterimText('');
    setMicActive(false);

    if (attemptTargetRef.current) {
      const prompt = currentPromptRef.current;
      if (!prompt) return;
      const match = comparePhrases(prompt.phrase, text);
      const message = match === 'good'
        ? 'Perfect! You nailed it.'
        : match === 'close'
        ? 'Almost there! A few words were off.'
        : `Not quite. The phrase was: "${prompt.phrase}"`;
      setTryFeedback({ userSaid: text, match, message });
      setOrbState('idle');
    } else {
      setSpeakExchanges(prev => [...prev, {
        userText: text,
        attemptedTarget: false,
        translation: '',
        phonetic: '',
        encouragement: '',
        vocabCards: [],
        suggestedReply: '',
        suggestedReplyTranslation: '',
        suggestedReplyPhonetic: '',
      }]);
      send({ type: 'solo_utterance', original_text: text, attempted_target: false });
      setOrbState('thinking');
    }
  }, [send]);

  const handleInterim = useCallback((text: string) => {
    setInterimText(text);
  }, []);

  const handleSpeechState = useCallback((state: 'listening' | 'idle') => {
    if (state === 'listening') setOrbState('listening');
    else if (orbState !== 'thinking') setOrbState('idle');
  }, [orbState]);

  useSpeechRecognition({
    lang: attemptTarget ? targetLang : nativeLang,
    onFinal: handleFinal,
    onInterim: handleInterim,
    onStateChange: handleSpeechState,
    enabled: micActive && phase === 'practice',
  });

  const handleEnd = () => {
    setMicActive(false);
    send({ type: 'solo_end' });
    onLeave();
  };

  // ── Setup screen ──────────────────────────────────────────────────────────
  if (phase === 'setup') {
    return (
      <div className="relative h-full flex flex-col items-center justify-center px-6 safe-top safe-bottom"
           style={{ background: '#FAF7F2' }}>
        {/* Ambient glow */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div
            className="absolute rounded-full opacity-40 blur-3xl"
            style={{
              width: '70vw', height: '70vw', maxWidth: 450, maxHeight: 450,
              top: '-15%', right: '-15%',
              background: 'radial-gradient(circle, #E8744C 0%, #D4973A 60%, transparent 100%)',
            }}
          />
          <div
            className="absolute rounded-full opacity-20 blur-3xl"
            style={{
              width: '50vw', height: '50vw', maxWidth: 350, maxHeight: 350,
              bottom: '-8%', left: '-10%',
              background: 'radial-gradient(circle, #D4973A 0%, #E8744C 50%, transparent 100%)',
            }}
          />
        </div>

        <motion.div
          className="relative z-10 flex flex-col items-center w-full max-w-sm"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <button
            onClick={onLeave}
            className="self-start mb-8 flex items-center gap-1.5 text-charcoal/50 active:opacity-60"
            style={{ fontFamily: 'DM Sans', fontSize: '0.875rem' }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back
          </button>

          <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: '2rem', fontWeight: 300, color: '#1A1612' }}
              className="mb-2 text-center">
            Solo practice
          </h2>
          <p className="text-charcoal/50 text-sm mb-8 text-center" style={{ fontFamily: 'DM Sans' }}>
            Practice speaking with an AI tutor
          </p>

          <div className="w-full mb-6">
            <label className="block text-xs uppercase tracking-widest text-charcoal/40 mb-2 text-center"
                   style={{ fontFamily: 'DM Sans', fontSize: '0.65rem' }}>
              I speak
            </label>
            <div className="relative">
              <select
                value={nativeLang}
                onChange={e => setNativeLang(e.target.value)}
                className="w-full appearance-none rounded-2xl border border-fog text-charcoal text-center
                           py-3.5 px-4 text-base cursor-pointer outline-none focus:border-coral/60"
                style={{ background: 'rgba(255,255,255,0.7)', fontFamily: 'DM Sans' }}
              >
                {LANGUAGES.map(l => (
                  <option key={l.code} value={l.code}>{l.flag} {l.label}</option>
                ))}
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-charcoal/40">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
          </div>

          <div className="w-full mb-6">
            <label className="block text-xs uppercase tracking-widest text-charcoal/40 mb-2 text-center"
                   style={{ fontFamily: 'DM Sans', fontSize: '0.65rem' }}>
              I want to learn
            </label>
            <div className="relative">
              <select
                value={targetLang}
                onChange={e => setTargetLang(e.target.value)}
                className="w-full appearance-none rounded-2xl border border-fog text-charcoal text-center
                           py-3.5 px-4 text-base cursor-pointer outline-none focus:border-coral/60"
                style={{ background: 'rgba(255,255,255,0.7)', fontFamily: 'DM Sans' }}
              >
                {LANGUAGES.filter(l => l.code !== nativeLang).map(l => (
                  <option key={l.code} value={l.code}>{l.flag} {l.label}</option>
                ))}
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-charcoal/40">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
          </div>

          <button
            onClick={handleStart}
            className="w-full py-4 rounded-2xl text-white font-medium text-base transition-all active:scale-[0.97]"
            style={{
              background: 'linear-gradient(135deg, #E8744C 0%, #D4973A 100%)',
              fontFamily: 'DM Sans',
              boxShadow: '0 4px 24px rgba(232,116,76,0.4)',
            }}
          >
            Start practicing →
          </button>
        </motion.div>
      </div>
    );
  }

  // ── Practice screen ─────────────────────────────────────────────────────
  return (
    <div className="relative h-full flex flex-col safe-top safe-bottom" style={{ background: '#FAF7F2' }}>
      {/* Ambient glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <motion.div
          className="absolute rounded-full blur-3xl"
          style={{ width: '120%', height: '60%', bottom: '-20%', left: '-10%' }}
          animate={{
            background: orbState === 'thinking'
              ? 'radial-gradient(ellipse, rgba(212,151,58,0.12) 0%, transparent 70%)'
              : orbState === 'listening'
              ? 'radial-gradient(ellipse, rgba(232,116,76,0.1) 0%, transparent 70%)'
              : 'radial-gradient(ellipse, rgba(232,116,76,0.05) 0%, transparent 70%)',
          }}
          transition={{ duration: 0.8 }}
        />
      </div>

      {/* Header — constrained width */}
      <div className="relative z-10 w-full">
        <div className="max-w-2xl mx-auto px-5 pt-4 pb-3" style={{ borderBottom: '1px solid rgba(42,42,42,0.06)' }}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: 'linear-gradient(135deg, #E8744C, #D4973A)' }}
              />
              <span style={{ fontFamily: 'DM Sans', fontSize: '0.75rem', color: '#2A2A2A50' }}>
                Learning
              </span>
              <span className="font-medium text-coral" style={{ fontFamily: 'DM Sans', fontSize: '0.9rem' }}>
                {targetFlag} {targetLabel}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {allVocab.length > 0 && (
                <button
                  onClick={() => setVocabDrawerOpen(true)}
                  className="px-3 h-8 rounded-full flex items-center justify-center bg-coral/12 active:bg-coral/20 transition-colors"
                  style={{ fontFamily: 'DM Sans', fontSize: '0.72rem', color: '#E8744C' }}
                >
                  Words ({allVocab.length})
                </button>
              )}
              <button
                onClick={handleEnd}
                className="w-8 h-8 rounded-full flex items-center justify-center
                           bg-charcoal/8 active:bg-charcoal/15 transition-colors"
                aria-label="Leave session"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M9 3L3 9M3 3l6 6" stroke="#2A2A2A" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>

          {/* Speaking mode toggle */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setAttemptTarget(false); setInterimText(''); }}
              className="px-3 py-1.5 rounded-full text-xs transition-all"
              style={{
                fontFamily: 'DM Sans',
                background: !attemptTarget ? 'rgba(232,116,76,0.12)' : 'rgba(42,42,42,0.04)',
                color: !attemptTarget ? '#E8744C' : '#2A2A2A80',
                fontWeight: !attemptTarget ? 500 : 400,
                fontSize: '0.72rem',
              }}
            >
              Speak {nativeLabel}
            </button>
            <button
              onClick={() => { setAttemptTarget(true); setInterimText(''); }}
              className="px-3 py-1.5 rounded-full text-xs transition-all"
              style={{
                fontFamily: 'DM Sans',
                background: attemptTarget ? 'rgba(212,151,58,0.12)' : 'rgba(42,42,42,0.04)',
                color: attemptTarget ? '#D4973A' : '#2A2A2A80',
                fontWeight: attemptTarget ? 500 : 400,
                fontSize: '0.72rem',
              }}
            >
              Try {targetLabel}
            </button>
          </div>
        </div>
      </div>

      {/* Chat area — constrained width */}
      <div ref={scrollRef} className="relative z-10 flex-1 overflow-y-auto min-h-0">
        <div className="max-w-2xl mx-auto px-5 py-4 space-y-4">

          {/* ── "Try [language]" mode: prompt + feedback card ── */}
          {attemptTarget && (
            <AnimatePresence mode="wait">
              {promptLoading && !currentPrompt && (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center text-center pt-10"
                >
                  <motion.div
                    className="w-12 h-12 rounded-full mb-4"
                    style={{ background: 'rgba(212,151,58,0.12)' }}
                    animate={{ scale: [1, 1.15, 1], opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  />
                  <p className="text-charcoal/40 text-sm" style={{ fontFamily: 'DM Sans' }}>
                    Generating a phrase for you...
                  </p>
                </motion.div>
              )}

              {currentPrompt && (
                <motion.div
                  key={`prompt-${currentPrompt.phrase}`}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex flex-col items-center text-center pt-6 pb-2"
                >
                  <p className="text-xs uppercase tracking-widest mb-4"
                     style={{ fontFamily: 'DM Sans', color: '#D4973A', fontSize: '0.6rem', letterSpacing: '0.12em' }}>
                    {currentPrompt.context}
                  </p>

                  <div
                    className="w-full rounded-2xl px-6 py-5"
                    style={{
                      background: 'linear-gradient(135deg, rgba(212,151,58,0.08), rgba(232,116,76,0.06))',
                      border: '1.5px solid rgba(212,151,58,0.18)',
                    }}
                  >
                    <p className="text-xs uppercase tracking-wider mb-3"
                       style={{ fontFamily: 'DM Sans', color: '#D4973A', fontSize: '0.55rem' }}>
                      Try saying
                    </p>
                    <p className="text-ink text-lg leading-relaxed mb-1"
                       style={{ fontFamily: 'Fraunces, serif', fontWeight: 400, fontSize: '1.4rem' }}>
                      {currentPrompt.phrase}
                    </p>
                    <p className="text-charcoal/50 italic text-sm mb-1" style={{ fontFamily: 'DM Sans' }}>
                      {currentPrompt.phonetic}
                    </p>
                    <p className="text-charcoal/35 text-xs" style={{ fontFamily: 'DM Sans' }}>
                      {currentPrompt.translation}
                    </p>

                    {/* Feedback area */}
                    <AnimatePresence>
                      {tryFeedback && (
                        <motion.div
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          className="mt-4 rounded-xl px-4 py-3"
                          style={{
                            background: tryFeedback.match === 'good'
                              ? 'rgba(76,175,80,0.08)'
                              : tryFeedback.match === 'close'
                              ? 'rgba(212,151,58,0.1)'
                              : 'rgba(232,116,76,0.08)',
                            border: tryFeedback.match === 'good'
                              ? '1px solid rgba(76,175,80,0.2)'
                              : tryFeedback.match === 'close'
                              ? '1px solid rgba(212,151,58,0.2)'
                              : '1px solid rgba(232,116,76,0.2)',
                          }}
                        >
                          <p style={{
                            fontFamily: 'DM Sans', fontSize: '0.7rem', fontWeight: 600,
                            color: tryFeedback.match === 'good' ? '#4CAF50'
                              : tryFeedback.match === 'close' ? '#D4973A' : '#E8744C',
                            marginBottom: 4,
                          }}>
                            {tryFeedback.match === 'good' ? '✓ Great!' : tryFeedback.match === 'close' ? '~ Almost' : '✗ Try again'}
                          </p>
                          <p className="text-charcoal/60 text-xs mb-1" style={{ fontFamily: 'DM Sans' }}>
                            You said: <em>"{tryFeedback.userSaid}"</em>
                          </p>
                          <p className="text-charcoal/50 text-xs" style={{ fontFamily: 'DM Sans' }}>
                            {tryFeedback.message}
                          </p>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Buttons */}
                    <div className="mt-4 flex items-center justify-center gap-3">
                      <button
                        onClick={() => ttsSpeak(currentPrompt.phrase, targetLang)}
                        className="flex items-center gap-2 px-4 py-2 rounded-full active:scale-95 transition-transform"
                        style={{
                          background: 'rgba(212,151,58,0.12)',
                          border: '1px solid rgba(212,151,58,0.2)',
                        }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path d="M11 5L6 9H2v6h4l5 4V5z" fill="#D4973A" />
                          <path d="M15.54 8.46a5 5 0 010 7.07" stroke="#D4973A" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                        <span style={{ fontFamily: 'DM Sans', fontSize: '0.78rem', color: '#D4973A', fontWeight: 500 }}>
                          Hear it
                        </span>
                      </button>

                      {tryFeedback ? (
                        <button
                          onClick={() => {
                            setTryFeedback(null);
                            setCurrentPrompt(null);
                            requestPrompt();
                          }}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-full active:scale-95 transition-transform"
                          style={{
                            background: 'linear-gradient(135deg, #E8744C, #D4973A)',
                            border: 'none',
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                            <path d="M5 12h14M12 5l7 7-7 7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          <span style={{ fontFamily: 'DM Sans', fontSize: '0.78rem', color: 'white', fontWeight: 500 }}>
                            Next
                          </span>
                        </button>
                      ) : (
                        <button
                          onClick={() => { setCurrentPrompt(null); requestPrompt(); }}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-full active:scale-95 transition-transform"
                          style={{
                            background: 'rgba(42,42,42,0.04)',
                            border: '1px solid rgba(42,42,42,0.08)',
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                            <path d="M5 12h14M12 5l7 7-7 7" stroke="#2A2A2A80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          <span style={{ fontFamily: 'DM Sans', fontSize: '0.78rem', color: '#2A2A2A80', fontWeight: 500 }}>
                            Skip
                          </span>
                        </button>
                      )}
                    </div>
                  </div>

                  {!tryFeedback && (
                    <p className="text-charcoal/30 text-xs mt-4 max-w-[260px]" style={{ fontFamily: 'DM Sans' }}>
                      Listen, then try saying it.
                    </p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          )}

          {/* ── "Speak [native]" mode: empty state ── */}
          {!attemptTarget && exchanges.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="flex flex-col items-center text-center pt-16"
            >
              <div className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
                   style={{ background: 'rgba(232,116,76,0.08)' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2a3 3 0 00-3 3v6a3 3 0 006 0V5a3 3 0 00-3-3z" fill="#E8744C" opacity="0.5" />
                  <path d="M19 10a7 7 0 01-14 0" stroke="#E8744C" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
                </svg>
              </div>
              <p className="text-charcoal/50 text-sm mb-1" style={{ fontFamily: 'DM Sans', fontWeight: 500 }}>
                Say something to start learning!
              </p>
              <p className="text-charcoal/30 text-xs leading-relaxed max-w-[280px]" style={{ fontFamily: 'DM Sans' }}>
                Speak in {nativeLabel} and get a {targetLabel} translation, or switch to "Try {targetLabel}" above for guided practice.
              </p>
            </motion.div>
          )}

          {/* ── Conversation exchanges (Speak mode only) ── */}
          {!attemptTarget && exchanges.map((ex, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-2"
            >
              {/* User bubble */}
              <div className="flex justify-end">
                <div
                  className="max-w-[80%] rounded-2xl rounded-br-md px-4 py-3"
                  style={{
                    background: ex.attemptedTarget
                      ? 'rgba(212,151,58,0.1)'
                      : 'rgba(232,116,76,0.08)',
                    border: ex.attemptedTarget
                      ? '1px solid rgba(212,151,58,0.18)'
                      : '1px solid rgba(232,116,76,0.12)',
                  }}
                >
                  <p className="text-ink text-sm leading-relaxed" style={{ fontFamily: 'DM Sans' }}>{ex.userText}</p>
                </div>
              </div>

              {/* Tutor response */}
              {ex.translation && (() => {
                const translationLower = ex.translation.toLowerCase().replace(/[^a-záéíóúñüàèìòùâêîôûäëïöü\s]/g, '').trim();
                const dedupedVocab = ex.vocabCards.filter(c =>
                  c.word.toLowerCase().replace(/[^a-záéíóúñüàèìòùâêîôûäëïöü\s]/g, '').trim() !== translationLower
                );
                return (
                <div className="flex justify-start">
                  <div
                    className="max-w-[85%] rounded-2xl rounded-bl-md px-4 py-3 space-y-2"
                    style={{ background: 'rgba(255,255,255,0.75)', border: '1px solid rgba(42,42,42,0.07)' }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-ink leading-relaxed" style={{ fontFamily: 'DM Sans', fontSize: '0.95rem' }}>
                          {ex.translation}
                        </p>
                        <p className="text-charcoal/45 italic text-xs mt-0.5" style={{ fontFamily: 'DM Sans' }}>
                          {ex.phonetic}
                        </p>
                      </div>
                      <button
                        onClick={() => ttsSpeak(ex.translation, targetLang)}
                        className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center active:scale-90"
                        style={{ background: 'rgba(232,116,76,0.1)' }}
                        aria-label="Listen"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                          <path d="M11 5L6 9H2v6h4l5 4V5z" fill="#E8744C" />
                        </svg>
                      </button>
                    </div>

                    {ex.correction && (
                      <div className="rounded-xl px-3 py-2" style={{ background: 'rgba(212,151,58,0.08)' }}>
                        <p className="text-xs uppercase tracking-wider mb-1" style={{ fontFamily: 'DM Sans', color: '#D4973A', fontSize: '0.6rem' }}>
                          Correction
                        </p>
                        <p className="text-ink text-sm" style={{ fontFamily: 'DM Sans' }}>{ex.correction}</p>
                        {ex.correctionNote && (
                          <p className="text-charcoal/50 text-xs mt-1" style={{ fontFamily: 'DM Sans' }}>{ex.correctionNote}</p>
                        )}
                      </div>
                    )}


                    {dedupedVocab.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <p className="text-coral text-xs uppercase tracking-wider" style={{ fontFamily: 'DM Sans', fontSize: '0.55rem' }}>
                          New vocabulary
                        </p>
                        {dedupedVocab.map((card, j) => (
                          <VocabCardComponent key={j} card={card} targetLang={targetLang} onSpeak={ttsSpeak} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                );
              })()}
            </motion.div>
          ))}

          {/* Interim text (Speak mode only) */}
          <AnimatePresence>
            {!attemptTarget && interimText.trim() && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="flex justify-end"
              >
                <div
                  className="max-w-[80%] rounded-2xl px-4 py-3"
                  style={{ background: 'rgba(232,116,76,0.05)', border: '1px dashed rgba(232,116,76,0.2)' }}
                >
                  <p className="text-charcoal/40 italic text-sm" style={{ fontFamily: 'DM Sans' }}>
                    {interimText}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* (suggestion card removed from Speak mode — only used in Try mode now) */}

      {/* Controls area */}
      <div className="relative z-10 w-full">
        <div className="max-w-2xl mx-auto flex flex-col items-center gap-2 pb-4 pt-2">
          <StatusOrb state={micActive ? orbState : 'idle'} size={64} />

          <div className="flex items-end gap-4">
            <NoiseButton active={nsActive} onToggle={() => setNoiseSuppress(p => !p)} level={noiseLevel} />

            <motion.button
              onClick={() => { setMicActive(m => !m); setInterimText(''); }}
              whileTap={{ scale: 0.92 }}
              className="relative flex items-center justify-center rounded-full transition-all"
              style={{
                width: 52, height: 52,
                background: micActive
                  ? 'linear-gradient(135deg, #E8744C, #D4973A)'
                  : 'rgba(255,255,255,0.8)',
                border: micActive ? 'none' : '1.5px solid rgba(42,42,42,0.12)',
                boxShadow: micActive
                  ? '0 4px 20px rgba(232,116,76,0.45)'
                  : '0 2px 8px rgba(0,0,0,0.06)',
                backdropFilter: 'blur(8px)',
              }}
              aria-label={micActive ? 'Stop microphone' : 'Start microphone'}
            >
              {micActive && (
                <motion.div
                  className="absolute inset-0 rounded-full"
                  style={{ border: '2px solid rgba(232,116,76,0.5)' }}
                  animate={{ scale: [1, 1.5], opacity: [0.6, 0] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                />
              )}
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                {micActive ? (
                  <>
                    <rect x="9" y="3" width="6" height="11" rx="3" fill="white" />
                    <path d="M5 10a7 7 0 0014 0" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
                    <line x1="12" y1="17" x2="12" y2="21" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
                    <line x1="9" y1="21" x2="15" y2="21" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
                  </>
                ) : (
                  <>
                    <rect x="9" y="3" width="6" height="11" rx="3" stroke="#2A2A2A" strokeWidth="1.8" fill="none" />
                    <path d="M5 10a7 7 0 0014 0" stroke="#2A2A2A" strokeWidth="1.8" strokeLinecap="round" />
                    <line x1="12" y1="17" x2="12" y2="21" stroke="#2A2A2A" strokeWidth="1.8" strokeLinecap="round" />
                    <line x1="9" y1="21" x2="15" y2="21" stroke="#2A2A2A" strokeWidth="1.8" strokeLinecap="round" />
                    <line x1="4" y1="4" x2="20" y2="20" stroke="#E8744C" strokeWidth="1.8" strokeLinecap="round" />
                  </>
                )}
              </svg>
            </motion.button>

            {/* Spacer to balance the NS button */}
            <div style={{ width: 40 }} />
          </div>

          <p className="text-charcoal/35" style={{ fontFamily: 'DM Sans', fontSize: '0.7rem' }}>
            {!micActive ? 'Tap mic to start listening' :
             orbState === 'listening' ? (attemptTarget ? `Now try saying it in ${targetLabel}...` : 'Listening — speak now') :
             orbState === 'thinking' ? (attemptTarget ? 'Checking...' : 'Translating...') :
             attemptTarget ? 'Listen, then repeat' : 'Ready'}
          </p>
        </div>
      </div>

      {/* Vocab drawer */}
      <AnimatePresence>
        {vocabDrawerOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 flex items-end bg-ink/20"
            onClick={() => setVocabDrawerOpen(false)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              onClick={e => e.stopPropagation()}
              className="w-full max-h-[72%] overflow-y-auto rounded-t-[2rem] px-5 pt-5 pb-8"
              style={{ background: '#FAF7F2', border: '1px solid rgba(42,42,42,0.08)' }}
            >
              <div className="max-w-2xl mx-auto">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: '1.6rem', fontWeight: 300 }}>
                      Word bank
                    </h2>
                    <p className="text-charcoal/45 text-sm" style={{ fontFamily: 'DM Sans' }}>
                      {allVocab.length} word{allVocab.length !== 1 ? 's' : ''} learned this session
                    </p>
                  </div>
                  <button
                    onClick={() => setVocabDrawerOpen(false)}
                    className="w-8 h-8 rounded-full bg-charcoal/8 flex items-center justify-center"
                    aria-label="Close word bank"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M9 3L3 9M3 3l6 6" stroke="#2A2A2A" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
                <div className="space-y-2">
                  {allVocab.map((card, i) => (
                    <VocabCardComponent key={i} card={card} targetLang={targetLang} onSpeak={ttsSpeak} />
                  ))}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
