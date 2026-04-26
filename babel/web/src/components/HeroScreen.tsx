import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getRoomSummary } from '../lib/api';
import { LANGUAGES } from '../lib/types';
import type { RoomSummaryResponse } from '../lib/types';

interface Props {
  onStart: (roomCode: string, lang: string, isNew: boolean) => void;
  wsStatus: 'connecting' | 'connected' | 'disconnected';
}

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// Warm gradient mesh backdrop
function GradientBackdrop() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div
        className="absolute rounded-full opacity-40 blur-3xl"
        style={{
          width: '80vw', height: '80vw', maxWidth: 500, maxHeight: 500,
          top: '-20%', right: '-20%',
          background: 'radial-gradient(circle, #E8744C 0%, #D4973A 60%, transparent 100%)',
        }}
      />
      <div
        className="absolute rounded-full opacity-25 blur-3xl"
        style={{
          width: '60vw', height: '60vw', maxWidth: 400, maxHeight: 400,
          bottom: '-10%', left: '-15%',
          background: 'radial-gradient(circle, #D4973A 0%, #E8744C 50%, transparent 100%)',
        }}
      />
      {/* Grain texture overlay */}
      <svg className="absolute inset-0 w-full h-full opacity-[0.03]" style={{ mixBlendMode: 'multiply' }}>
        <filter id="noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#noise)" />
      </svg>
    </div>
  );
}

export function HeroScreen({ onStart, wsStatus }: Props) {
  const [mode, setMode] = useState<'home' | 'start' | 'join' | 'summary'>('home');
  const [lang, setLang] = useState('en-US');
  const [joinCode, setJoinCode] = useState('');
  const [summaryCode, setSummaryCode] = useState('');
  const [summaryResult, setSummaryResult] = useState<RoomSummaryResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleStart = () => {
    const code = generateCode();
    onStart(code, lang, true);
  };

  const handleJoin = () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length < 2) {
      setError('Enter a room code');
      inputRef.current?.focus();
      return;
    }
    setError('');
    onStart(code, lang, false);
  };

  const handleSummaryLookup = async () => {
    const code = summaryCode.trim().toUpperCase();
    if (code.length < 2) {
      setError('Enter a room code');
      inputRef.current?.focus();
      return;
    }

    setError('');
    setSummaryLoading(true);
    setSummaryResult(null);
    try {
      const result = await getRoomSummary(code);
      setSummaryResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load summary');
    } finally {
      setSummaryLoading(false);
    }
  };

  return (
    <div className="relative h-full flex flex-col items-center justify-center px-6 safe-top safe-bottom no-select"
         style={{ background: '#FAF7F2' }}>
      <GradientBackdrop />

      <AnimatePresence mode="wait">
        {mode === 'home' && (
          <motion.div
            key="home"
            className="relative z-10 flex flex-col items-center w-full max-w-sm"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Wordmark */}
            <motion.div
              className="mb-10"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1, duration: 0.6 }}
            >
              <div className="flex items-center gap-2 mb-6 justify-center">
                <div
                  className="rounded-xl flex items-center justify-center"
                  style={{
                    width: 48, height: 48,
                    background: 'linear-gradient(135deg, #E8744C, #D4973A)',
                    boxShadow: '0 4px 20px rgba(232,116,76,0.35)',
                  }}
                >
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="rgba(255,255,255,0.2)" />
                    <path d="M8 10h8M8 14h5" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
                    <path d="M12 6C8.69 6 6 8.69 6 12s2.69 6 6 6" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M12 6c3.31 0 6 2.69 6 6s-2.69 6-6 6" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </div>
              </div>

              <h1
                className="text-center leading-[0.95] text-ink"
                style={{
                  fontFamily: 'Fraunces, Georgia, serif',
                  fontSize: 'clamp(2.8rem, 10vw, 3.8rem)',
                  fontWeight: 300,
                  letterSpacing: '-0.02em',
                }}
              >
                Speak freely.
                <br />
                <em style={{ fontStyle: 'italic', color: '#E8744C' }}>Be heard.</em>
              </h1>

              <p
                className="text-center mt-4 text-charcoal/60"
                style={{ fontFamily: 'DM Sans, sans-serif', fontSize: '1rem', fontWeight: 300 }}
              >
                Real-time voice translation. No account needed.
              </p>
            </motion.div>

            {/* Language selector */}
            <motion.div
              className="w-full mb-6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.25 }}
            >
              <label className="block text-xs uppercase tracking-widest text-charcoal/40 mb-2 text-center"
                     style={{ fontFamily: 'DM Sans', fontSize: '0.65rem' }}>
                I speak
              </label>
              <div className="relative">
                <select
                  value={lang}
                  onChange={e => setLang(e.target.value)}
                  className="w-full appearance-none rounded-2xl border border-fog text-charcoal text-center
                             py-3.5 px-4 text-base cursor-pointer outline-none transition-all
                             focus:border-coral/60 focus:ring-2 focus:ring-coral/15"
                  style={{
                    background: 'rgba(255,255,255,0.7)',
                    fontFamily: 'DM Sans, sans-serif',
                    backdropFilter: 'blur(8px)',
                  }}
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
            </motion.div>

            {/* CTAs */}
            <motion.div
              className="w-full flex flex-col gap-3"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
            >
              <button
                onClick={() => setMode('start')}
                disabled={wsStatus !== 'connected'}
                className="w-full py-4 rounded-2xl text-white font-medium text-base transition-all active:scale-[0.97]"
                style={{
                  background: wsStatus === 'connected'
                    ? 'linear-gradient(135deg, #E8744C 0%, #D4973A 100%)'
                    : '#C0C0B0',
                  fontFamily: 'DM Sans, sans-serif',
                  boxShadow: wsStatus === 'connected'
                    ? '0 4px 24px rgba(232,116,76,0.4), 0 1px 0 rgba(255,255,255,0.15) inset'
                    : 'none',
                  letterSpacing: '0.01em',
                }}
              >
                {wsStatus === 'connecting' ? 'Connecting…' :
                 wsStatus === 'disconnected' ? 'Server offline' :
                 'Start a conversation'}
              </button>

              <button
                onClick={() => setMode('join')}
                disabled={wsStatus !== 'connected'}
                className="w-full py-4 rounded-2xl text-charcoal font-medium text-base transition-all active:scale-[0.97]"
                style={{
                  background: 'rgba(255,255,255,0.6)',
                  border: '1.5px solid rgba(42,42,42,0.12)',
                  fontFamily: 'DM Sans, sans-serif',
                  backdropFilter: 'blur(8px)',
                  letterSpacing: '0.01em',
                }}
              >
                Join with code
              </button>

              <button
                onClick={() => { setMode('summary'); setError(''); }}
                disabled={wsStatus !== 'connected'}
                className="w-full py-3 rounded-2xl text-charcoal/70 font-medium text-sm transition-all active:scale-[0.97]"
                style={{
                  background: 'rgba(255,255,255,0.42)',
                  border: '1px solid rgba(42,42,42,0.08)',
                  fontFamily: 'DM Sans, sans-serif',
                  backdropFilter: 'blur(8px)',
                }}
              >
                View summary by room code
              </button>
            </motion.div>

            {/* Connection status */}
            <motion.div
              className="mt-6 flex items-center gap-2 text-charcoal/35"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              style={{ fontFamily: 'DM Sans', fontSize: '0.75rem' }}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${
                wsStatus === 'connected' ? 'bg-green-400' :
                wsStatus === 'connecting' ? 'bg-amber animate-pulse' : 'bg-red-400'
              }`} />
              {wsStatus === 'connected' ? 'Ready' :
               wsStatus === 'connecting' ? 'Connecting to server…' : 'Server unreachable'}
            </motion.div>
          </motion.div>
        )}

        {mode === 'start' && (
          <motion.div
            key="start"
            className="relative z-10 flex flex-col items-center w-full max-w-sm"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <button
              onClick={() => setMode('home')}
              className="self-start mb-8 flex items-center gap-1.5 text-charcoal/50 active:opacity-60"
              style={{ fontFamily: 'DM Sans', fontSize: '0.875rem' }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Back
            </button>

            <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: '2rem', fontWeight: 300, color: '#1A1612' }}
                className="mb-2 text-center">
              Almost ready
            </h2>
            <p className="text-charcoal/50 text-sm mb-8 text-center"
               style={{ fontFamily: 'DM Sans' }}>
              Share your room code with the other person
            </p>

            <div className="w-full mb-6">
              <label className="block text-xs uppercase tracking-widest text-charcoal/40 mb-2 text-center"
                     style={{ fontFamily: 'DM Sans', fontSize: '0.65rem' }}>
                I speak
              </label>
              <div className="relative">
                <select
                  value={lang}
                  onChange={e => setLang(e.target.value)}
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

            <button
              onClick={handleStart}
              className="w-full py-4 rounded-2xl text-white font-medium text-base transition-all active:scale-[0.97]"
              style={{
                background: 'linear-gradient(135deg, #E8744C 0%, #D4973A 100%)',
                fontFamily: 'DM Sans',
                boxShadow: '0 4px 24px rgba(232,116,76,0.4)',
              }}
            >
              Start listening →
            </button>
          </motion.div>
        )}

        {mode === 'join' && (
          <motion.div
            key="join"
            className="relative z-10 flex flex-col items-center w-full max-w-sm"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <button
              onClick={() => { setMode('home'); setError(''); }}
              className="self-start mb-8 flex items-center gap-1.5 text-charcoal/50 active:opacity-60"
              style={{ fontFamily: 'DM Sans', fontSize: '0.875rem' }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Back
            </button>

            <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: '2rem', fontWeight: 300 }}
                className="mb-2 text-center text-ink">
              Join a room
            </h2>
            <p className="text-charcoal/50 text-sm mb-8 text-center" style={{ fontFamily: 'DM Sans' }}>
              Enter the code from the other person's screen
            </p>

            <div className="w-full mb-4">
              <input
                ref={inputRef}
                type="text"
                value={joinCode}
                onChange={e => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
                onKeyDown={e => e.key === 'Enter' && handleJoin()}
                placeholder="ABCD"
                maxLength={6}
                className="w-full rounded-2xl border border-fog text-charcoal text-center
                           py-4 px-4 text-2xl tracking-[0.3em] font-medium outline-none
                           transition-all focus:border-coral/60 focus:ring-2 focus:ring-coral/15"
                style={{
                  background: 'rgba(255,255,255,0.7)',
                  fontFamily: 'DM Sans, monospace',
                  backdropFilter: 'blur(8px)',
                }}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
              {error && (
                <p className="text-red-400 text-sm text-center mt-2" style={{ fontFamily: 'DM Sans' }}>{error}</p>
              )}
            </div>

            <div className="w-full mb-6">
              <label className="block text-xs uppercase tracking-widest text-charcoal/40 mb-2 text-center"
                     style={{ fontFamily: 'DM Sans', fontSize: '0.65rem' }}>
                I speak
              </label>
              <div className="relative">
                <select
                  value={lang}
                  onChange={e => setLang(e.target.value)}
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

            <button
              onClick={handleJoin}
              className="w-full py-4 rounded-2xl text-white font-medium text-base transition-all active:scale-[0.97]"
              style={{
                background: 'linear-gradient(135deg, #E8744C 0%, #D4973A 100%)',
                fontFamily: 'DM Sans',
                boxShadow: '0 4px 24px rgba(232,116,76,0.4)',
              }}
            >
              Join →
            </button>
          </motion.div>
        )}

        {mode === 'summary' && (
          <motion.div
            key="summary"
            className="relative z-10 flex flex-col items-center w-full max-w-sm"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <button
              onClick={() => { setMode('home'); setError(''); setSummaryResult(null); }}
              className="self-start mb-8 flex items-center gap-1.5 text-charcoal/50 active:opacity-60"
              style={{ fontFamily: 'DM Sans', fontSize: '0.875rem' }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Back
            </button>

            <h2 style={{ fontFamily: 'Fraunces, serif', fontSize: '2rem', fontWeight: 300 }}
                className="mb-2 text-center text-ink">
              Room summary
            </h2>
            <p className="text-charcoal/50 text-sm mb-6 text-center" style={{ fontFamily: 'DM Sans' }}>
              Enter a room code to view the saved simple-language summary.
            </p>

            <div className="w-full mb-4">
              <input
                ref={inputRef}
                type="text"
                value={summaryCode}
                onChange={e => setSummaryCode(e.target.value.toUpperCase().slice(0, 6))}
                onKeyDown={e => e.key === 'Enter' && handleSummaryLookup()}
                placeholder="ABCD"
                maxLength={6}
                className="w-full rounded-2xl border border-fog text-charcoal text-center
                           py-4 px-4 text-2xl tracking-[0.3em] font-medium outline-none
                           transition-all focus:border-coral/60 focus:ring-2 focus:ring-coral/15"
                style={{
                  background: 'rgba(255,255,255,0.7)',
                  fontFamily: 'DM Sans, monospace',
                  backdropFilter: 'blur(8px)',
                }}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
              {error && (
                <p className="text-red-400 text-sm text-center mt-2" style={{ fontFamily: 'DM Sans' }}>{error}</p>
              )}
            </div>

            <button
              onClick={handleSummaryLookup}
              disabled={summaryLoading}
              className="w-full py-4 rounded-2xl text-white font-medium text-base transition-all active:scale-[0.97] disabled:opacity-60"
              style={{
                background: 'linear-gradient(135deg, #E8744C 0%, #D4973A 100%)',
                fontFamily: 'DM Sans',
                boxShadow: '0 4px 24px rgba(232,116,76,0.4)',
              }}
            >
              {summaryLoading ? 'Loading summary...' : 'Load summary'}
            </button>

            {summaryResult && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full mt-5 max-h-[42vh] overflow-y-auto rounded-2xl p-4 text-left"
                style={{ background: 'rgba(255,255,255,0.68)', border: '1px solid rgba(42,42,42,0.08)' }}
              >
                {summaryResult.summary ? (
                  <div className="space-y-3">
                    <p className="text-ink leading-relaxed" style={{ fontFamily: 'DM Sans', fontSize: '0.95rem' }}>
                      {summaryResult.summary.simple_summary}
                    </p>
                    {summaryResult.summary.key_points.length > 0 && (
                      <div>
                        <h3 className="text-coral text-xs uppercase tracking-wider mb-2" style={{ fontFamily: 'DM Sans' }}>
                          Key points
                        </h3>
                        <div className="space-y-1.5">
                          {summaryResult.summary.key_points.map(point => (
                            <p key={point} className="text-charcoal/65 text-sm" style={{ fontFamily: 'DM Sans' }}>
                              {point}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                    {summaryResult.summary.suggested_follow_up_questions.length > 0 && (
                      <div>
                        <h3 className="text-coral text-xs uppercase tracking-wider mb-2" style={{ fontFamily: 'DM Sans' }}>
                          Questions to ask next
                        </h3>
                        <div className="space-y-1.5">
                          {summaryResult.summary.suggested_follow_up_questions.map(question => (
                            <p key={question} className="text-charcoal/65 text-sm" style={{ fontFamily: 'DM Sans' }}>
                              {question}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-charcoal/50 text-sm" style={{ fontFamily: 'DM Sans' }}>
                    This room exists, but it does not have a summary yet.
                  </p>
                )}
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
