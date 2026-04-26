import { motion, AnimatePresence } from 'framer-motion';
import { useASL } from '../hooks/useASL';

interface Props {
  enabled:       boolean;
  currentWord:   string;
  currentLetter: string;
  confidence:    number;
  streak:        number;   // consecutive matching frames
  required:      number;   // frames needed to confirm
  onSend:        () => void;
  onClose:       () => void;
  sendWs:        (payload: object) => void;
}

export function ASLPanel({
  enabled, currentWord, currentLetter, confidence, streak, required, onSend, onClose, sendWs,
}: Props) {
  const { videoRef, canvasRef, ready, error } = useASL({ enabled, sendWs });

  if (!enabled) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="asl-fullscreen"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        className="fixed inset-0 z-50 flex flex-col"
        style={{ background: '#000' }}
      >
        {/* ── Full-screen camera ── */}
        <div className="relative flex-1 overflow-hidden">
          <video
            ref={videoRef}
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
            style={{ transform: 'scaleX(-1)' }}
          />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ transform: 'scaleX(-1)' }}
          />

          {/* Loading */}
          {!ready && !error && (
            <div className="absolute inset-0 flex items-center justify-center"
                 style={{ background: 'rgba(0,0,0,0.6)' }}>
              <div className="text-center">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white mx-auto mb-3"
                />
                <p style={{ color: 'white', fontFamily: 'DM Sans', fontSize: '0.85rem' }}>
                  Loading hand detector…
                </p>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center"
                 style={{ background: 'rgba(0,0,0,0.7)' }}>
              <p style={{ color: '#fca5a5', fontFamily: 'DM Sans', fontSize: '0.85rem',
                          textAlign: 'center', padding: '0 2rem' }}>
                {error}
              </p>
            </div>
          )}

          {/* ── Top bar: close + hint + current letter ── */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 pt-4 pb-3"
               style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)' }}>

            {/* Close button */}
            <motion.button
              onClick={onClose}
              whileTap={{ scale: 0.9 }}
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)' }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 1l12 12M13 1L1 13" stroke="white" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </motion.button>

            {/* ASL mode label + hold hint */}
            <div className="flex flex-col items-center gap-1">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full"
                   style={{ background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)' }}>
                <span style={{ fontSize: '1rem' }}>🤟</span>
                <span style={{ fontFamily: 'DM Sans', fontSize: '0.75rem', color: 'white', fontWeight: 500 }}>
                  ASL Mode
                </span>
              </div>
              <span style={{ fontFamily: 'DM Sans', fontSize: '0.6rem', color: 'rgba(255,255,255,0.5)' }}>
                Hold sign still · pause between letters
              </span>
            </div>

            {/* Big current letter */}
            <motion.div
              key={currentLetter}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 20 }}
              className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{
                background: currentLetter
                  ? 'linear-gradient(135deg,#E8744C,#D4973A)'
                  : 'rgba(255,255,255,0.15)',
                backdropFilter: 'blur(8px)',
                boxShadow: currentLetter ? '0 4px 20px rgba(232,116,76,0.6)' : 'none',
              }}
            >
              <span style={{
                fontFamily: 'DM Sans',
                fontWeight: 800,
                fontSize: '1.8rem',
                color: 'white',
              }}>
                {currentLetter || '?'}
              </span>
            </motion.div>
          </div>

          {/* ── Confidence bar (thin strip below top bar) ── */}
          {currentLetter && (
            <div className="absolute left-0 right-0 h-1" style={{ top: 80 }}>
              <motion.div
                className="h-full"
                animate={{ width: `${confidence * 100}%` }}
                style={{
                  background: confidence > 0.6
                    ? 'linear-gradient(90deg,#4ade80,#22c55e)'
                    : 'linear-gradient(90deg,#f97316,#ea580c)',
                }}
                transition={{ duration: 0.15 }}
              />
            </div>
          )}

          {/* ── Streak progress — right side ── */}
          {currentLetter && (
            <div className="absolute right-4 top-24 flex flex-col items-center gap-2">
              <div className="flex flex-col gap-1.5">
                {Array.from({ length: required }).map((_, i) => (
                  <motion.div
                    key={i}
                    animate={{
                      background: i < streak
                        ? 'rgba(232,116,76,0.9)'
                        : 'rgba(255,255,255,0.2)',
                      scale: i < streak ? 1.1 : 1,
                    }}
                    transition={{ duration: 0.15 }}
                    className="w-3 h-3 rounded-full"
                  />
                ))}
              </div>
              <span style={{
                fontFamily: 'DM Sans',
                fontSize: '0.6rem',
                color: 'rgba(255,255,255,0.5)',
              }}>
                {streak}/{required}
              </span>
            </div>
          )}
        </div>

        {/* ── Bottom bar: word display + send ── */}
        <div
          className="flex items-center gap-3 px-4 py-4"
          style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)' }}
        >
          {/* Word accumulator */}
          <div className="flex-1 min-w-0">
            <p style={{ fontFamily: 'DM Sans', fontSize: '0.6rem', color: 'rgba(255,255,255,0.4)',
                        marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Signing
            </p>
            <p
              className="truncate"
              style={{
                fontFamily: 'DM Sans',
                fontWeight: 600,
                fontSize: '1.4rem',
                color: currentWord ? 'white' : 'rgba(255,255,255,0.25)',
                letterSpacing: '0.12em',
              }}
            >
              {currentWord || 'Start signing…'}
            </p>
          </div>

          {/* Send button */}
          <motion.button
            onClick={onSend}
            disabled={!currentWord.trim()}
            whileTap={{ scale: 0.88 }}
            className="flex-shrink-0 flex items-center gap-2 px-5 py-3 rounded-2xl font-medium"
            style={{
              background: currentWord.trim()
                ? 'linear-gradient(135deg,#E8744C,#D4973A)'
                : 'rgba(255,255,255,0.08)',
              boxShadow: currentWord.trim() ? '0 4px 20px rgba(232,116,76,0.5)' : 'none',
              color: currentWord.trim() ? 'white' : 'rgba(255,255,255,0.25)',
              fontFamily: 'DM Sans',
              fontSize: '0.85rem',
              border: 'none',
              cursor: currentWord.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            Send
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
              <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2.5"
                    strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </motion.button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
