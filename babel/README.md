# Babel — Real-time AI Voice Translation

Two phones, one room code, zero language barriers. Speak naturally; hear each other in your own language in real time.

---

## Quick start

### 1. Server

```bash
cd babel/server
npm install

# Copy and fill in your key
cp .env.example .env
# Edit .env: set ANTHROPIC_API_KEY=sk-ant-...

npm run dev
# → Babel server listening on ws://localhost:8080
```

### 2. Web app

```bash
cd babel/web
npm install

# For local browser testing:
cp .env.example .env
# VITE_SERVER_URL=ws://localhost:8080

# For phone demo (phones must be on same LAN as laptop):
# Find your laptop's IP: ipconfig (Windows) or ifconfig (Mac/Linux)
# Set VITE_SERVER_URL=ws://192.168.X.X:8080 in .env

npm run dev
# → http://localhost:5173  (and your LAN IP)
```

Open that LAN URL on two phones. Pick languages. Start talking.

### 3. ESP32 firmware (optional)

**Requirements:** ESP32 + SSD1306 OLED (I2C) or ST7789 TFT (SPI)

```bash
# Install PlatformIO CLI or use the VS Code extension

cd babel/firmware
cp src/config.example.h src/config.h
# Edit config.h: WiFi credentials, server IP, room code

# In platformio.ini, uncomment USE_OLED or USE_TFT as appropriate
# Then flash:
pio run --target upload
pio device monitor   # to see logs
```

---

## Architecture

```
Phone A (mic → STT)                      Phone B (TTS → earphone)
    │                                           ▲
    │ utterance { original_text }               │ utterance { translated_text }
    ▼                                           │
┌─────────────────── Babel Server ─────────────────────┐
│  Room manager  →  Claude API (translate)  →  Broadcast│
└────────────────────────────────────────────────────────┘
         │ state_change { state }
         ▼
    ESP32 device (OLED/TFT mascot)
```

### Message protocol

| Type | Direction | Payload |
|------|-----------|---------|
| `join_room` | client → server | `{ room_code, user_lang, is_device? }` |
| `utterance` | client → server | `{ original_text }` |
| `state_change` | both | `{ state: idle\|listening\|thinking\|speaking\|error }` |
| `device_ping` | device → server | `{ device_id }` |
| `utterance` | server → client | `{ from_user, original_text, translated_text, source_lang, distress_flag, tone_note, timestamp }` |
| `distress_alert` | server → room | `{ from_user, message }` |

### Translation (Claude API)

One `claude-sonnet-4-5` call per utterance. The prompt:
- Auto-detects source language
- Preserves tone, dialect, AAVE, code-switching
- Detects medical distress keywords and sets `distress_flag: true`
- Returns JSON: `{ source_lang, translated_text, distress_flag, tone_note }`

---

## Demo tips

- **Phone browsers:** Chrome on Android / Safari on iOS. Both support Web Speech API.
- **HTTPS:** For phones NOT on localhost, browsers may block mic without HTTPS. Easiest fix: use [ngrok](https://ngrok.com) or Caddy to proxy with TLS, or serve from a Vercel/Railway deploy.
- **First conversation:** A speaks English, B speaks Spanish is the classic demo. Try English ↔ Japanese for maximum wow.
- **ESP32:** Get the bobble animation working first (THINKING state). It's the crowd-pleaser.

---

## Stretch goals (not built)

- ASL/computer-vision mode
- Web Vibration API haptics on distress_flag
- Jargon simplification mode (medical/legal)
- Persistent room codes
