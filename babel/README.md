# Babel — Real-Time AI Translation Platform

> Any room. Any language. Any input. Zero barriers.

---

## Abstract

Language barriers fragment human communication — in hospitals, classrooms, emergency situations, and everyday life. Babel is a real-time AI translation platform built to dissolve those barriers, regardless of how someone communicates. A single shared room can hold multiple participants using completely different input methods simultaneously: one person speaks aloud, another types on a phone, a third texts in from WhatsApp without ever opening a browser. Every message, regardless of its origin, is translated by Claude AI and delivered to every participant in their own language within seconds.

Built at NJIT Hackathon, Babel explores a core idea: **a room is not a chat — it's a shared understanding**. The input method is an implementation detail. The language is an implementation detail. What matters is that meaning crosses the gap.

The project also includes an experimental attempt at ASL (American Sign Language) recognition using Claude's vision API, representing a push toward making Babel accessible to users who cannot speak or type at all — signing into the same room as everyone else.

---

## What Babel Does

A Babel **room** is identified by a short 4-character code. Anyone who joins that code enters the same live conversation. The key insight is that participants don't all have to use the same interface — one person can be on the web app using voice, another using text, and a third texting from their iPhone via WhatsApp. They're all in the same room, and every message is translated for every participant in their own language.

- **Person A** speaks in English via the web app
- **Person B** types in Spanish from their phone browser
- **Person C** texts in French from WhatsApp on their iPhone
- Everyone sees and hears every message — translated, in real time

This works across any language pair Claude supports — English ↔ Spanish, English ↔ Japanese, Arabic ↔ French, and hundreds more.

---

## Modes

### Voice Mode (default)
The classic experience. Both users speak into their microphones. The browser uses the Web Speech API for speech-to-text and text-to-speech. Claude handles translation. The animated orb shows who is speaking, thinking, or idle.

### Text Mode (iMessage-style)
Can't speak? Join a room in text mode from the web app. You get an iMessage-style chat interface — blue bubbles for your messages, gray for theirs — with real-time translation happening automatically on every send. A typing indicator appears while translation is in progress.

### SMS / WhatsApp Bridge
Join a Babel room directly from your iPhone's native iMessage or WhatsApp app — no browser required. The other person uses the web app while you text from your phone:

1. Text `JOIN <ROOM_CODE> <language>` to the Twilio number
2. Receive a confirmation and start texting normally
3. Your messages get translated and appear in the web UI as chat bubbles
4. When the web user speaks or types, you get a translated SMS back

This uses Twilio's WhatsApp Sandbox for demo / development.

### Solo Practice Mode
A single-user mode for language learners. Practice conversations with an AI partner in a target language. The AI adapts to your skill level and gives feedback on your responses.

### ASL / Sign Language Mode (experimental attempt)
An attempt to extend Babel to users who cannot speak or type. This mode uses Claude's vision API to analyze webcam frames and recognize American Sign Language gestures, translating signs into text that gets spoken aloud for the other participant. It works for basic signs but real-time ASL recognition at scale is a hard problem — this is a proof-of-concept showing the direction, not a polished feature.

### ESP32 Hardware Mode (optional)
A physical companion device (ESP32 microcontroller with an OLED or TFT screen) that connects to the room and displays an animated mascot reacting to the conversation state — bouncing when someone is speaking, pulsing while thinking, sleeping when idle.

---

## Key Features

| Feature | Details |
|---|---|
| Real-time translation | Sub-3-second turnaround via Claude Sonnet |
| Mixed input rooms | Voice, text, and SMS users can all share the same room simultaneously |
| Tone preservation | Preserves AAVE, slang, code-switching, formality |
| Distress detection | Flags medical emergency keywords — shows a red alert banner |
| Transcript | Full scrollable conversation history, downloadable as PDF |
| Language auto-detection | Claude detects the source language automatically |
| Typing indicator | Animated dots while translation is processing |
| Room system | 4-character room codes, no sign-up needed |
| Multi-platform | Works on desktop and mobile browsers |
| SMS bridge | Join via WhatsApp without opening a browser |
| ASL attempt | Experimental webcam sign-language recognition via Claude Vision |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript |
| Styling | Tailwind CSS |
| Animations | Framer Motion |
| Build tool | Vite |
| Backend | Node.js + TypeScript (`tsx`) |
| Real-time comms | WebSockets (`ws`) |
| AI / Translation | Anthropic Claude API (`claude-sonnet-4-6`) |
| SMS / WhatsApp | Twilio |
| PDF export | jsPDF |
| Hardware | ESP32 (PlatformIO), OLED / TFT display |

---

## Architecture

```
                    ┌─────────────────────────────────────────┐
                    │            Babel Server (Node.js)        │
                    │                                          │
  Browser (Voice)──►│  Room Manager                           │
  Browser (Text) ──►│       │                                 │
  WhatsApp/SMS   ──►│       ▼                                 │
  ESP32 Device   ──►│  Claude API (translate + analyze)       │
                    │       │                                 │
                    │       ▼                                 │
                    │  Broadcast to all room participants      │
                    └──────────────────┬──────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────┐
                    │  Twilio (SMS/WhatsApp)                   │
                    │  POST /sms webhook ← cloudflared tunnel  │
                    └─────────────────────────────────────────┘
```

### WebSocket Message Protocol

| Message | Direction | Payload |
|---|---|---|
| `join_room` | client → server | `{ room_code, user_lang, is_device? }` |
| `utterance` | client → server | `{ original_text }` |
| `utterance` | server → client | `{ from_user, original_text, translated_text, source_lang, distress_flag, tone_note, timestamp }` |
| `utterance_echo` | server → sender | `{ original_text, timestamp }` |
| `state_change` | both directions | `{ state: idle\|listening\|thinking\|speaking\|error }` |
| `peers_update` | server → client | `{ peers: [{ userId, lang, isDevice }] }` |
| `distress_alert` | server → room | `{ from_user, message }` |
| `request_peers` | client → server | `{}` |

### Translation (Claude API)

One Claude call per utterance with a structured prompt that:
- Auto-detects source language
- Preserves tone, dialect, AAVE, code-switching, formality
- Detects medical/safety distress keywords → sets `distress_flag: true`
- Returns JSON: `{ source_lang, translated_text, distress_flag, tone_note }`

---

## Quick Start

### 1. Server

```bash
cd babel/server
npm install

# Create your .env file
cp .env.example .env
```

Edit `.env`:
```env
ANTHROPIC_API_KEY=sk-ant-...
PORT=8080

# Optional: Twilio (for SMS/WhatsApp bridge)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=whatsapp:+14155238886
```

```bash
npm run dev
# → Babel server listening on ws://localhost:8080
# → SMS bridge: POST http://localhost:8080/sms
```

### 2. Web App

```bash
cd babel/web
npm install
npm run dev
# → http://localhost:5173
```

For phones on the same Wi-Fi network, use your laptop's local IP instead of `localhost`. Find it with `ipconfig` (Windows) or `ifconfig` (Mac/Linux).

### 3. Twilio SMS Bridge (optional)

To accept WhatsApp/SMS messages, expose the local server with a tunnel:

```bash
# Download cloudflared (Windows)
# https://github.com/cloudflare/cloudflared/releases

cloudflared tunnel --url http://localhost:8080
# → https://your-unique-id.trycloudflare.com
```

Then in [Twilio Console](https://console.twilio.com) → Messaging → Try it out → Send a WhatsApp message → Sandbox settings, set the webhook to:
```
https://your-unique-id.trycloudflare.com/sms
```

**iPhone user flow:**
1. Text the sandbox join keyword to `+1 415 523 8886` on WhatsApp (get keyword from Twilio Console)
2. Text: `JOIN ROOMCODE es-ES` (replace with actual room code and your language)
3. Start texting — messages are auto-translated both ways

### 4. ESP32 Hardware (optional)

```bash
cd babel/firmware
cp src/config.example.h src/config.h
# Edit config.h: WiFi SSID, password, server IP, room code
# Uncomment USE_OLED or USE_TFT in platformio.ini

pio run --target upload
pio device monitor
```

---

## Running a Demo

1. Start the server and web app (steps 1–2 above)
2. Open `http://localhost:5173` on two devices (or two browser tabs)
3. On Device A: click **New Room**, pick **English**
4. On Device B: click **Join Room**, enter the room code, pick **Spanish**
5. Device A speaks → Device B hears it in Spanish
6. Device B speaks → Device A hears it in English

**Classic demo pair:** English ↔ Spanish  
**Maximum wow factor:** English ↔ Japanese

---

## Project Structure

```
babel/
├── server/
│   ├── index.ts          # WebSocket server, translation, SMS webhook
│   ├── roomArchive.ts    # Transcript persistence
│   └── .env              # API keys (not committed)
├── web/
│   └── src/
│       ├── App.tsx
│       ├── components/
│       │   ├── HeroScreen.tsx            # Landing page + room join
│       │   ├── ConversationScreen.tsx    # Voice mode UI
│       │   ├── TextConversationScreen.tsx # iMessage-style text UI
│       │   ├── SoloPracticeScreen.tsx    # Solo language learning
│       │   ├── LessonScreen.tsx          # Structured lesson mode
│       │   ├── TranscriptView.tsx        # Scrollable transcript
│       │   └── StatusOrb.tsx             # Animated state indicator
│       ├── hooks/
│       │   ├── useWebSocket.ts           # WS connection + message bus
│       │   └── useSpeech.ts              # STT + TTS via Web Speech API
│       └── lib/
│           └── types.ts                  # Shared TypeScript types
└── firmware/
    └── src/
        ├── main.cpp                      # ESP32 entry point
        └── config.example.h             # Hardware config template
```

---

## Notes

- **HTTPS on phones:** Mobile browsers block microphone access on non-`localhost` origins without HTTPS. Use ngrok, cloudflared, or deploy to Vercel/Railway for phone testing.
- **WhatsApp Sandbox:** Twilio's WhatsApp Sandbox requires both the sender and developer to opt in. For production SMS, a registered 10DLC or toll-free number with A2P verification is required.
- **Trial account limits:** Twilio trial accounts can only send SMS to verified phone numbers. Upgrade to a paid account for unrestricted sending.
