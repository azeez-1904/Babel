import { useEffect, useRef, useState } from 'react';

export function useNoiseSuppression(enabled: boolean) {
  const [noiseLevel, setNoiseLevel] = useState(0);   // 0-1 live audio level
  const [isActive, setIsActive]     = useState(false);

  const streamRef  = useRef<MediaStream | null>(null);
  const ctxRef     = useRef<AudioContext | null>(null);
  const animRef    = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) { cleanup(); return; }

    let cancelled = false;

    async function start() {
      try {
        // Request mic with browser-native suppression hints
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            noiseSuppression:  true,
            echoCancellation:  true,
            autoGainControl:   true,
            channelCount:      1,
            sampleRate:        16000,
          } as MediaTrackConstraints,
        });

        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }

        streamRef.current = stream;
        const ctx = new AudioContext();
        ctxRef.current = ctx;

        const source = ctx.createMediaStreamSource(stream);

        // ── High-pass filter: cut rumble/hum below 85 Hz ──
        const hpf = ctx.createBiquadFilter();
        hpf.type = 'highpass';
        hpf.frequency.value = 85;
        hpf.Q.value = 0.7;

        // ── Dynamics compressor: normalise speech volume ──
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -40;
        comp.knee.value       = 10;
        comp.ratio.value      = 6;
        comp.attack.value     = 0.003;
        comp.release.value    = 0.25;

        // ── Analyser for the level meter ──
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.75;

        source.connect(hpf);
        hpf.connect(comp);
        comp.connect(analyser);
        // intentionally NOT connecting to ctx.destination — no feedback loop

        setIsActive(true);

        const buf = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(buf);
          const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
          setNoiseLevel(Math.min(1, rms / 80));
          animRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch (err) {
        console.warn('Noise suppression unavailable:', err);
      }
    }

    start();
    return () => { cancelled = true; cleanup(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  function cleanup() {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    ctxRef.current?.close().catch(() => {});
    ctxRef.current  = null;
    streamRef.current = null;
    setIsActive(false);
    setNoiseLevel(0);
  }

  return { noiseLevel, isActive };
}
