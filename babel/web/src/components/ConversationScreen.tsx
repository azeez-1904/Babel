import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { StatusOrb, MiniOrb } from './StatusOrb';
import { TranscriptView } from './TranscriptView';
import { useSpeechRecognition, speakText } from '../hooks/useSpeech';
import type { OrbState, Utterance } from '../lib/types';
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
  const [interimText, setInterimText] = useState('');
  const [toast, setToast] = useState('');
  const [toastVisible, setToastVisible] = useState(false);

  const speakQueueRef = useRef<Array<{ text: string; lang: string }>>([]);
  const isSpeakingRef = useRef(false);
  const distressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const myLangObj = LANGUAGES.find(l => l.code === myLang);

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
        queueSpeak(u.displayed_text, myLang);
        showToast('Translation received');
      }),

      onMessage('utterance_echo', (msg) => {
        const u: Utterance = {
          id: `${++utteranceCounter}`,
          from_user: myUserId,
          isMine: true,
          original_text: msg.original_text as string,
          displayed_text: msg.original_text as string,
          source_lang: myLang,
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
    ];

    return () => unsubs.forEach(u => u());
  }, [onMessage, myLang, myUserId, queueSpeak, showToast]);

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
    lang: myLang,
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

  // Initial state + request current peers list (avoids timing race on mount)
  useEffect(() => {
    setOrbState('listening');
    send({ type: 'state_change', state: 'listening' });
    send({ type: 'request_peers' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const peersWithoutMe = peers.filter(p => p.userId !== myUserId);
  const peerCount = peersWithoutMe.length;

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
          </div>
          <button
            onClick={onLeave}
            className="w-7 h-7 rounded-full flex items-center justify-center
                       bg-charcoal/8 active:bg-charcoal/15 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M9 3L3 9M3 3l6 6" stroke="#2A2A2A" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Row 2: my language + peers */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Me */}
          <div className="flex items-center gap-1 px-2 py-1 rounded-full"
               style={{
                 background: 'linear-gradient(135deg, rgba(232,116,76,0.15), rgba(212,151,58,0.1))',
                 border: '1px solid rgba(232,116,76,0.2)',
                 fontFamily: 'DM Sans', fontSize: '0.7rem',
               }}>
            <span>{myLangObj?.flag}</span>
            <span className="text-coral font-medium">{myLangObj?.label ?? myLang}</span>
            <span className="text-charcoal/30 text-xs ml-0.5">(you)</span>
          </div>

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

        <div className="flex items-center gap-6">
          {/* Mic toggle */}
          <MicButton active={micActive} onToggle={toggleMic} />
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
    </div>
  );
}
