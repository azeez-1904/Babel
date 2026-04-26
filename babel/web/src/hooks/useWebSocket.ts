import { useEffect, useRef, useState, useCallback } from 'react';
import { BabelWS } from '../lib/websocket';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'ws://localhost:8080';

export type WsStatus = 'connecting' | 'connected' | 'disconnected';

export function useWebSocket() {
  const wsRef = useRef<BabelWS | null>(null);
  const [status, setStatus] = useState<WsStatus>('disconnected');
  const [roomSize, setRoomSize] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlersRef = useRef<Record<string, ((msg: any) => void)[]>>({});

  const on = useCallback((type: string, handler: (msg: Record<string, unknown>) => void) => {
    if (!handlersRef.current[type]) handlersRef.current[type] = [];
    handlersRef.current[type].push(handler);
    return () => {
      handlersRef.current[type] = handlersRef.current[type].filter(h => h !== handler);
    };
  }, []);

  useEffect(() => {
    const ws = new BabelWS(SERVER_URL);
    wsRef.current = ws;

    const unsub = ws.on((msg) => {
      const type = msg.type as string;
      if (type === '_ws_open')  { setStatus('connecting'); return; }
      if (type === '_ws_close') { setStatus('disconnected'); return; }
      if (type === '_ws_error') { setStatus('disconnected'); return; }
      if (type === 'connected') { setStatus('connected'); }
      if (type === 'joined' || type === 'peer_joined' || type === 'peer_left') {
        if (msg.room_size) setRoomSize(msg.room_size as number);
      }

      const handlers = handlersRef.current[type];
      if (handlers) handlers.forEach(h => h(msg));

      const wildcardHandlers = handlersRef.current['*'];
      if (wildcardHandlers) wildcardHandlers.forEach(h => h(msg));
    });

    ws.connect();
    setStatus('connecting');

    return () => {
      unsub();
      ws.close();
    };
  }, []);

  const send = useCallback((payload: object) => {
    wsRef.current?.send(payload);
  }, []);

  return { send, status, roomSize, on };
}
