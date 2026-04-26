import { motion, useAnimationFrame } from 'framer-motion';
import type { TargetAndTransition, Transition } from 'framer-motion';
import { useRef } from 'react';
import type { OrbState } from '../lib/types';

interface Props {
  state: OrbState;
  size?: number;
}

// Gentle organic blob — SVG path morphs between states
function OrbPath({ state, size }: { state: OrbState; size: number }) {
  const pathVariants = {
    idle: {
      d: 'M70,50 C70,61 61,70 50,70 C39,70 30,61 30,50 C30,39 39,30 50,30 C61,30 70,39 70,50 Z',
      scale: 1,
      rotate: 0,
    },
    connecting: {
      d: 'M72,50 C72,62 62,72 50,72 C38,72 28,62 28,50 C28,38 38,28 50,28 C62,28 72,38 72,50 Z',
    },
    listening: {
      d: 'M68,46 C71,55 65,68 54,71 C43,74 31,67 28,56 C25,45 32,32 43,29 C54,26 65,37 68,46 Z',
    },
    thinking: {
      d: 'M66,44 C70,54 66,68 55,72 C44,76 31,70 27,58 C23,46 29,33 40,29 C51,25 62,34 66,44 Z',
    },
    speaking: {
      d: 'M69,48 C72,58 67,70 56,73 C45,76 33,69 30,58 C27,47 33,34 44,31 C55,28 66,38 69,48 Z',
    },
    error: {
      d: 'M65,42 C68,53 60,67 50,68 C40,69 29,60 28,49 C27,38 36,28 47,27 C58,26 62,31 65,42 Z',
    },
  };

  const orbColors: Record<OrbState, string> = {
    idle:       '#E8744C',
    connecting: '#D4973A',
    listening:  '#E8744C',
    thinking:   '#D4973A',
    speaking:   '#E07440',
    error:      '#C0392B',
  };

  const glowColors: Record<OrbState, string> = {
    idle:       'rgba(232,116,76,0.25)',
    connecting: 'rgba(212,151,58,0.2)',
    listening:  'rgba(232,116,76,0.35)',
    thinking:   'rgba(212,151,58,0.3)',
    speaking:   'rgba(224,116,64,0.4)',
    error:      'rgba(192,57,43,0.35)',
  };

  const r = size / 2;
  const scale = size / 100;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ filter: `drop-shadow(0 0 ${size * 0.18}px ${glowColors[state]})` }}
    >
      <defs>
        <radialGradient id="orb-grad" cx="38%" cy="35%" r="62%">
          <stop offset="0%"   stopColor="#F5A080" />
          <stop offset="100%" stopColor={orbColors[state]} />
        </radialGradient>
        <radialGradient id="orb-inner" cx="42%" cy="38%" r="30%">
          <stop offset="0%"   stopColor="rgba(255,255,255,0.45)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
      </defs>

      <motion.path
        fill="url(#orb-grad)"
        initial={pathVariants.idle}
        animate={pathVariants[state] ?? pathVariants.idle}
        transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
        style={{ transformOrigin: `${r}px ${r}px`, transform: `scale(${scale})`, transformBox: 'fill-box' }}
      />
      {/* Highlight sheen */}
      <motion.path
        fill="url(#orb-inner)"
        initial={pathVariants.idle}
        animate={pathVariants[state] ?? pathVariants.idle}
        transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
        style={{ transformOrigin: `${r}px ${r}px`, transform: `scale(${scale})`, transformBox: 'fill-box' }}
      />
    </svg>
  );
}

// Thinking: bouncing dots below orb
function ThinkingDots() {
  return (
    <div className="flex gap-1.5 justify-center mt-3">
      {[0, 1, 2].map(i => (
        <motion.div
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-coral/70"
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}

// Ripple rings for listening state
function RippleRing({ delay, size }: { delay: number; size: number }) {
  return (
    <motion.div
      className="absolute rounded-full border-2 border-coral/30 pointer-events-none"
      style={{ width: size, height: size, left: '50%', top: '50%', x: '-50%', y: '-50%' }}
      initial={{ scale: 1, opacity: 0.5 }}
      animate={{ scale: 2.2, opacity: 0 }}
      transition={{ duration: 1.8, repeat: Infinity, delay, ease: 'easeOut' }}
    />
  );
}

// Error: shake animation
const errorShake = {
  x: [0, -8, 8, -6, 6, -3, 3, 0],
  transition: { duration: 0.5, times: [0, 0.14, 0.28, 0.43, 0.57, 0.71, 0.86, 1] },
};

// Speaking: vertical wave
function SpeakingWave({ size }: { size: number }) {
  const bars = 5;
  return (
    <div className="flex items-center gap-1 absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-4">
      {Array.from({ length: bars }).map((_, i) => (
        <motion.div
          key={i}
          className="rounded-full bg-coral/50"
          style={{ width: size * 0.04, minWidth: 3 }}
          animate={{ height: [size * 0.12, size * 0.28, size * 0.12] }}
          transition={{
            duration: 0.6,
            repeat: Infinity,
            delay: i * 0.1,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
}

export function StatusOrb({ state, size = 120 }: Props) {
  const wrapperAnimations: Record<OrbState, TargetAndTransition> = {
    idle:       { scale: [1, 1.02, 1] },
    connecting: { scale: [1, 1.03, 1], opacity: [0.8, 1, 0.8] },
    listening:  { scale: [1, 1.04, 1] },
    thinking:   { y: [0, -8, 0] },
    speaking:   { scale: [1, 1.03, 0.98, 1] },
    error:      errorShake,
  };

  const transitions: Record<OrbState, Transition> = {
    idle:       { duration: 3.5, repeat: Infinity, ease: 'easeInOut' },
    connecting: { duration: 1.4, repeat: Infinity, ease: 'easeInOut' },
    listening:  { duration: 1.2, repeat: Infinity, ease: 'easeInOut' },
    thinking:   { duration: 0.5, repeat: Infinity, ease: 'easeInOut' },
    speaking:   { duration: 0.35, repeat: Infinity, ease: 'easeInOut' },
    error:      {},
  };

  return (
    <div
      className="relative flex flex-col items-center"
      style={{ width: size, height: size + (state === 'thinking' ? 32 : 0) }}
    >
      {/* Ripple rings when listening */}
      {state === 'listening' && (
        <>
          <RippleRing delay={0}    size={size} />
          <RippleRing delay={0.6}  size={size} />
          <RippleRing delay={1.2}  size={size} />
        </>
      )}

      <motion.div
        animate={wrapperAnimations[state]}
        transition={transitions[state]}
        style={{ transformOrigin: 'center center' }}
      >
        <OrbPath state={state} size={size} />
      </motion.div>

      {state === 'thinking' && <ThinkingDots />}
      {state === 'speaking' && <SpeakingWave size={size} />}
    </div>
  );
}

// Compact inline orb for status bar
export function MiniOrb({ state }: { state: OrbState }) {
  const colors: Record<OrbState, string> = {
    idle:       '#E8744C',
    connecting: '#D4973A',
    listening:  '#E8744C',
    thinking:   '#D4973A',
    speaking:   '#E07440',
    error:      '#C0392B',
  };

  return (
    <motion.div
      className="rounded-full"
      style={{ width: 8, height: 8, backgroundColor: colors[state] }}
      animate={
        state === 'idle' ? {} :
        state === 'connecting' ? { opacity: [0.4, 1, 0.4] } :
        { scale: [1, 1.4, 1], opacity: [0.7, 1, 0.7] }
      }
      transition={{ duration: 1.2, repeat: Infinity }}
    />
  );
}

// Keep a ref to orb frame count for perf — exported as a hook
export function useOrbPerfRef() {
  const frameRef = useRef(0);
  useAnimationFrame(() => { frameRef.current++; });
  return frameRef;
}
