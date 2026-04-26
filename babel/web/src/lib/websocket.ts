export type WsCallback = (msg: Record<string, unknown>) => void;

export class BabelWS {
  private ws: WebSocket | null = null;
  private listeners = new Set<WsCallback>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private url: string;
  private intentionalClose = false;

  constructor(url: string) {
    this.url = url;
  }

  connect() {
    this.intentionalClose = false;
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.emit({ type: '_ws_open' });
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        this.emit(msg);
      } catch { /* ignore malformed */ }
    };

    this.ws.onclose = () => {
      this.emit({ type: '_ws_close' });
      if (!this.intentionalClose) {
        this.reconnectTimer = setTimeout(() => this.connect(), 2000);
      }
    };

    this.ws.onerror = () => {
      this.emit({ type: '_ws_error' });
    };
  }

  send(payload: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  on(cb: WsCallback) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  close() {
    this.intentionalClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const ws = this.ws;
    if (!ws) return;

    if (ws.readyState === WebSocket.CONNECTING) {
      // React dev mode can unmount immediately after mount. Closing a socket
      // while it is still connecting creates a noisy browser warning.
      ws.onopen = () => ws.close();
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      return;
    }

    if (ws.readyState === WebSocket.OPEN) ws.close();
    this.ws = null;
  }

  private emit(msg: Record<string, unknown>) {
    this.listeners.forEach(cb => cb(msg));
  }
}
