"""
core/claude_brain.py
Central Claude integration — ALL Claude API calls for BabelSign live here.

Design principle:
  The ML classifier is intentionally weak — it returns top-3 guesses.
  Claude receives those raw signals plus full conversation history and does the
  actual reasoning. This file is the nerve centre of that design; nothing else
  in the project should ever call the Anthropic API directly.

Prompt caching strategy:
  All five system prompts are 100% static, making them ideal cache targets.
  At 1 gesture every ~500ms, caching saves roughly 90% on system-prompt tokens.
  Rule: no dynamic data ever touches a system prompt — it all goes in the user
  message. A single timestamp in a system prompt would bust the cache every call.

Model choice:
  claude-sonnet-4-6 — per-gesture calls need <300ms round-trips and low cost.
  Sonnet is fast enough, cheap enough, and more than capable for disambiguation.
  Swap to claude-opus-4-7 only for the tutor feedback path if quality demands it.
"""

import json
import os
import re
import time
from typing import Any

import anthropic
from dotenv import load_dotenv

load_dotenv()

MODEL = "claude-sonnet-4-6"
MAX_HISTORY = 20   # rolling window cap; older turns are dropped when exceeded

_JSON_FENCE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)
_JSON_OBJ   = re.compile(r"\{[\s\S]*\}")


def _parse_json(text: str) -> dict:
    """
    Robustly extract a JSON object from a model response.
    Handles three cases the model occasionally produces:
      1. Clean JSON  (ideal — direct json.loads)
      2. JSON inside ```json ... ``` fences
      3. JSON embedded in prose  (grep for first {...})
    Raises ValueError with the raw text if all three fail.
    """
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    m = _JSON_FENCE.search(text)
    if m:
        try:
            return json.loads(m.group(1).strip())
        except json.JSONDecodeError:
            pass
    m = _JSON_OBJ.search(text)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            pass
    raise ValueError(f"No valid JSON found in model response:\n{text}")


class ClaudeBrain:
    def __init__(self) -> None:
        self.client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        self.conversation_history: list[dict[str, Any]] = []

    # ── Gesture disambiguation ──────────────────────────────────────────────

    def disambiguate_gesture(
        self,
        predictions: list[dict],   # [{"letter": "A", "confidence": 0.72}, ...]
        current_word: str,
        conversation_history: list[dict],
    ) -> dict:
        """
        Resolve which letter the signer intended from top-3 CV model predictions.

        Why this system prompt:
          Enumerates all four context signals explicitly so Claude doesn't skip
          any (confidence scores, partial word, conversation context, English
          patterns). "Return ONLY valid JSON" guards against prose wrapping that
          breaks json.loads(). The word "briefly" in reasoning caps the field so
          it doesn't balloon into a long explanation that slows real-time inference.

        Why this JSON schema:
          Three fields only: letter (the answer), reasoning (debuggability),
          confidence (lets the caller decide whether to suppress low-confidence
          letters and wait for more temporal stability). No nested objects — flat
          schema parses faster and is less likely to truncate under tight max_tokens.

        Failure modes guarded:
          - CV model confident but wrong (e.g. "H" at 0.9 when context says "HEL")
            → conversation_history pulls Claude toward "L" or "P".
          - All three predictions low-confidence (hand is moving) → Claude should
            return low confidence; caller suppresses until stabilised.
          - Non-English words / proper nouns → ASL note in construct_sentence
            handles these; here Claude uses English patterns as a heuristic only.
        """
        # System prompt is static — attach cache_control so repeated calls within
        # a session pay ~0.1× on the system prefix.
        system = [
            {
                "type": "text",
                "text": (
                    "You are the gesture disambiguation engine for BabelSign, a sign "
                    "language communication bridge. A computer vision model has classified "
                    "an ASL hand gesture and returned its top 3 predictions with confidence "
                    "scores. Your job is to determine the most likely intended letter using:\n"
                    "1. The confidence scores from the CV model\n"
                    "2. The letters signed so far in the current word\n"
                    "3. The conversation history for semantic context\n"
                    "4. Common English and ASL word patterns\n"
                    'Return ONLY valid JSON, no markdown, no extra text:\n'
                    '{"letter": "A", "reasoning": "max 10 words", "confidence": 0.95}'
                ),
                "cache_control": {"type": "ephemeral"},
            }
        ]

        # Last 3 turns give context without blowing out the prompt.
        # More than 3 rarely changes a single-letter decision.
        recent_history = conversation_history[-3:] if conversation_history else []

        user_content = (
            f"Predictions: {json.dumps(predictions)}\n"
            f"Current word so far: '{current_word}'\n"
            f"Recent conversation: {json.dumps(recent_history)}"
        )

        response = self.client.messages.create(
            model=MODEL,
            max_tokens=512,
            system=system,
            messages=[{"role": "user", "content": user_content}],
        )

        raw = response.content[0].text.strip()
        return _parse_json(raw)

    # ── Sentence construction ───────────────────────────────────────────────

    def construct_sentence(
        self,
        accumulated_signs: list[str],
        conversation_history: list[dict],
    ) -> dict:
        """
        Reconstruct a full English sentence from ASL-signed letters / words.

        Why this system prompt:
          Explicitly states ASL grammar differences (no articles, topic-comment
          structure) so Claude doesn't "correct" valid ASL by inserting "the".
          "Incomplete or fragmented" acknowledgement prevents Claude from refusing
          to interpret partial input. Asking for intent separately from sentence
          lets the TTS layer choose whether to speak the literal sentence or the
          paraphrased intent.

        Why this JSON schema:
          - sentence: the reconstructed text, spoken aloud by TTS.
          - intent: what the person is communicating, shown in UI for the hearing
            person — sometimes clearer than the raw sentence.
          - asl_note: educational context for trainer / teacher mode logging;
            helps developers audit whether ASL grammar is being handled correctly.

        Failure modes guarded:
          - Single-letter or single-word input being silently dropped → the schema
            forces Claude to always produce a sentence even from minimal input.
          - Profane or unexpected sequences → Claude normalises gracefully rather
            than refusing.
          - Very long accumulated_signs lists → the word builder caps words at
            ~50 chars, so this call always receives manageable input.
        """
        system = [
            {
                "type": "text",
                "text": (
                    "You are receiving letters signed in American Sign Language. ASL "
                    "grammar differs from English — it often omits articles, uses topic-"
                    "comment structure, and relies on context. The input may be incomplete "
                    "or fragmented. Reconstruct the most likely intended full English "
                    "sentence. Return ONLY valid JSON:\n"
                    '{"sentence": "full reconstructed sentence", '
                    '"intent": "what the person is trying to communicate", '
                    '"asl_note": "brief note on any ASL grammar applied"}'
                ),
                "cache_control": {"type": "ephemeral"},
            }
        ]

        recent_history = conversation_history[-5:] if conversation_history else []
        user_content = (
            f"Signs accumulated: {json.dumps(accumulated_signs)}\n"
            f"Conversation so far: {json.dumps(recent_history)}"
        )

        response = self.client.messages.create(
            model=MODEL,
            max_tokens=512,
            system=system,
            messages=[{"role": "user", "content": user_content}],
        )

        raw = response.content[0].text.strip()
        return _parse_json(raw)

    # ── Voice input processing ──────────────────────────────────────────────

    def process_voice_input(
        self,
        transcript: str,
        conversation_history: list[dict],
        target_language: str = "en",
    ) -> dict:
        """
        Clean, language-detect, translate, and simplify a Whisper transcript.

        Why this system prompt:
          Four explicit numbered tasks prevent Claude from collapsing them — e.g.
          translating without cleaning first, or simplifying without detecting
          language. "Maintain the conversational tone from history" grounds the
          translation in the ongoing dialogue rather than producing a context-free
          rendition. "No idioms, short sentences" for the simplified field guards
          against cultural idioms that deaf recipients may not recognise from
          lip-reading context.

        Why this JSON schema:
          - source_language: ISO code lets the frontend flag the conversation
            origin and select the right TTS voice.
          - cleaned_transcript: logged for debugging Whisper errors over time.
          - translation: the primary display text shown to the deaf person.
          - simplified: used when display space is constrained or the deaf person
            has indicated they prefer plain language.

        Failure modes guarded:
          - Whisper produces "gonna" / run-on sentences → cleaned_transcript fixes.
          - Whisper guesses the wrong language code → source_language from Claude
            overrides it.
          - Target language same as source → Claude still cleans + detects,
            returns the same text for translation (no failure, just identity op).
        """
        system = [
            {
                "type": "text",
                "text": (
                    "You are the voice processing layer of BabelSign. You receive a raw "
                    "speech transcript (may contain errors from speech recognition). "
                    "Your tasks:\n"
                    "1. Clean obvious transcription errors using context\n"
                    "2. Detect the source language\n"
                    "3. Translate to the target language\n"
                    "4. Create a simplified version for a deaf recipient (clear, no "
                    "idioms, short sentences)\n"
                    "Maintain the conversational tone from history.\n"
                    "Return ONLY valid JSON, no markdown:\n"
                    '{"source_language": "en", "cleaned_transcript": "...", '
                    '"translation": "...", "simplified": "..."}'
                ),
                "cache_control": {"type": "ephemeral"},
            }
        ]

        recent_history = conversation_history[-5:] if conversation_history else []
        user_content = (
            f"Raw transcript: {transcript}\n"
            f"Target language: {target_language}\n"
            f"Conversation history: {json.dumps(recent_history)}"
        )

        response = self.client.messages.create(
            model=MODEL,
            max_tokens=1024,
            system=system,
            messages=[{"role": "user", "content": user_content}],
        )

        raw = response.content[0].text.strip()
        return _parse_json(raw)

    # ── Haptic pattern generation ───────────────────────────────────────────

    def generate_haptic_pattern(
        self,
        gesture_confidence: float,
        is_correct: bool,
        attempt_number: int,
    ) -> dict:
        """
        Decide physical vibration feedback for the ESP32 in training mode.

        Why this system prompt:
          "Consider the attempt number to calibrate encouragement" is the load-
          bearing instruction — early attempts need encouragement, later ones need
          precision. Without this, Claude defaults to the same feedback regardless
          of context. Listing the four pattern names as an explicit enum prevents
          Claude from inventing new patterns the ESP32 firmware doesn't understand.

        Why this JSON schema:
          - pattern: string enum maps to a named motor sequence in the Arduino sketch.
          - intensity: 0–255 PWM value, directly passed to analogWrite().
          - duration_ms and pulses: shape the vibration waveform.
          - display_message: shown in the frontend training panel, routed separately
            from the ESP32 command so the haptic and UI updates decouple cleanly.

        Failure modes guarded:
          - intensity > 255 would overflow analogWrite() → clamped post-parse.
          - Attempt 1 + is_correct=False → Claude should be encouraging, not critical.
          - is_correct=True but low confidence → Claude should detect the tension
            and return "close" rather than "excellent".
        """
        system = [
            {
                "type": "text",
                "text": (
                    "You are the haptic feedback controller for BabelSign's ASL training "
                    "mode. Based on the learner's gesture quality, decide what physical "
                    "feedback pattern to send to the ESP32 vibration motor. Consider the "
                    "attempt number to calibrate encouragement (be more encouraging on "
                    "early attempts, more precise on later ones).\n"
                    "Return ONLY valid JSON, no markdown:\n"
                    '{"pattern": "success|close|wrong|excellent", '
                    '"intensity": 150, "duration_ms": 300, "pulses": 2, '
                    '"display_message": "one short sentence"}'
                ),
                "cache_control": {"type": "ephemeral"},
            }
        ]

        user_content = (
            f"Gesture confidence score: {gesture_confidence:.2f}\n"
            f"Is the gesture correct: {is_correct}\n"
            f"Attempt number: {attempt_number}"
        )

        response = self.client.messages.create(
            model=MODEL,
            max_tokens=256,
            system=system,
            messages=[{"role": "user", "content": user_content}],
        )

        raw = response.content[0].text.strip()
        result = _parse_json(raw)

        # Clamp intensity to valid ESP32 analogWrite() range — Claude may exceed 255.
        result["intensity"] = max(0, min(255, int(result.get("intensity", 150))))
        return result

    # ── ASL tutor feedback ──────────────────────────────────────────────────

    def generate_tutor_feedback(
        self,
        landmark_array: list[float],    # 63 floats: [x0,y0,z0, ..., x20,y20,z20]
        target_sign: str,
        attempt_history: list[dict],    # previous attempt scores and feedback
    ) -> dict:
        """
        Analyse normalised hand landmark geometry and give ASL tutor feedback.

        Why this system prompt:
          "21 points, x,y,z" makes it explicit that z is depth, which Claude might
          otherwise ignore when reasoning about 3D hand pose. "Specific, actionable"
          prevents vague feedback like "try harder". The drill field especially
          requires a concrete micro-exercise. "Encouraging but precise" balances
          motivation with accuracy — generic coaching prompts produce one or the
          other but rarely both.

        Why this JSON schema:
          - score: 0–100 numeric lets the frontend render a progress bar and track
            improvement over sessions.
          - feedback: the primary correction instruction, shown prominently in UI.
          - what_was_right: positive reinforcement — critical for learner retention
            and morale during a hackathon demo.
          - drill: a specific micro-exercise that can be repeated without Claude
            (e.g. "Hold index finger straight for 5 seconds") — makes the feedback
            actionable even when offline or between API calls.

        Failure modes guarded:
          - All-zero landmark array (hand not detected) → score near 0, feedback
            asks user to reposition their hand in frame.
          - Unknown target_sign → Claude defaults to generic hand posture advice.
          - Experienced learner (high scores in history) → score reflects current
            attempt, not inflated by prior success.

        Latency note: this is the most expensive call (~512 output tokens + long
        user message). Fire it only when a word is completed, not per-frame.
        Using claude-opus-4-7 here would improve quality; swap if demo feedback
        quality is insufficient.
        """
        system = [
            {
                "type": "text",
                "text": (
                    "You are an ASL tutor analyzing a learner's hand gesture geometry. "
                    "You receive normalized landmark coordinates (21 points, x,y,z) for "
                    "a sign attempt and the target sign they were trying to make. Give "
                    "specific, actionable corrective feedback about finger positions, "
                    "hand orientation, and wrist angle. Be encouraging but precise.\n"
                    "Return ONLY valid JSON, no markdown:\n"
                    '{"score": 78, "feedback": "specific correction instruction", '
                    '"what_was_right": "what they did correctly", '
                    '"drill": "specific micro-exercise to improve"}'
                ),
                "cache_control": {"type": "ephemeral"},
            }
        ]

        # Format landmarks as labelled points — Claude reasons better about
        # "pt8 (index fingertip): x=0.12 y=-0.45 z=0.03" than a flat float list.
        landmark_names = [
            "WRIST",
            "THUMB_CMC", "THUMB_MCP", "THUMB_IP", "THUMB_TIP",
            "INDEX_MCP", "INDEX_PIP", "INDEX_DIP", "INDEX_TIP",
            "MIDDLE_MCP", "MIDDLE_PIP", "MIDDLE_DIP", "MIDDLE_TIP",
            "RING_MCP", "RING_PIP", "RING_DIP", "RING_TIP",
            "PINKY_MCP", "PINKY_PIP", "PINKY_DIP", "PINKY_TIP",
        ]
        formatted_pts = []
        for i in range(21):
            name = landmark_names[i] if i < len(landmark_names) else f"pt{i}"
            x = landmark_array[i * 3]
            y = landmark_array[i * 3 + 1]
            z = landmark_array[i * 3 + 2]
            formatted_pts.append(f"  {name}: x={x:.3f} y={y:.3f} z={z:.3f}")

        # Send only scores from attempt history to keep the prompt short.
        history_summary = [
            {"attempt": i + 1, "score": a.get("score", 0)}
            for i, a in enumerate(attempt_history[-5:])
        ]

        user_content = (
            f"Target sign: {target_sign}\n"
            f"Landmark coordinates (normalised, wrist=origin):\n"
            + "\n".join(formatted_pts)
            + f"\nPrevious attempts (last 5): {json.dumps(history_summary)}"
        )

        response = self.client.messages.create(
            model=MODEL,
            max_tokens=512,
            system=system,
            messages=[{"role": "user", "content": user_content}],
        )

        raw = response.content[0].text.strip()
        result = _parse_json(raw)

        # Clamp score to 0–100 so the frontend progress bar never breaks.
        result["score"] = max(0, min(100, int(result.get("score", 50))))
        return result

    # ── History management ──────────────────────────────────────────────────

    def add_to_history(self, role: str, content: str) -> None:
        """Append a turn and maintain a rolling MAX_HISTORY-turn window."""
        self.conversation_history.append({
            "role": role,
            "content": content,
            "timestamp": time.time(),
        })
        if len(self.conversation_history) > MAX_HISTORY:
            self.conversation_history = self.conversation_history[-MAX_HISTORY:]

    def get_history(self) -> list[dict]:
        return self.conversation_history
