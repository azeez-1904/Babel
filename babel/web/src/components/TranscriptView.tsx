import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Utterance } from '../lib/types';
import { LANGUAGES } from '../lib/types';

interface Props {
  utterances: Utterance[];
}

export function TranscriptView({ utterances }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  // Auto-scroll to bottom on new message, unless user scrolled up
  useEffect(() => {
    if (userScrolledRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [utterances.length]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    userScrolledRef.current = !atBottom;
  };

  if (utterances.length === 0) return null;

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto min-h-0 px-4 py-2"
      style={{ scrollbarWidth: 'none' }}
    >
      <style>{`.no-scrollbar::-webkit-scrollbar{display:none}`}</style>

      <div className="flex flex-col gap-3">
        <AnimatePresence initial={false}>
          {utterances.map(u => {
            const langObj = LANGUAGES.find(l => l.code === u.source_lang);
            const isMine = u.isMine;

            return (
              <motion.div
                key={u.id}
                initial={{ opacity: 0, y: 14, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="rounded-2xl px-4 py-3.5"
                style={{
                  background: isMine
                    ? 'rgba(232,116,76,0.09)'
                    : 'rgba(255,255,255,0.7)',
                  border: isMine
                    ? '1px solid rgba(232,116,76,0.18)'
                    : '1px solid rgba(42,42,42,0.07)',
                  backdropFilter: 'blur(8px)',
                }}
              >
                {/* Label row */}
                <div className="flex items-center gap-2 mb-1.5"
                     style={{ fontFamily: 'DM Sans', fontSize: '0.62rem', letterSpacing: '0.08em' }}>
                  <span style={{ textTransform: 'uppercase', color: isMine ? 'rgba(232,116,76,0.65)' : 'rgba(42,42,42,0.4)' }}>
                    {isMine ? 'You said' : 'They said'}
                  </span>
                  {!isMine && (
                    <>
                      <span style={{ color: 'rgba(42,42,42,0.2)' }}>·</span>
                      <span style={{ color: 'rgba(42,42,42,0.35)' }}>
                        {langObj ? `${langObj.flag} ${langObj.label}` : u.source_lang}
                      </span>
                    </>
                  )}
                  {u.distress_flag && (
                    <span className="ml-auto text-red-500 font-medium animate-pulse"
                          style={{ fontSize: '0.7rem' }}>
                      ⚠ Distress
                    </span>
                  )}
                  {u.error && (
                    <span className="ml-auto" style={{ color: 'rgba(42,42,42,0.3)', fontSize: '0.6rem' }}>
                      (no translation)
                    </span>
                  )}
                </div>

                {/* Main text */}
                <p style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: '1.05rem',
                  fontWeight: 400,
                  lineHeight: 1.5,
                  color: '#1A1612',
                }}>
                  {u.displayed_text}
                </p>

                {/* Original text for received utterances */}
                {!isMine && u.original_text !== u.displayed_text && (
                  <p className="mt-1.5 italic"
                     style={{ fontFamily: 'DM Sans', fontSize: '0.78rem', color: 'rgba(42,42,42,0.32)' }}>
                    "{u.original_text}"
                  </p>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Scroll anchor */}
      <div ref={bottomRef} className="h-1" />
    </div>
  );
}
