import { useEffect, useRef, useState, useCallback } from 'react';

// ── Voice cache ───────────────────────────────────────────────────────────────
let _voiceCache: SpeechSynthesisVoice[] = [];

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise(resolve => {
    const v = window.speechSynthesis?.getVoices() ?? [];
    if (v.length > 0) { _voiceCache = v; resolve(v); return; }
    const handler = () => {
      _voiceCache = window.speechSynthesis.getVoices();
      resolve(_voiceCache);
    };
    window.speechSynthesis.addEventListener('voiceschanged', handler, { once: true });
    // Fallback if event never fires (some browsers)
    setTimeout(() => {
      _voiceCache = window.speechSynthesis?.getVoices() ?? [];
      resolve(_voiceCache);
    }, 1500);
  });
}

function pickVoice(lang: string, voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  // 1. Exact locale match
  let v = voices.find(v => v.lang === lang);
  if (v) return v;
  // 2. Same language, any region (es-MX → es-ES etc.)
  const prefix = lang.split('-')[0].toLowerCase();
  v = voices.find(v => v.lang.toLowerCase().startsWith(prefix));
  if (v) return v;
  // 3. Any voice at all (last resort)
  return voices[0];
}

// Preload voices on module init
if (typeof window !== 'undefined') loadVoices();

// ── SpeechRecognition ─────────────────────────────────────────────────────────
interface UseSpeechOptions {
  lang: string;
  onFinal: (text: string) => void;
  onInterim: (text: string) => void;
  onStateChange: (state: 'listening' | 'idle') => void;
  enabled: boolean;
}

export function useSpeechRecognition({ lang, onFinal, onInterim, onStateChange, enabled }: UseSpeechOptions) {
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const [isListening, setIsListening] = useState(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => {
    if (!enabled) { stop(); return; }

    const SR =
      (window as unknown as { SpeechRecognition?: typeof window.SpeechRecognition }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: typeof window.SpeechRecognition }).webkitSpeechRecognition;

    if (!SR) { console.warn('SpeechRecognition not supported'); return; }

    const recognition = new SR();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => { setIsListening(true); onStateChange('listening'); };

    recognition.onend = () => {
      setIsListening(false);
      onStateChange('idle');
      onInterim('');
      if (enabledRef.current) {
        restartTimerRef.current = setTimeout(() => {
          if (enabledRef.current) try { recognition.start(); } catch { /* ignore */ }
        }, 150);
      }
    };

    recognition.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      console.warn('Speech error:', e.error);
      setIsListening(false);
      onStateChange('idle');
    };

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const text = result[0].transcript.trim();
          if (text.length > 1) { onInterim(''); onFinal(text); }
        } else {
          interim += result[0].transcript;
        }
      }
      if (interim) onInterim(interim);
    };

    recognitionRef.current = recognition;
    try { recognition.start(); } catch { /* ignore */ }

    return () => {
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      recognition.onend = null;
      recognition.onresult = null;
      try { recognition.stop(); } catch { /* ignore */ }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, enabled]);

  return { isListening, stop };
}

// ── TTS ───────────────────────────────────────────────────────────────────────
export async function speakText(
  text: string,
  lang: string,
  onStart?: () => void,
  onEnd?: () => void,
) {
  if (!window.speechSynthesis) { onEnd?.(); return; }

  window.speechSynthesis.cancel();

  const voices = _voiceCache.length > 0 ? _voiceCache : await loadVoices();
  const voice = pickVoice(lang, voices);

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  if (voice) utterance.voice = voice;
  utterance.rate  = 0.95;
  utterance.pitch = 1;
  utterance.volume = 1;

  if (onStart) utterance.onstart = onStart;
  if (onEnd) {
    utterance.onend  = onEnd;
    utterance.onerror = () => onEnd();
  }

  // Chrome bug: speechSynthesis silently stops after ~15s — periodic resume hack
  const keepAlive = setInterval(() => {
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.pause();
      window.speechSynthesis.resume();
    } else {
      clearInterval(keepAlive);
    }
  }, 10000);

  utterance.onend  = () => { clearInterval(keepAlive); onEnd?.(); };
  utterance.onerror = () => { clearInterval(keepAlive); onEnd?.(); };

  window.speechSynthesis.speak(utterance);
}
