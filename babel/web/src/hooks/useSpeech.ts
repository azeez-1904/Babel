import { useEffect, useRef, useState, useCallback } from 'react';

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
    if (!enabled) {
      stop();
      return;
    }

    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: typeof window.SpeechRecognition }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: typeof window.SpeechRecognition }).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('SpeechRecognition not supported');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      onStateChange('listening');
    };

    recognition.onend = () => {
      setIsListening(false);
      onStateChange('idle');
      onInterim(''); // clear interim on end
      if (enabledRef.current) {
        restartTimerRef.current = setTimeout(() => {
          if (enabledRef.current) {
            try { recognition.start(); } catch { /* ignore */ }
          }
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
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const text = result[0].transcript.trim();
          if (text.length > 1) {
            onInterim(''); // clear interim before sending final
            onFinal(text);
          }
        } else {
          interimTranscript += result[0].transcript;
        }
      }
      if (interimTranscript) onInterim(interimTranscript);
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

export function speakText(text: string, lang: string, onStart?: () => void, onEnd?: () => void) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 0.95;
  utterance.pitch = 1;
  utterance.volume = 1;
  if (onStart) utterance.onstart = onStart;
  if (onEnd) { utterance.onend = onEnd; utterance.onerror = onEnd; }
  window.speechSynthesis.speak(utterance);
}
