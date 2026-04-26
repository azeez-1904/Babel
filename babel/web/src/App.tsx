import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { HeroScreen } from './components/HeroScreen';
import { ConversationScreen } from './components/ConversationScreen';
import { LessonScreen } from './components/LessonScreen';
import { SoloPracticeScreen } from './components/SoloPracticeScreen';
import { useWebSocket } from './hooks/useWebSocket';
import type { Screen } from './lib/types';

export default function App() {
  const [screen, setScreen] = useState<Screen>('hero');
  const [roomCode, setRoomCode] = useState('');
  const [myLang, setMyLang] = useState('en-US');
  const [myUserId, setMyUserId] = useState('');
  const [lessonTarget, setLessonTarget] = useState('');

  const { send, status, roomSize, on } = useWebSocket();

  useEffect(() => {
    const unsub = on('connected', (msg) => {
      setMyUserId(msg.user_id as string);
    });
    return unsub;
  }, [on]);

  const handleStart = useCallback((code: string, lang: string) => {
    setRoomCode(code);
    setMyLang(lang);
    send({ type: 'join_room', room_code: code, user_lang: lang });
    setScreen('conversation');
  }, [send]);

  const handleLeave = useCallback(() => {
    setScreen('hero');
    setRoomCode('');
  }, []);

  const handleLesson = useCallback((code: string, userLang: string, targetLang: string) => {
    setRoomCode(code);
    setMyLang(userLang);
    setLessonTarget(targetLang);
    setScreen('lesson');
  }, []);

  const handleSolo = useCallback(() => {
    setScreen('solo');
  }, []);

  useEffect(() => {
    if (screen === 'hero') {
      navigator.mediaDevices?.getUserMedia({ audio: true }).catch(() => {
        console.warn('Mic permission not granted yet');
      });
    }
  }, [screen]);

  return (
    <div className="h-full overflow-hidden" style={{ background: '#FAF7F2' }}>
      <AnimatePresence mode="wait">
        {screen === 'hero' && (
          <motion.div
            key="hero"
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.35 }}
          >
            <HeroScreen
              onStart={handleStart}
              onLesson={handleLesson}
              onSolo={handleSolo}
              wsStatus={status}
            />
          </motion.div>
        )}

        {screen === 'conversation' && (
          <motion.div
            key="conversation"
            className="absolute inset-0"
            initial={{ opacity: 0, scale: 1.03 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <ConversationScreen
              roomCode={roomCode}
              myLang={myLang}
              myUserId={myUserId}
              roomSize={roomSize}
              onLeave={handleLeave}
              onLesson={handleLesson}
              send={send}
              onMessage={on}
            />
          </motion.div>
        )}

        {screen === 'lesson' && (
          <motion.div
            key="lesson"
            className="absolute inset-0"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            <LessonScreen
              roomCode={roomCode}
              userLang={myLang}
              targetLang={lessonTarget}
              onBack={handleLeave}
            />
          </motion.div>
        )}

        {screen === 'solo' && (
          <motion.div
            key="solo"
            className="absolute inset-0"
            initial={{ opacity: 0, scale: 1.03 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <SoloPracticeScreen
              myUserId={myUserId}
              onLeave={handleLeave}
              send={send}
              onMessage={on}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
