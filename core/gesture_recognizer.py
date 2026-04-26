"""
core/gesture_recognizer.py
Gesture classification, temporal stability, and word building.

Architecture:
  MediaPipeExtractor → get_top3() → stability buffer → word builder → API layer

The stability buffer exists to prevent Claude being called on every flickering
frame. At 30fps a signer holds a letter for ~10-20 frames before transitioning.
The buffer waits until the same top prediction appears in 7 of the last 10 frames,
giving ~330ms latency from gesture start to confirmed letter — imperceptible to
the user and far less than Claude's round-trip time.

Run standalone:
  python core/gesture_recognizer.py
  (Requires model/gesture_classifier.pkl from train_classifier.py)
"""

from __future__ import annotations

import time
from collections import deque
from pathlib import Path

import cv2
import joblib
import numpy as np

from core.mediapipe_extractor import MediaPipeExtractor

# ── Paths ───────────────────────────────────────────────────────────────────
ROOT         = Path(__file__).parent.parent
MODEL_PATH   = ROOT / "model" / "gesture_classifier.pkl"
ENCODER_PATH = ROOT / "model" / "label_encoder.pkl"

# ── Stability thresholds ────────────────────────────────────────────────────
BUFFER_SIZE      = 10    # frames in the rolling window
STABILITY_VOTES  = 7     # how many of the last BUFFER_SIZE must agree
WORD_PAUSE_S     = 2.0   # seconds of silence → word completion

# ── Special gesture labels ───────────────────────────────────────────────────
SIGN_SPACE  = "SPACE"    # open flat hand → word separator
SIGN_DELETE = "DELETE"   # thumbs-down or wave → delete last letter


class GestureRecognizer:
    """
    Wraps the sklearn classifier with a stability buffer and word builder.
    Intended to be created once and kept alive for the session.
    """

    def __init__(self) -> None:
        if not MODEL_PATH.exists() or not ENCODER_PATH.exists():
            raise FileNotFoundError(
                f"Model files not found at {MODEL_PATH} / {ENCODER_PATH}. "
                "Run model/train_classifier.py first."
            )
        self._clf = joblib.load(MODEL_PATH)
        self._le  = joblib.load(ENCODER_PATH)

        # Stability buffer: stores the top-1 letter for each recent frame
        self._buffer: deque[str] = deque(maxlen=BUFFER_SIZE)

        # Word / sentence accumulation
        self.current_word: str       = ""
        self.current_sentence: list[str] = []
        self._last_confirmed_letter: str | None = None
        self._last_gesture_time: float = time.time()

    # ── Core classifier ─────────────────────────────────────────────────────

    def get_top3(self, landmark_array: list[float]) -> dict:
        """
        Run the Random Forest on a single 63-float landmark array.

        Returns:
            {
              "predictions": [
                {"letter": "A", "confidence": 0.72},
                {"letter": "H", "confidence": 0.18},
                {"letter": "E", "confidence": 0.10}
              ],
              "timestamp": 1234567890.123
            }

        This is the raw classifier output — no stability gating here.
        The caller (get_stable_result) adds the temporal layer.
        """
        arr   = np.array(landmark_array, dtype=np.float32).reshape(1, -1)
        proba = self._clf.predict_proba(arr)[0]
        top3  = np.argsort(proba)[::-1][:3]
        return {
            "predictions": [
                {"letter": str(self._le.classes_[i]), "confidence": float(proba[i])}
                for i in top3
            ],
            "timestamp": time.time(),
        }

    # ── Stability layer ─────────────────────────────────────────────────────

    def update_buffer(self, top_letter: str | None) -> None:
        """
        Push the top-1 prediction for the current frame into the rolling buffer.
        Pass None when no hand is detected to break accumulated streaks.
        """
        self._buffer.append(top_letter or "__none__")

    def get_stable_result(self, landmark_array: list[float]) -> dict | None:
        """
        Run classifier, update buffer, and return a result only when stable.

        "Stable" means the same letter appears in at least STABILITY_VOTES of the
        last BUFFER_SIZE frames. Returns None while the hand is moving or the
        buffer hasn't reached consensus.

        Also drives word-completion via the WORD_PAUSE_S idle timer.
        """
        result     = self.get_top3(landmark_array)
        top_letter = result["predictions"][0]["letter"]
        self.update_buffer(top_letter)

        # Check for stability consensus
        votes = sum(1 for x in self._buffer if x == top_letter)
        if votes < STABILITY_VOTES:
            return None

        # Don't re-confirm the same letter on every stable frame — only fire
        # when the letter changes from the last confirmed one.
        if top_letter == self._last_confirmed_letter:
            return None

        return result

    def confirm_letter(self, letter: str) -> str | None:
        """
        Called by the API layer when Claude (or the caller) has confirmed a letter.
        Updates the word builder and returns the letter that was added, or None
        if the letter was a control gesture (SPACE / DELETE).
        """
        self._last_confirmed_letter = letter
        self._last_gesture_time = time.time()

        if letter == SIGN_SPACE:
            if self.current_word:
                self.current_sentence.append(self.current_word)
            self.current_word = ""
            return None

        if letter == SIGN_DELETE:
            self.current_word = self.current_word[:-1]
            return None

        self.current_word += letter
        return letter

    def check_word_pause(self) -> bool:
        """
        Return True if the signer has been idle for WORD_PAUSE_S seconds,
        signalling implicit word completion. Resets the timer when triggered.
        """
        if time.time() - self._last_gesture_time >= WORD_PAUSE_S:
            if self.current_word:
                self.current_sentence.append(self.current_word)
                self.current_word = ""
                self._last_gesture_time = time.time()
                return True
        return False

    def reset_word(self) -> None:
        """Explicit word reset — called after sentence is sent to Claude."""
        self.current_word = ""
        self._last_confirmed_letter = None
        self._last_gesture_time = time.time()

    def reset_sentence(self) -> None:
        """Called after construct_sentence() returns — clears accumulated signs."""
        self.current_sentence = []
        self.reset_word()

    # ── Buffer clear (hand lost) ────────────────────────────────────────────

    def on_hand_lost(self) -> None:
        """
        Called each frame where no hand is detected. Clears the buffer entirely
        so the next gesture starts with zero inherited votes. A single sentinel
        push into a full buffer of 'A' still leaves 9 'A' votes — that's not a
        break, it's a smear. Clearing is the correct behaviour.
        """
        self._buffer.clear()
        self._last_confirmed_letter = None


# ── Standalone demo ──────────────────────────────────────────────────────────

def _demo() -> None:
    """
    Open webcam, run live gesture recognition, and print top-3 predictions.
    Press Q to quit.
    """
    import sys

    if not MODEL_PATH.exists():
        print(
            f"ERROR: {MODEL_PATH} not found.\n"
            "Run these steps first:\n"
            "  1. python data_collection/collect_data.py --sign A --samples 50\n"
            "  2. python model/train_classifier.py"
        )
        sys.exit(1)

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("ERROR: cannot open webcam")
        sys.exit(1)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

    recognizer = GestureRecognizer()

    with MediaPipeExtractor() as extractor:
        print("Webcam open — show ASL gestures. Press Q to quit.\n")
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            frame = cv2.flip(frame, 1)

            norm, annotated, hand_label = extractor.extract_landmarks(frame)

            if norm is None:
                recognizer.on_hand_lost()
                cv2.putText(
                    annotated, "No hand detected",
                    (20, 50), cv2.FONT_HERSHEY_SIMPLEX,
                    1.0, (0, 0, 255), 2, cv2.LINE_AA,
                )
            else:
                raw = recognizer.get_top3(norm)
                recognizer.update_buffer(raw["predictions"][0]["letter"])

                # Display top-3 on frame
                for row, pred in enumerate(raw["predictions"]):
                    pct = f"{pred['confidence']*100:.0f}%"
                    label = f"{pred['letter']}  {pct}"
                    color = (0, 220, 80) if row == 0 else (180, 180, 180)
                    cv2.putText(
                        annotated, label,
                        (20, 55 + row * 38),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        1.0 if row == 0 else 0.75,
                        color, 2, cv2.LINE_AA,
                    )

                # Buffer stability indicator
                top = raw["predictions"][0]["letter"]
                votes = sum(1 for x in recognizer._buffer if x == top)
                bar_w = int((votes / BUFFER_SIZE) * 200)
                bar_color = (0, 220, 80) if votes >= STABILITY_VOTES else (0, 180, 255)
                h, w = annotated.shape[:2]
                cv2.rectangle(annotated, (20, h - 40), (220, h - 18), (60, 60, 60), -1)
                cv2.rectangle(annotated, (20, h - 40), (20 + bar_w, h - 18), bar_color, -1)
                cv2.putText(
                    annotated, f"stability {votes}/{BUFFER_SIZE}",
                    (228, h - 22),
                    cv2.FONT_HERSHEY_PLAIN, 1.0,
                    (200, 200, 200), 1, cv2.LINE_AA,
                )

                # Word builder HUD
                word_text = f"word: {recognizer.current_word or '_'}"
                cv2.putText(
                    annotated, word_text,
                    (20, h - 60),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8,
                    (255, 220, 0), 2, cv2.LINE_AA,
                )

                # Print stable results to terminal
                stable = recognizer.get_stable_result.__func__  # type: ignore
                # Re-implement inline to avoid double-updating buffer in demo
                if votes >= STABILITY_VOTES and top != recognizer._last_confirmed_letter:
                    print(f"STABLE: {raw['predictions']}")
                    recognizer._last_confirmed_letter = top

            cv2.imshow("BabelSign — Gesture Recognizer", annotated)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    _demo()
