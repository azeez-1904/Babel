"""
ESP32-to-Babel bridge
  Port 8765  -- accepts raw 16-bit PCM @ 16 kHz from ESP32 via WebSocket
  Transcribes each chunk via Whisper and forwards utterances to Babel server

Usage:
  ANTHROPIC_API_KEY=sk-... python server.py [--room DEMO01] [--lang English] [--babel ws://localhost:8080]
"""

import asyncio, io, wave, os, json, argparse

import numpy as np
import websockets
from faster_whisper import WhisperModel

# ---- Config -----------------------------------------------------------------
ap = argparse.ArgumentParser()
ap.add_argument("--room",  default=os.getenv("ROOM_CODE", "DEMO01"))
ap.add_argument("--lang",  default=os.getenv("ESP_LANG",  "English"))
ap.add_argument("--babel", default=os.getenv("BABEL_URL", "ws://localhost:8080"))
ap.add_argument("--port",  type=int, default=int(os.getenv("ESP_PORT", "8765")))
cfg = ap.parse_args()

SAMPLE_RATE = 16000
CHUNK_BYTES = int(SAMPLE_RATE * 2 * 1.5)  # 1.5 s of 16-bit mono PCM
MIN_BYTES   = int(SAMPLE_RATE * 2 * 0.5)  # skip clips shorter than 0.5 s

_SILENCE = {"", ".", "...", "[silence]", "[no speech]", "[inaudible]", "[noise]"}

# ---- STT --------------------------------------------------------------------
print("[STT   ] loading Whisper tiny model ...", flush=True)
_whisper = WhisperModel("tiny", device="cpu", compute_type="int8")
print("[STT   ] Whisper ready", flush=True)

def _transcribe(pcm: bytes) -> str:
    audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
    segments, _ = _whisper.transcribe(audio, beam_size=1, language=None)
    text = " ".join(s.text for s in segments).strip()
    return "" if text.lower() in _SILENCE else text

# ---- Babel server connection -------------------------------------------------
_babel_ws = None

async def _connect_babel():
    global _babel_ws
    print(f"[Babel ] connecting -> {cfg.babel}", flush=True)
    _babel_ws = await websockets.connect(cfg.babel)

    data = json.loads(await _babel_ws.recv())
    print(f"[Babel ] connected  user_id={data.get('user_id')}", flush=True)

    await _babel_ws.send(json.dumps({
        "type":      "join_room",
        "room_code": cfg.room,
        "user_lang": cfg.lang,
        "is_device": True,
    }))
    print(f"[Babel ] {await _babel_ws.recv()}", flush=True)
    print(f"[Babel ] joined room={cfg.room}  lang={cfg.lang}", flush=True)

async def _send_utterance(text: str):
    if _babel_ws and not _babel_ws.closed:
        await _babel_ws.send(json.dumps({
            "type":          "utterance",
            "original_text": text,
        }))
        print(f'[Babel ] >> "{text[:100]}"', flush=True)

# ---- ESP32 handler ----------------------------------------------------------
async def esp32_handler(ws):
    addr = ws.remote_address
    print(f"[ESP32 ] connected  {addr}", flush=True)

    buf      = bytearray()
    loop     = asyncio.get_running_loop()
    msg_count = 0

    async def _do_transcribe(pcm: bytes):
        secs = len(pcm) / (SAMPLE_RATE * 2)
        print(f"[STT   ] transcribing {secs:.1f}s ...", flush=True)
        try:
            text = await loop.run_in_executor(None, _transcribe, pcm)
            if text:
                await _send_utterance(text)
            else:
                print("[STT   ] silence -- skipped", flush=True)
        except Exception as exc:
            print(f"[STT   ] error: {exc}", flush=True)

    try:
        async for msg in ws:
            if not isinstance(msg, bytes):
                continue
            msg_count += 1
            if msg_count == 1:
                print(f"[ESP32 ] first audio frame  {len(msg)} bytes", flush=True)
            buf.extend(msg)

            if len(buf) >= CHUNK_BYTES:
                pcm = bytes(buf[:CHUNK_BYTES])
                del buf[:CHUNK_BYTES]
                await _do_transcribe(pcm)

    except websockets.exceptions.ConnectionClosed as e:
        print(f"[ESP32 ] closed: code={e.code} frames={msg_count}", flush=True)

    if len(buf) >= MIN_BYTES:
        print(f"[STT   ] flushing {len(buf) / (SAMPLE_RATE * 2):.1f}s on disconnect ...", flush=True)
        await _do_transcribe(bytes(buf))

    print(f"[ESP32 ] disconnected  frames={msg_count}", flush=True)

# ---- Main -------------------------------------------------------------------
async def main():
    await _connect_babel()

    async with websockets.serve(esp32_handler, "0.0.0.0", cfg.port,
                                ping_interval=None, ping_timeout=None,
                                max_size=None):
        print("=" * 52, flush=True)
        print(f"  ESP32  ws  -> 0.0.0.0:{cfg.port}", flush=True)
        print(f"  Babel  ws  -> {cfg.babel}", flush=True)
        print(f"  Room       -> {cfg.room}", flush=True)
        print(f"  Language   -> {cfg.lang}", flush=True)
        print("=" * 52, flush=True)
        await asyncio.get_running_loop().create_future()

asyncio.run(main())
