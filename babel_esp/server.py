"""
ESP32-to-Babel bridge
  Port 8765  -- accepts raw 16-bit PCM @ 16 kHz from ESP32 via WebSocket
  Transcribes each chunk via Whisper and forwards utterances to Babel server

Usage:
  python server.py [--room DEMO01] [--lang English] [--babel ws://localhost:8080] [--model tiny]

Environment variables (override defaults):
  ROOM_CODE   room code to join  (default DEMO01)
  ESP_LANG    language label      (default English)
  BABEL_URL   Babel WS endpoint   (default ws://localhost:8080)
  ESP_PORT    listen port for ESP (default 8765)
"""

import asyncio, os, json, argparse, time, logging

import numpy as np
import websockets
from faster_whisper import WhisperModel

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)-6s] %(message)s",
    datefmt="%H:%M:%S",
)
log_esp   = logging.getLogger("ESP32")
log_stt   = logging.getLogger("STT")
log_babel = logging.getLogger("Babel")

# ---- Config -----------------------------------------------------------------
ap = argparse.ArgumentParser(description="ESP32-to-Babel audio bridge")
ap.add_argument("--room",  default=os.getenv("ROOM_CODE", "DEMO01"),
                help="Babel room code (default: DEMO01)")
ap.add_argument("--lang",  default=os.getenv("ESP_LANG",  "English"),
                help="Language label sent to Babel (default: English)")
ap.add_argument("--babel", default=os.getenv("BABEL_URL", "ws://localhost:8080"),
                help="Babel server WebSocket URL (default: ws://localhost:8080)")
ap.add_argument("--port",  type=int, default=int(os.getenv("ESP_PORT", "8765")),
                help="Port to listen for ESP32 connections (default: 8765)")
ap.add_argument("--model", default=os.getenv("WHISPER_MODEL", "base"),
                choices=["tiny", "base", "small", "medium", "large-v3"],
                help="Whisper model size (default: base)")
cfg = ap.parse_args()

SAMPLE_RATE = 16000
CHUNK_BYTES = int(SAMPLE_RATE * 2 * 1.5)  # 1.5 s of 16-bit mono PCM
MIN_BYTES   = int(SAMPLE_RATE * 2 * 0.5)  # skip clips shorter than 0.5 s

_SILENCE = {"", ".", "...", "[silence]", "[no speech]", "[inaudible]", "[noise]",
            "you", "thank you.", "thanks for watching!"}

# ---- STT --------------------------------------------------------------------
log_stt.info("Loading Whisper '%s' model (cpu/int8) ...", cfg.model)
_whisper = WhisperModel(cfg.model, device="cpu", compute_type="int8")
log_stt.info("Whisper '%s' ready", cfg.model)

def _transcribe(pcm: bytes) -> str:
    audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
    segments, _ = _whisper.transcribe(audio, beam_size=1, language=None)
    text = " ".join(s.text for s in segments).strip()
    return "" if text.lower() in _SILENCE else text

# ---- Babel server connection (with auto-reconnect) --------------------------
_babel_ws = None
_babel_lock = asyncio.Lock()

async def _ensure_babel():
    """Connect (or reconnect) to the Babel server and join the room."""
    global _babel_ws

    async with _babel_lock:
        if _babel_ws and not _babel_ws.closed:
            return True

        for attempt in range(1, 6):
            try:
                log_babel.info("Connecting to %s (attempt %d) ...", cfg.babel, attempt)
                _babel_ws = await asyncio.wait_for(
                    websockets.connect(cfg.babel), timeout=5
                )

                data = json.loads(await _babel_ws.recv())
                log_babel.info("Connected — user_id=%s", data.get("user_id"))

                await _babel_ws.send(json.dumps({
                    "type":      "join_room",
                    "room_code": cfg.room,
                    "user_lang": cfg.lang,
                    "is_device": True,
                }))
                join_resp = json.loads(await _babel_ws.recv())
                log_babel.info("Joined room=%s lang=%s (room_size=%s)",
                               cfg.room, cfg.lang, join_resp.get("room_size"))
                return True

            except Exception as exc:
                log_babel.warning("Connection failed: %s", exc)
                _babel_ws = None
                if attempt < 5:
                    wait = min(2 ** attempt, 10)
                    log_babel.info("Retrying in %ds ...", wait)
                    await asyncio.sleep(wait)

        log_babel.error("Could not connect to Babel after 5 attempts")
        return False


async def _send_utterance(text: str):
    global _babel_ws

    if not await _ensure_babel():
        log_babel.error("Dropping utterance (no Babel connection): %s", text[:80])
        return

    try:
        await _babel_ws.send(json.dumps({
            "type":          "utterance",
            "original_text": text,
        }))
        log_babel.info('>> "%s"', text[:120])
    except Exception as exc:
        log_babel.warning("Send failed (%s), will reconnect next time", exc)
        _babel_ws = None

# ---- ESP32 handler ----------------------------------------------------------
async def esp32_handler(ws):
    addr = ws.remote_address
    log_esp.info("Device connected from %s", addr)

    buf       = bytearray()
    loop      = asyncio.get_running_loop()
    msg_count = 0
    t_start   = time.monotonic()

    async def _do_transcribe(pcm: bytes):
        secs = len(pcm) / (SAMPLE_RATE * 2)
        log_stt.info("Transcribing %.1fs of audio ...", secs)
        try:
            t0 = time.monotonic()
            text = await loop.run_in_executor(None, _transcribe, pcm)
            elapsed = time.monotonic() - t0
            if text:
                log_stt.info("Result (%.1fs): \"%s\"", elapsed, text[:120])
                await _send_utterance(text)
            else:
                log_stt.info("Silence (%.1fs) — skipped", elapsed)
        except Exception as exc:
            log_stt.error("Transcription error: %s", exc)

    try:
        async for msg in ws:
            if not isinstance(msg, bytes):
                continue
            msg_count += 1
            if msg_count == 1:
                log_esp.info("First audio frame: %d bytes", len(msg))
            buf.extend(msg)

            if len(buf) >= CHUNK_BYTES:
                pcm = bytes(buf[:CHUNK_BYTES])
                del buf[:CHUNK_BYTES]
                await _do_transcribe(pcm)

    except websockets.exceptions.ConnectionClosed as e:
        log_esp.info("Connection closed: code=%s, received %d frames", e.code, msg_count)

    if len(buf) >= MIN_BYTES:
        log_stt.info("Flushing %.1fs of buffered audio on disconnect ...",
                     len(buf) / (SAMPLE_RATE * 2))
        await _do_transcribe(bytes(buf))

    elapsed = time.monotonic() - t_start
    log_esp.info("Disconnected after %.0fs — %d audio frames total", elapsed, msg_count)

# ---- Main -------------------------------------------------------------------
async def main():
    connected = await _ensure_babel()
    if not connected:
        log_babel.warning("Starting without Babel — will retry when ESP sends audio")

    async with websockets.serve(esp32_handler, "0.0.0.0", cfg.port,
                                ping_interval=None, ping_timeout=None,
                                max_size=None):
        print()
        print("=" * 56)
        print(f"  ESP32-to-Babel Bridge")
        print(f"  ESP32 listens on   ws://0.0.0.0:{cfg.port}")
        print(f"  Babel server       {cfg.babel}")
        print(f"  Room               {cfg.room}")
        print(f"  Language            {cfg.lang}")
        print(f"  Whisper model       {cfg.model}")
        print("=" * 56)
        print()
        await asyncio.get_running_loop().create_future()

asyncio.run(main())
