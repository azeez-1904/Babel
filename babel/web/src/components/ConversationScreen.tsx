import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { StatusOrb, MiniOrb } from './StatusOrb';
import { TranscriptView } from './TranscriptView';
import { useSpeechRecognition, speakText } from '../hooks/useSpeech';
import { useNoiseSuppression } from '../hooks/useNoiseSuppression';
import { finalizeRoomSummary } from '../lib/api';
import type { OrbState, RoomSummary, TechnicalNote, Utterance } from '../lib/types';
import { LANGUAGES } from '../lib/types';

interface Peer { userId: string; lang: string; isDevice: boolean }

interface Props {
  roomCode: string;
  myLang: string;
  myUserId: string;
  roomSize: number;
  onLeave: () => void;
  send: (payload: object) => void;
  onMessage: (type: string, handler: (msg: Record<string, unknown>) => void) => () => void;
}

// ─── Distress banner ─────────────────────────────────────────────────────────
function DistressBanner({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -60, opacity: 0 }}
          className="absolute top-0 left-0 right-0 z-50 flex items-center justify-center gap-2
                     bg-red-500 text-white px-4 py-3"
          style={{ fontFamily: 'DM Sans', fontWeight: 500, fontSize: '0.9rem' }}
        >
          ⚠ Possible medical distress — please check on this person
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Toast notification ───────────────────────────────────────────────────────
function Toast({ message, visible }: { message: string; visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="absolute bottom-32 left-1/2 -translate-x-1/2 z-40
                     px-4 py-2 rounded-full text-xs text-white/90 whitespace-nowrap"
          style={{
            background: 'rgba(42,42,42,0.75)',
            backdropFilter: 'blur(8px)',
            fontFamily: 'DM Sans',
          }}
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Peer chip ────────────────────────────────────────────────────────────────
function PeerChip({ peer }: { peer: Peer }) {
  const lang = LANGUAGES.find(l => l.code === peer.lang);
  if (peer.isDevice) {
    return (
      <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-charcoal/6"
           style={{ fontFamily: 'DM Sans', fontSize: '0.7rem', color: '#2A2A2A99' }}>
        <span>📟</span>
        <span>ESP32</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-charcoal/6"
         style={{ fontFamily: 'DM Sans', fontSize: '0.7rem', color: '#2A2A2A99' }}>
      <span>{lang?.flag ?? '🌐'}</span>
      <span>{lang?.label ?? peer.lang}</span>
    </div>
  );
}

// ─── Mic toggle button ────────────────────────────────────────────────────────
function MicButton({ active, onToggle, disabled }: { active: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <motion.button
      onClick={onToggle}
      disabled={disabled}
      whileTap={{ scale: 0.92 }}
      className="relative flex items-center justify-center rounded-full transition-all"
      style={{
        width: 64, height: 64,
        background: active
          ? 'linear-gradient(135deg, #E8744C, #D4973A)'
          : 'rgba(255,255,255,0.8)',
        border: active ? 'none' : '1.5px solid rgba(42,42,42,0.12)',
        boxShadow: active
          ? '0 4px 20px rgba(232,116,76,0.45)'
          : '0 2px 8px rgba(0,0,0,0.06)',
        backdropFilter: 'blur(8px)',
      }}
      aria-label={active ? 'Stop microphone' : 'Start microphone'}
    >
      {/* Pulse ring when active */}
      {active && (
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{ border: '2px solid rgba(232,116,76,0.5)' }}
          animate={{ scale: [1, 1.5], opacity: [0.6, 0] }}
          transition={{ duration: 1.2, repeat: Infinity }}
        />
      )}
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
        {active ? (
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
            {/* Slash */}
            <line x1="4" y1="4" x2="20" y2="20" stroke="#E8744C" strokeWidth="1.8" strokeLinecap="round" />
          </>
        )}
      </svg>
    </motion.button>
  );
}

// ─── Noise suppression button + level meter ──────────────────────────────────
function NoiseButton({ active, onToggle, level }: { active: boolean; onToggle: () => void; level: number }) {
  const bars = 5;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <motion.button
        onClick={onToggle}
        whileTap={{ scale: 0.92 }}
        className="relative flex items-center justify-center rounded-full transition-all"
        style={{
          width: 48, height: 48,
          background: active
            ? 'linear-gradient(135deg, rgba(212,151,58,0.2), rgba(232,116,76,0.15))'
            : 'rgba(255,255,255,0.8)',
          border: active ? '1.5px solid rgba(212,151,58,0.4)' : '1.5px solid rgba(42,42,42,0.12)',
          backdropFilter: 'blur(8px)',
        }}
        aria-label={active ? 'Disable noise suppression' : 'Enable noise suppression'}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          {/* Waveform / noise icon */}
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

      {/* Live audio level bars — only shown when active */}
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

// ─── Audio toggle button ─────────────────────────────────────────────────────
function AudioButton({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <motion.button
      onClick={onToggle}
      whileTap={{ scale: 0.92 }}
      className="relative flex items-center justify-center rounded-full transition-all"
      style={{
        width: 48, height: 48,
        background: active ? 'rgba(255,255,255,0.8)' : 'rgba(42,42,42,0.08)',
        border: active ? '1.5px solid rgba(42,42,42,0.12)' : '1.5px solid rgba(42,42,42,0.2)',
        backdropFilter: 'blur(8px)',
      }}
      aria-label={active ? 'Mute audio' : 'Unmute audio'}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        {active ? (
          <>
            <path d="M11 5L6 9H2v6h4l5 4V5z" fill="#2A2A2A" />
            <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" stroke="#2A2A2A" strokeWidth="1.8" strokeLinecap="round" />
          </>
        ) : (
          <>
            <path d="M11 5L6 9H2v6h4l5 4V5z" fill="#2A2A2A80" />
            <line x1="23" y1="9" x2="17" y2="15" stroke="#E8744C" strokeWidth="1.8" strokeLinecap="round" />
            <line x1="17" y1="9" x2="23" y2="15" stroke="#E8744C" strokeWidth="1.8" strokeLinecap="round" />
          </>
        )}
      </svg>
    </motion.button>
  );
}

// ─── Live interim text ────────────────────────────────────────────────────────
function InterimBubble({ text }: { text: string }) {
  return (
    <AnimatePresence>
      {text.trim().length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          className="mx-6 mb-2 px-4 py-3 rounded-2xl"
          style={{
            background: 'rgba(232,116,76,0.07)',
            border: '1px dashed rgba(232,116,76,0.3)',
          }}
        >
          <p
            className="text-charcoal/50 italic text-sm leading-snug"
            style={{ fontFamily: 'DM Sans', fontWeight: 300 }}
          >
            <span className="text-coral/60 not-italic text-xs mr-2 uppercase tracking-wider"
                  style={{ fontSize: '0.6rem' }}>
              Hearing…
            </span>
            {text}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Peers panel ──────────────────────────────────────────────────────────────
function PeersPanel({ peers, myUserId }: { peers: Peer[]; myUserId: string }) {
  const others = peers.filter(p => p.userId !== myUserId);
  if (others.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {others.map(p => <PeerChip key={p.userId} peer={p} />)}
    </div>
  );
}

function NotesPanel({
  visible,
  notes,
  onClose,
}: {
  visible: boolean;
  notes: TechnicalNote[];
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-40 flex items-end bg-ink/20"
          onClick={onClose}
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
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: '1.6rem', fontWeight: 300 }}>
                  Technical notes
                </h2>
                <p className="text-charcoal/45 text-sm" style={{ fontFamily: 'DM Sans' }}>
                  Shared explanations based on this conversation.
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-charcoal/8 flex items-center justify-center"
                aria-label="Close technical notes"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M9 3L3 9M3 3l6 6" stroke="#2A2A2A" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

            {notes.length === 0 ? (
              <p className="text-charcoal/45 text-sm leading-relaxed" style={{ fontFamily: 'DM Sans' }}>
                When something technical is important to understand, a context-aware explanation and useful follow-up questions will appear here.
              </p>
            ) : (
              <div className="space-y-3">
                {notes.slice().reverse().map(note => (
                  <div
                    key={note.id}
                    className="rounded-2xl p-4"
                    style={{ background: 'rgba(255,255,255,0.68)', border: '1px solid rgba(42,42,42,0.06)' }}
                  >
                    <div className="text-coral text-xs uppercase tracking-wider mb-1" style={{ fontFamily: 'DM Sans' }}>
                      {note.phrase}
                    </div>
                    <p className="text-ink leading-snug mb-2" style={{ fontFamily: 'DM Sans', fontSize: '0.95rem' }}>
                      {note.simple_explanation}
                    </p>
                    {note.conversation_context && (
                      <p
                        className="text-charcoal/60 text-sm leading-snug mb-3 rounded-xl px-3 py-2"
                        style={{ fontFamily: 'DM Sans', background: 'rgba(232,116,76,0.08)' }}
                      >
                        In this conversation: {note.conversation_context}
                      </p>
                    )}
                    {note.why_it_matters && (
                      <p className="text-charcoal/50 text-sm leading-snug mb-3" style={{ fontFamily: 'DM Sans' }}>
                        {note.why_it_matters}
                      </p>
                    )}
                    {note.follow_up_questions.length > 0 && (
                      <div className="space-y-1.5">
                        {note.follow_up_questions.map(question => (
                          <p key={question} className="text-charcoal/60 text-sm" style={{ fontFamily: 'DM Sans' }}>
                            Ask: {question}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SummaryPanel({
  visible,
  loading,
  summary,
  onClose,
}: {
  visible: boolean;
  loading: boolean;
  summary: RoomSummary | null;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-40 flex items-end bg-ink/20"
          onClick={onClose}
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
            <div className="flex items-center justify-between mb-4">
              <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: '1.6rem', fontWeight: 300 }}>
                Room summary
              </h2>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-charcoal/8 flex items-center justify-center"
                aria-label="Close room summary"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M9 3L3 9M3 3l6 6" stroke="#2A2A2A" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

            {loading ? (
              <p className="text-charcoal/45 text-sm" style={{ fontFamily: 'DM Sans' }}>
                Creating a simple summary...
              </p>
            ) : summary ? (
              <div className="space-y-4">
                <p className="text-ink leading-relaxed" style={{ fontFamily: 'DM Sans' }}>
                  {summary.simple_summary}
                </p>
                {summary.key_points.length > 0 && (
                  <div>
                    <h3 className="text-coral text-xs uppercase tracking-wider mb-2" style={{ fontFamily: 'DM Sans' }}>
                      Key points
                    </h3>
                    <div className="space-y-2">
                      {summary.key_points.map(point => (
                        <p key={point} className="text-charcoal/70 text-sm" style={{ fontFamily: 'DM Sans' }}>
                          {point}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
                {summary.suggested_follow_up_questions.length > 0 && (
                  <div>
                    <h3 className="text-coral text-xs uppercase tracking-wider mb-2" style={{ fontFamily: 'DM Sans' }}>
                      Questions to ask next
                    </h3>
                    <div className="space-y-2">
                      {summary.suggested_follow_up_questions.map(question => (
                        <p key={question} className="text-charcoal/70 text-sm" style={{ fontFamily: 'DM Sans' }}>
                          {question}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-charcoal/45 text-sm" style={{ fontFamily: 'DM Sans' }}>
                No summary has been created for this room yet.
              </p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

let utteranceCounter = 0;

export function ConversationScreen({
  roomCode, myLang, myUserId, roomSize, onLeave, send, onMessage,
}: Props) {
  const [orbState, setOrbState] = useState<OrbState>('idle');
  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [distressVisible, setDistressVisible] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [micActive, setMicActive] = useState(true);
  const [audioActive, setAudioActive] = useState(true);
  const [noiseSuppress, setNoiseSuppress] = useState(false);
  const [currentLang, setCurrentLang] = useState(myLang);
  const [langPickerOpen, setLangPickerOpen] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [toast, setToast] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [technicalNotes, setTechnicalNotes] = useState<TechnicalNote[]>([]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [summary, setSummary] = useState<RoomSummary | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const audioActiveRef = useRef(true);
  const currentLangRef = useRef(myLang);
  currentLangRef.current = currentLang;
  const { noiseLevel, isActive: nsActive } = useNoiseSuppression(noiseSuppress);

  const speakQueueRef = useRef<Array<{ text: string; lang: string }>>([]);
  const isSpeakingRef = useRef(false);
  const distressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const myLangObj = LANGUAGES.find(l => l.code === currentLang);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setToastVisible(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastVisible(false), 2200);
  }, []);

  // ── TTS queue ──────────────────────────────────────────────────────────────
  const drainQueue = useCallback(() => {
    if (isSpeakingRef.current || speakQueueRef.current.length === 0) return;
    const next = speakQueueRef.current.shift()!;

    // If audio is off, skip speaking but still clear the queue
    if (!audioActiveRef.current) {
      if (speakQueueRef.current.length > 0) drainQueue();
      return;
    }

    isSpeakingRef.current = true;
    setIsSpeaking(true);
    setOrbState('speaking');
    send({ type: 'state_change', state: 'speaking' });

    speakText(next.text, next.lang, undefined, () => {
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      if (speakQueueRef.current.length > 0) {
        drainQueue();
      } else {
        setOrbState('listening');
        send({ type: 'state_change', state: 'listening' });
      }
    });
  }, [send]);

  const queueSpeak = useCallback((text: string, lang: string) => {
    speakQueueRef.current.push({ text, lang });
    drainQueue();
  }, [drainQueue]);

  const toggleAudio = useCallback(() => {
    const next = !audioActiveRef.current;
    audioActiveRef.current = next;
    setAudioActive(next);
    if (!next) {
      window.speechSynthesis?.cancel();
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      speakQueueRef.current = [];
    }
    showToast(next ? 'Audio on' : 'Audio off');
  }, [showToast]);

  const toggleNoise = useCallback(() => {
    setNoiseSuppress(prev => {
      const next = !prev;
      showToast(next ? 'Noise suppression on' : 'Noise suppression off');
      return next;
    });
  }, [showToast]);

  const changeLang = useCallback((code: string) => {
    setCurrentLang(code);
    setLangPickerOpen(false);
    setInterimText('');
    send({ type: 'update_lang', lang: code });
    const label = LANGUAGES.find(l => l.code === code)?.label ?? code;
    showToast(`Now speaking ${label}`);
  }, [send, showToast]);

  // ── WebSocket messages ──────────────────────────────────────────────────────
  useEffect(() => {
    const unsubs = [
      onMessage('peers_update', (msg) => {
        setPeers((msg.peers as Peer[]) ?? []);
      }),

      onMessage('utterance', (msg) => {
        const u: Utterance = {
          id: `${++utteranceCounter}`,
          from_user: msg.from_user as string,
          isMine: false,
          original_text: msg.original_text as string,
          displayed_text: msg.translated_text as string,
          source_lang: msg.source_lang as string,
          distress_flag: msg.distress_flag as boolean,
          tone_note: msg.tone_note as string,
          timestamp: msg.timestamp as number,
          error: msg.error as boolean | undefined,
        };
        setUtterances(prev => [...prev, u]);
        queueSpeak(u.displayed_text, currentLangRef.current);
        showToast(u.error ? 'Translation failed; showing original text' : 'Translation received');
      }),

      onMessage('utterance_echo', (msg) => {
        const u: Utterance = {
          id: `${++utteranceCounter}`,
          from_user: myUserId,
          isMine: true,
          original_text: msg.original_text as string,
          displayed_text: msg.original_text as string,
          source_lang: currentLangRef.current,
          distress_flag: false,
          tone_note: 'casual',
          timestamp: msg.timestamp as number,
        };
        setUtterances(prev => [...prev, u]);
        showToast('Sent for translation ✓');
      }),

      onMessage('state_change', (msg) => {
        if (msg.user === myUserId) return;
        const state = msg.state as OrbState;
        if (!isSpeakingRef.current) {
          if (state === 'thinking') setOrbState('thinking');
          else if (state === 'listening') setOrbState('listening');
          else if (state === 'idle') setOrbState('idle');
        }
      }),

      onMessage('peer_joined', (msg) => {
        showToast(`Someone joined (${(msg.room_size as number) - 1} peer${(msg.room_size as number) - 1 !== 1 ? 's' : ''} connected)`);
      }),

      onMessage('peer_left', () => {
        showToast('A peer disconnected');
      }),

      onMessage('distress_alert', () => {
        setDistressVisible(true);
        if (distressTimerRef.current) clearTimeout(distressTimerRef.current);
        distressTimerRef.current = setTimeout(() => setDistressVisible(false), 12000);
      }),

      onMessage('technical_notes_update', (msg) => {
        setTechnicalNotes((msg.technical_notes as TechnicalNote[]) ?? []);
        showToast('Technical note added');
      }),

      onMessage('summary_update', (msg) => {
        setSummary((msg.summary as RoomSummary) ?? null);
      }),
    ];

    return () => unsubs.forEach(u => u());
  }, [onMessage, myUserId, queueSpeak, showToast]);

  // ── Speech recognition ──────────────────────────────────────────────────────
  const handleFinal = useCallback((text: string) => {
    setInterimText('');
    send({ type: 'utterance', original_text: text });
    setOrbState('thinking');
    send({ type: 'state_change', state: 'thinking' });
  }, [send]);

  const handleInterim = useCallback((text: string) => {
    setInterimText(text);
  }, []);

  const handleSpeechState = useCallback((state: 'listening' | 'idle') => {
    if (isSpeakingRef.current) return;
    if (state === 'listening') {
      setOrbState('listening');
      send({ type: 'state_change', state: 'listening' });
    } else {
      setOrbState('idle');
    }
  }, [send]);

  useSpeechRecognition({
    lang: currentLang,
    onFinal: handleFinal,
    onInterim: handleInterim,
    onStateChange: handleSpeechState,
    enabled: micActive && !isSpeaking,
  });

  const toggleMic = useCallback(() => {
    const next = !micActive;
    setMicActive(next);
    setInterimText('');
    if (next) {
      setOrbState('listening');
      send({ type: 'state_change', state: 'listening' });
      showToast('Microphone on');
    } else {
      setOrbState('idle');
      send({ type: 'state_change', state: 'idle' });
      showToast('Microphone off');
    }
  }, [micActive, send, showToast]);

  const handleSummary = useCallback(async () => {
    setSummaryOpen(true);
    setSummaryLoading(true);
    try {
      const result = await finalizeRoomSummary(roomCode, currentLangRef.current);
      setSummary(result.summary);
      setTechnicalNotes(result.technical_notes);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not create summary');
    } finally {
      setSummaryLoading(false);
    }
  }, [roomCode, showToast]);

  // Initial state + request current peers list (avoids timing race on mount)
  useEffect(() => {
    setOrbState('listening');
    send({ type: 'state_change', state: 'listening' });
    send({ type: 'request_peers' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const peersWithoutMe = peers.filter(p => p.userId !== myUserId);
  const peerCount = peersWithoutMe.length;
  const visibleRoomSize = Math.max(roomSize, peers.length);

  return (
    <div className="relative h-full flex flex-col safe-top safe-bottom no-select"
         style={{ background: '#FAF7F2' }}>
      <DistressBanner visible={distressVisible} />

      {/* Ambient glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <motion.div
          className="absolute rounded-full blur-3xl"
          style={{ width: '120%', height: '60%', bottom: '-20%', left: '-10%' }}
          animate={{
            background: orbState === 'speaking'
              ? 'radial-gradient(ellipse, rgba(232,116,76,0.15) 0%, transparent 70%)'
              : orbState === 'thinking'
              ? 'radial-gradient(ellipse, rgba(212,151,58,0.12) 0%, transparent 70%)'
              : 'radial-gradient(ellipse, rgba(232,116,76,0.06) 0%, transparent 70%)',
          }}
          transition={{ duration: 0.8 }}
        />
      </div>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="relative z-10 px-5 pt-4 pb-3"
           style={{ borderBottom: '1px solid rgba(42,42,42,0.06)' }}>
        {/* Row 1: room code + leave */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <MiniOrb state={orbState} />
            <span style={{ fontFamily: 'DM Sans', fontSize: '0.72rem', color: '#2A2A2A60' }}>
              Room
            </span>
            <span
              className="font-medium text-charcoal/75"
              style={{ fontFamily: 'DM Sans, monospace', fontSize: '0.85rem', letterSpacing: '0.18em' }}
            >
              {roomCode}
            </span>
            {visibleRoomSize > 0 && (
              <span style={{ fontFamily: 'DM Sans', fontSize: '0.65rem', color: '#2A2A2A35' }}>
                {visibleRoomSize} connected
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setNotesOpen(true)}
              className="px-3 h-7 rounded-full flex items-center justify-center bg-charcoal/8 active:bg-charcoal/15 transition-colors"
              style={{ fontFamily: 'DM Sans', fontSize: '0.7rem', color: '#2A2A2A' }}
            >
              Notes {technicalNotes.length > 0 ? `(${technicalNotes.length})` : ''}
            </button>
            <button
              onClick={handleSummary}
              className="px-3 h-7 rounded-full flex items-center justify-center bg-coral/12 active:bg-coral/20 transition-colors"
              style={{ fontFamily: 'DM Sans', fontSize: '0.7rem', color: '#E8744C' }}
            >
              Summary
            </button>
            <button
              onClick={onLeave}
              className="w-7 h-7 rounded-full flex items-center justify-center
                         bg-charcoal/8 active:bg-charcoal/15 transition-colors"
              aria-label="Leave room"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M9 3L3 9M3 3l6 6" stroke="#2A2A2A" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Row 2: my language (tappable) + peers */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Me — tap to change language */}
          <button
            onClick={() => setLangPickerOpen(true)}
            className="flex items-center gap-1 px-2 py-1 rounded-full active:opacity-70 transition-opacity"
            style={{
              background: 'linear-gradient(135deg, rgba(232,116,76,0.15), rgba(212,151,58,0.1))',
              border: '1px solid rgba(232,116,76,0.2)',
              fontFamily: 'DM Sans', fontSize: '0.7rem',
            }}>
            <span>{myLangObj?.flag}</span>
            <span className="text-coral font-medium">{myLangObj?.label ?? currentLang}</span>
            <span className="text-charcoal/30 ml-0.5">(you)</span>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="ml-0.5 text-coral/50">
              <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {peerCount > 0 ? (
            <>
              <span style={{ color: '#2A2A2A25', fontSize: '0.7rem' }}>↔</span>
              <PeersPanel peers={peers} myUserId={myUserId} />
            </>
          ) : (
            <span style={{ fontFamily: 'DM Sans', fontSize: '0.7rem', color: '#2A2A2A40' }}>
              Waiting for someone to join…
            </span>
          )}
        </div>
      </div>

      {/* ── Transcript ─────────────────────────────────────────────────────── */}
      <div className="relative z-10 flex-1 flex flex-col justify-end pb-2 min-h-0 overflow-hidden">
        {utterances.length === 0 && peerCount === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.2 }}
            className="flex flex-col items-center px-8 pb-4 text-center"
          >
            <p style={{ fontFamily: 'DM Sans', fontSize: '0.875rem', color: '#2A2A2A40', lineHeight: 1.6 }}>
              Share the code <strong style={{ fontFamily: 'DM Sans, monospace', letterSpacing: '0.15em', color: '#2A2A2A60' }}>{roomCode}</strong> with someone,<br/>
              then speak — translation happens automatically.
            </p>
          </motion.div>
        )}
        {utterances.length === 0 && peerCount > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center px-8 pb-4 text-center"
          >
            <p style={{ fontFamily: 'DM Sans', fontSize: '0.875rem', color: '#2A2A2A40' }}>
              Start speaking — your voice will be translated
            </p>
          </motion.div>
        )}

        <TranscriptView utterances={utterances} />
        <InterimBubble text={interimText} />
      </div>

      {/* ── Orb + mic button ───────────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-col items-center gap-5 pb-10">
        <StatusOrb state={micActive ? orbState : 'idle'} size={120} />

        <div className="flex items-end gap-4">
          <AudioButton active={audioActive} onToggle={toggleAudio} />
          <MicButton active={micActive} onToggle={toggleMic} />
          <NoiseButton active={nsActive} onToggle={toggleNoise} level={noiseLevel} />
        </div>

        <motion.p
          className="text-charcoal/35"
          style={{ fontFamily: 'DM Sans', fontSize: '0.72rem' }}
          animate={{ opacity: [0.5, 0.8, 0.5] }}
          transition={{ duration: 3, repeat: Infinity }}
        >
          {!micActive         ? 'Tap mic to start listening' :
           orbState === 'listening' ? 'Listening — speak now' :
           orbState === 'thinking'  ? 'Translating…' :
           orbState === 'speaking'  ? 'Speaking translation…' :
           'Ready'}
        </motion.p>
      </div>

      {/* Toast */}
      <Toast message={toast} visible={toastVisible} />

      {/* Language picker sheet */}
      <AnimatePresence>
        {langPickerOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              className="absolute inset-0 z-40"
              style={{ background: 'rgba(26,22,18,0.35)', backdropFilter: 'blur(2px)' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setLangPickerOpen(false)}
            />
            {/* Sheet */}
            <motion.div
              className="absolute bottom-0 left-0 right-0 z-50 rounded-t-3xl overflow-hidden"
              style={{ background: '#FAF7F2', maxHeight: '72vh' }}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            >
              {/* Handle */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full bg-charcoal/15" />
              </div>

              <p className="text-center pb-3 pt-1"
                 style={{ fontFamily: 'DM Sans', fontSize: '0.75rem', color: '#2A2A2A50', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                I now speak
              </p>

              <div className="overflow-y-auto pb-8" style={{ maxHeight: '56vh' }}>
                {LANGUAGES.map(l => {
                  const active = l.code === currentLang;
                  return (
                    <button
                      key={l.code}
                      onClick={() => changeLang(l.code)}
                      className="w-full flex items-center gap-3 px-6 py-3.5 active:bg-charcoal/5 transition-colors"
                      style={{ fontFamily: 'DM Sans' }}
                    >
                      <span style={{ fontSize: '1.4rem' }}>{l.flag}</span>
                      <span style={{ fontSize: '0.95rem', color: active ? '#E8744C' : '#2A2A2A', fontWeight: active ? 500 : 400 }}>
                        {l.label}
                      </span>
                      {active && (
                        <svg className="ml-auto" width="16" height="16" viewBox="0 0 16 16" fill="none">
                          <path d="M3 8l4 4 6-7" stroke="#E8744C" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      <NotesPanel
        visible={notesOpen}
        notes={technicalNotes}
        onClose={() => setNotesOpen(false)}
      />
      <SummaryPanel
        visible={summaryOpen}
        loading={summaryLoading}
        summary={summary}
        onClose={() => setSummaryOpen(false)}
      />
    </div>
  );
}
