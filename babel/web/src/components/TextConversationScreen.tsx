import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { OrbState, Utterance } from '../lib/types';
import { LANGUAGES } from '../lib/types';

interface Peer { userId: string; lang: string; isDevice: boolean }

interface Props {
  roomCode: string;
  myLang: string;
  myUserId: string;
  onLeave: () => void;
  send: (payload: object) => void;
  onMessage: (type: string, handler: (msg: Record<string, unknown>) => void) => () => void;
}

let _counter = 0;

// iMessage blue / gray palette
const IM_BLUE  = '#007AFF';
const IM_GRAY  = '#E9E9EB';
const IM_BG    = '#FFFFFF';
const IM_BAR   = '#F6F6F6';
const IM_BORDER = 'rgba(0,0,0,0.12)';

function Bubble({ u }: { u: Utterance }) {
  const isMine = u.isMine;
  const lang = LANGUAGES.find(l => l.code === u.source_lang);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={`flex flex-col ${isMine ? 'items-end' : 'items-start'} gap-0.5`}
    >
      <div
        style={{
          maxWidth: '72%',
          padding: '9px 14px',
          borderRadius: isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
          background: isMine ? IM_BLUE : IM_GRAY,
          color: isMine ? '#fff' : '#000',
          fontFamily: '-apple-system, "SF Pro Text", system-ui, sans-serif',
          fontSize: '1rem',
          lineHeight: 1.4,
          wordBreak: 'break-word',
        }}
      >
        {u.displayed_text}
      </div>

      {/* Sub-label: translation source OR distress */}
      {!isMine && (
        <span style={{
          fontFamily: '-apple-system, system-ui',
          fontSize: '0.6rem',
          color: '#8E8E93',
          paddingLeft: '4px',
        }}>
          {lang ? `${lang.flag} Translated from ${lang.label}` : u.source_lang}
          {u.distress_flag ? ' · ⚠ Distress' : ''}
        </span>
      )}
      {isMine && (
        <span style={{
          fontFamily: '-apple-system, system-ui',
          fontSize: '0.6rem',
          color: '#8E8E93',
          paddingRight: '4px',
        }}>
          {u.error ? 'Not translated' : 'Delivered'}
        </span>
      )}
    </motion.div>
  );
}

function TypingBubble() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="flex items-end gap-0.5"
    >
      <div style={{
        padding: '10px 14px',
        borderRadius: '18px 18px 18px 4px',
        background: IM_GRAY,
        display: 'flex',
        gap: '4px',
        alignItems: 'center',
      }}>
        {[0, 1, 2].map(i => (
          <motion.div
            key={i}
            style={{ width: 7, height: 7, borderRadius: '50%', background: '#8E8E93' }}
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.16, ease: 'easeInOut' }}
          />
        ))}
      </div>
    </motion.div>
  );
}

export function TextConversationScreen({ roomCode, myLang, myUserId, onLeave, send, onMessage }: Props) {
  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [input, setInput] = useState('');
  const [peerTyping, setPeerTyping] = useState(false);
  const [distressVisible, setDistressVisible] = useState(false);
  const [orbState, setOrbState] = useState<OrbState>('idle');

  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const distressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peerTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const myLangObj = LANGUAGES.find(l => l.code === myLang);

  // Auto-scroll unless user scrolled up
  useEffect(() => {
    if (userScrolledRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [utterances.length, peerTyping]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    userScrolledRef.current = el.scrollHeight - el.scrollTop - el.clientHeight > 60;
  };

  // WebSocket messages
  useEffect(() => {
    const unsubs = [
      onMessage('peers_update', (msg) => {
        setPeers((msg.peers as Peer[]) ?? []);
      }),

      onMessage('utterance', (msg) => {
        // Peer finished translating — hide typing indicator
        setPeerTyping(false);
        const u: Utterance = {
          id: `${++_counter}`,
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
      }),

      onMessage('utterance_echo', (msg) => {
        const u: Utterance = {
          id: `${++_counter}`,
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
      }),

      onMessage('state_change', (msg) => {
        if (msg.user === myUserId) return;
        const state = msg.state as string;
        if (state === 'thinking') {
          // Peer sent something — show typing/translating dots
          setPeerTyping(true);
          if (peerTypingTimerRef.current) clearTimeout(peerTypingTimerRef.current);
          peerTypingTimerRef.current = setTimeout(() => setPeerTyping(false), 8000);
        } else {
          setPeerTyping(false);
          if (peerTypingTimerRef.current) clearTimeout(peerTypingTimerRef.current);
        }
        const orbMap: Record<string, OrbState> = { thinking: 'thinking', listening: 'listening', idle: 'idle', speaking: 'speaking' };
        setOrbState(orbMap[state] ?? 'idle');
      }),

      onMessage('distress_alert', () => {
        setDistressVisible(true);
        if (distressTimerRef.current) clearTimeout(distressTimerRef.current);
        distressTimerRef.current = setTimeout(() => setDistressVisible(false), 12000);
      }),
    ];

    return () => unsubs.forEach(u => u());
  }, [onMessage, myUserId, myLang]);

  // Mount: request peer list
  useEffect(() => {
    send({ type: 'request_peers' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  const sendMessage = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.focus();
    }
    userScrolledRef.current = false;
    send({ type: 'utterance', original_text: text });
    send({ type: 'state_change', state: 'thinking' });
  }, [input, send]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const others = peers.filter(p => p.userId !== myUserId);
  const otherLang = others[0] ? LANGUAGES.find(l => l.code === others[0].lang) : null;
  const peerLabel = otherLang ? `${otherLang.flag} ${otherLang.label} speaker` : others.length > 0 ? 'Someone' : 'Waiting…';

  return (
    <div className="relative flex flex-col h-full safe-top safe-bottom" style={{ background: IM_BG, fontFamily: '-apple-system, "SF Pro Text", system-ui' }}>

      {/* Distress banner */}
      <AnimatePresence>
        {distressVisible && (
          <motion.div
            initial={{ y: -60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -60, opacity: 0 }}
            className="absolute top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 bg-red-500 text-white px-4 py-3 text-sm font-medium"
          >
            ⚠ Possible medical distress — please check on this person
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── iOS navigation bar ────────────────────────────────────────────── */}
      <div style={{
        background: 'rgba(248,248,248,0.94)',
        borderBottom: `0.5px solid ${IM_BORDER}`,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        padding: '10px 16px 10px',
        flexShrink: 0,
      }}>
        <div className="flex items-center">
          {/* Back */}
          <button
            onClick={onLeave}
            className="flex items-center gap-0.5 active:opacity-50 transition-opacity"
            style={{ color: IM_BLUE, fontSize: '1.05rem', minWidth: 60 }}
          >
            <svg width="10" height="17" viewBox="0 0 10 17" fill="none">
              <path d="M8.5 1.5L1.5 8.5L8.5 15.5" stroke={IM_BLUE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span style={{ marginLeft: 4 }}>Back</span>
          </button>

          {/* Center: contact info */}
          <div className="flex-1 flex flex-col items-center">
            {/* Avatar */}
            <div style={{
              width: 36, height: 36,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #E8744C, #D4973A)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.1rem', marginBottom: 2,
            }}>
              🌐
            </div>
            <span style={{ fontWeight: 600, fontSize: '0.85rem', color: '#000', lineHeight: 1.1 }}>
              Room {roomCode}
            </span>
            <span style={{ fontSize: '0.68rem', color: '#8E8E93' }}>
              {others.length === 0
                ? `You · ${myLangObj?.label ?? myLang}`
                : `${peerLabel} · ${orbState === 'thinking' ? 'translating…' : orbState === 'speaking' ? 'speaking…' : 'active'}`}
            </span>
          </div>

          {/* Right: language pill */}
          <div style={{ minWidth: 60, display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{
              background: 'rgba(232,116,76,0.12)',
              border: '1px solid rgba(232,116,76,0.2)',
              borderRadius: 20,
              padding: '3px 10px',
              fontSize: '0.7rem',
              color: '#E8744C',
              fontFamily: '-apple-system',
              fontWeight: 500,
            }}>
              {myLangObj?.flag} {myLangObj?.label}
            </div>
          </div>
        </div>
      </div>

      {/* ── Message list ───────────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto min-h-0 px-4 pt-4 pb-2"
        style={{ scrollbarWidth: 'none' }}
      >
        {utterances.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}
            className="flex flex-col items-center justify-center h-full text-center pb-10"
            style={{ minHeight: 200 }}
          >
            <div style={{
              width: 60, height: 60, borderRadius: '50%',
              background: 'linear-gradient(135deg, #E8744C, #D4973A)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.6rem', marginBottom: 12,
              boxShadow: '0 4px 20px rgba(232,116,76,0.35)',
            }}>
              💬
            </div>
            <p style={{ fontSize: '1.1rem', fontWeight: 600, color: '#000', marginBottom: 4 }}>
              Room {roomCode}
            </p>
            <p style={{ fontSize: '0.85rem', color: '#8E8E93', lineHeight: 1.5 }}>
              {others.length === 0
                ? 'Share the code. Messages are translated automatically.'
                : `${peerLabel} joined. Start typing!`}
            </p>
          </motion.div>
        )}

        <div className="flex flex-col gap-2">
          {utterances.map(u => <Bubble key={u.id} u={u} />)}
        </div>

        {/* Peer typing indicator */}
        <AnimatePresence>
          {peerTyping && (
            <motion.div className="mt-2">
              <TypingBubble />
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={bottomRef} className="h-2" />
      </div>

      {/* ── iMessage input bar ─────────────────────────────────────────────── */}
      <div style={{
        background: IM_BAR,
        borderTop: `0.5px solid ${IM_BORDER}`,
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'flex-end',
        gap: 8,
        flexShrink: 0,
      }}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="iMessage"
          rows={1}
          style={{
            flex: 1,
            background: '#fff',
            border: `1px solid ${IM_BORDER}`,
            borderRadius: 18,
            padding: '8px 14px',
            fontFamily: '-apple-system, "SF Pro Text", system-ui',
            fontSize: '1rem',
            lineHeight: 1.4,
            resize: 'none',
            outline: 'none',
            overflowY: 'hidden',
            minHeight: 36,
          }}
        />

        {/* Send button — only active when there's text */}
        <button
          onClick={sendMessage}
          disabled={!input.trim()}
          style={{
            width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
            background: input.trim() ? IM_BLUE : '#C7C7CC',
            border: 'none', cursor: input.trim() ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.15s',
          }}
          aria-label="Send"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 12V2M2 7l5-5 5 5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
