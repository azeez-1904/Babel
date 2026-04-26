# BabelSign — NJIT Claude Hackathon

Universal communication bridge for deaf and cross-language communities.
Claude is the central nervous system — every meaningful decision routes through it.

## What it does

Two parallel communication channels in one app:

| Channel | Flow |
|---|---|
| **Voice** | Mic → Web Speech API → WebSocket → Claude translates → displayed + spoken via TTS |
| **ASL** | Webcam → MediaPipe JS (hand presence) → JPEG frame → Claude Opus 4.7 Vision identifies letter → word builder → Claude reconstructs sentence → translated to peer |

---

## How to run (3 terminals)

```bash
# 1 — TypeScript WebSocket server (handles all Claude calls)
cd babel/server && npx tsx index.ts          # port 8080

# 2 — React frontend
cd babel/web && npm run dev                   # port 5173 (or 5174 if taken)

# 3 — Python gesture service (OPTIONAL — legacy fallback only)
python3 -m uvicorn api.gesture_service:app --port 8001
```

Open http://localhost:5173

---

## Env files

| File | Used by | Key vars |
|---|---|---|
| `.env` | Python scripts | `ANTHROPIC_API_KEY` |
| `babel/server/.env` | TypeScript server | `ANTHROPIC_API_KEY`, `PORT=8080`, `GESTURE_SERVICE_URL=http://localhost:8001` |
| `babel/web/.env` | Vite frontend | `VITE_SERVER_URL=ws://localhost:8080` |

---

## Architecture

```
Browser
  ├── Voice path: Web Speech API → WS "utterance" → server → Claude translate → broadcast
  └── ASL path:   MediaPipe JS (hand detect) → WS "asl_image" (JPEG) → server
                    → Claude Opus 4.7 Vision identifies letter
                    → streak logic (2 consecutive matches → confirm)
                    → WS "asl_update" back to client
                    → "asl_send" → Claude reconstructs sentence → translate → broadcast

babel/server/index.ts   — single TypeScript WebSocket server, all Claude API calls
babel/web/src/          — React + Vite + Tailwind frontend
  components/
    ASLPanel.tsx          — full-screen camera overlay with skeleton + letter display
    ConversationScreen.tsx— main conversation UI (voice + ASL)
    HeroScreen.tsx        — room join screen
    StatusOrb.tsx         — animated orb showing connection state
  hooks/
    useASL.ts             — MediaPipe JS hand detection + JPEG capture + WS send
    useSpeech.ts          — Web Speech API recognition + TTS
    useWebSocket.ts       — WS connection management
```

---

## WebSocket message protocol

### Client → Server
| Type | Payload | Purpose |
|---|---|---|
| `join_room` | `{room_code, user_lang}` | Join a conversation room |
| `utterance` | `{original_text}` | Voice transcript to translate |
| `asl_image` | `{imageBase64}` | JPEG frame for letter recognition |
| `asl_send` | — | Finalize ASL word → sentence → translate |
| `state_change` | `{state}` | Broadcast mic/speaking state |

### Server → Client
| Type | Payload | Purpose |
|---|---|---|
| `utterance` | `{translated_text, source_lang, ...}` | Translated speech for recipient |
| `utterance_echo` | `{original_text}` | Cleaned SFW text back to sender |
| `asl_predictions` | `{letter, confidence, streak, required, currentWord}` | Live per-frame ASL feedback |
| `asl_update` | `{letter, currentWord, confidence}` | Letter confirmed, word updated |
| `asl_echo` | `{sentence, timestamp}` | Reconstructed sentence back to sender |
| `peers_update` | `{peers[]}` | Room membership list |
| `distress_alert` | — | Medical emergency detected in speech |

---

## Claude usage in this project

All Claude API calls live in **`babel/server/index.ts`** (TypeScript) and **`core/claude_brain.py`** (Python, standalone testing only).

| Function | Model | Purpose |
|---|---|---|
| Voice translation | claude-sonnet-4-5 | Translate + clean + detect distress |
| ASL letter recognition | **claude-opus-4-7** | Vision: identify ASL letter from JPEG |
| ASL sentence reconstruction | claude-sonnet-4-6 | Reconstruct full sentence from signed letters |
| Gesture disambiguation (Python) | claude-sonnet-4-6 | Top-3 ML predictions → confirmed letter |
| Haptic pattern (Python) | claude-sonnet-4-6 | ESP32 vibration feedback for training mode |
| ASL tutor feedback (Python) | claude-sonnet-4-6 | Hand geometry analysis + drill suggestion |

**Prompt caching** is on all static system prompts (`cache_control: {type: "ephemeral"}`).

---

## ASL detection design

```
Per-frame flow (1fps when hand visible):
  handleAslImage()
    │
    ├── Guard: state.processing → drop frame (one Claude call at a time)
    ├── Guard: Date.now() - lastConfirmTime < 1500ms → drop (cooldown)
    │
    ├── Claude Opus 4.7 Vision: "What ASL letter is this?"
    │     System prompt has per-letter descriptions for all 26 letters
    │     Returns: {letter: "B", confidence: 0.88}
    │
    ├── Streak logic: letter === lastLetter → consecutiveCount++
    │     consecutiveCount >= 2 → CONFIRM
    │
    └── On confirm:
          append to currentWord
          reset streak + start cooldown
          send "asl_update" to client
```

**Why streak=2?** Claude Opus 4.7 is highly accurate but ASL hand positions can momentarily look like adjacent letters. Two consecutive identical answers eliminates noise without adding perceptible delay.

**Why cooldown=1500ms?** Forces the user to pause between signs, preventing rapid-fire same-letter registration while transitioning hand position.

---

## Python pipeline (standalone / offline use)

```
data_collection/
  collect_data.py       — webcam collection with MediaPipe Tasks API, saves to data/landmarks.csv
  verify_data.py        — integrity check + skeleton plot per sign
  download_dataset.py   — download Kaggle ASL Fingerspelling dataset via Bearer auth
  load_kaggle_data.py   — extract landmarks from parquet files → landmarks.csv

model/
  train_classifier.py   — Random Forest (n=200, balanced) on landmarks.csv
                          Top-3 output for Claude disambiguation
                          Saves model/gesture_classifier.pkl + label_encoder.pkl

core/
  mediapipe_extractor.py — HandLandmarker Tasks API wrapper + normalisation
  gesture_recognizer.py  — classifier + stability buffer + word builder
  claude_brain.py        — all Python Claude API calls (disambiguation, haptics, tutor)

api/
  gesture_service.py     — FastAPI on port 8001, wraps the classifier for TS server
```

**Normalisation contract** (must match between collect_data.py and mediapipe_extractor.py):
1. Translate: subtract wrist (landmark 0) so wrist = origin
2. Scale: divide by `||landmark_9||` (wrist→middle-MCP distance)
3. Flatten: `[x0,y0,z0, x1,y1,z1, ..., x20,y20,z20]` = 63 floats

---

## Git branches

| Branch | Purpose |
|---|---|
| `master` | Original Babel voice-translation app |
| `asl` | BabelSign — ASL integration (current) |
| `main` | Base (clean) |

---

## Known limitations / next steps

- ASL detection accuracy depends on lighting and hand centering — user should fill the frame with their hand
- Letters J and Z require motion — only static position detected (end-position)
- Q, X, Z had fewer training samples in Kaggle dataset (~20-30 vs 300 for common letters)
- ESP32 haptic training mode is architected in `core/claude_brain.py` but firmware not yet integrated
- `speech/whisper_handler.py` and `speech/tts_handler.py` (Python Whisper + gTTS) not yet integrated into the web app — voice goes through browser Web Speech API instead
