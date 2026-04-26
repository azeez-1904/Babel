import { motion, AnimatePresence } from 'framer-motion';
import type { Utterance } from '../lib/types';

interface Props {
  utterances: Utterance[];
}

export function TranscriptView({ utterances }: Props) {
  const last3 = utterances.slice(-3);

  if (last3.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 px-6 opacity-0">
        {/* invisible placeholder to hold layout */}
        <div className="h-20" />
      </div>
    );
  }

  return (
    <div className="flex flex-col justify-end gap-3 w-full px-6 flex-1">
      <AnimatePresence initial={false} mode="popLayout">
        {last3.map((u, idx) => {
          const isOldest = idx === 0 && last3.length === 3;
          const isMine = u.isMine;

          return (
            <motion.div
              key={u.id}
              layout
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{
                opacity: isOldest ? 0.35 : idx === 1 ? 0.65 : 1,
                y: 0,
                scale: 1,
              }}
              exit={{ opacity: 0, y: -12, scale: 0.95 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="rounded-2xl px-5 py-4"
              style={{
                background: isMine
                  ? 'rgba(232,116,76,0.10)'
                  : 'rgba(255,255,255,0.65)',
                border: isMine
                  ? '1px solid rgba(232,116,76,0.2)'
                  : '1px solid rgba(42,42,42,0.06)',
                backdropFilter: 'blur(8px)',
              }}
            >
              {/* Label */}
              <div
                className="flex items-center gap-2 mb-1.5"
                style={{ fontFamily: 'DM Sans', fontSize: '0.65rem', letterSpacing: '0.08em' }}
              >
                <span className={isMine ? 'text-coral/60' : 'text-charcoal/40'} style={{ textTransform: 'uppercase' }}>
                  {isMine ? 'You said' : 'They said'}
                </span>
                {!isMine && u.source_lang && (
                  <>
                    <span className="text-charcoal/20">·</span>
                    <span className="text-charcoal/30">{u.source_lang}</span>
                  </>
                )}
                {u.distress_flag && (
                  <span className="ml-auto text-red-500 text-xs font-medium animate-pulse">
                    ⚠ Distress detected
                  </span>
                )}
              </div>

              {/* Translated / display text */}
              <p
                className="text-ink leading-snug text-balance"
                style={{
                  fontFamily: 'DM Sans, sans-serif',
                  fontSize: idx === last3.length - 1 ? '1.2rem' : '1rem',
                  fontWeight: idx === last3.length - 1 ? 400 : 300,
                  lineHeight: 1.45,
                }}
              >
                {u.displayed_text}
              </p>

              {/* Original text (for non-self utterances) */}
              {!isMine && u.original_text !== u.displayed_text && (
                <p
                  className="mt-1.5 text-charcoal/35 italic"
                  style={{ fontFamily: 'DM Sans', fontSize: '0.8rem' }}
                >
                  "{u.original_text}"
                </p>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
