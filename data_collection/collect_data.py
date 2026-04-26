"""
BabelSign ASL Data Collector
CLI: python data_collection/collect_data.py --sign "A" --samples 50

Uses MediaPipeExtractor from core/ so normalisation is guaranteed identical
to inference time — the single most important contract in the whole pipeline.
"""

import argparse
import csv
import sys
import time
from pathlib import Path

import cv2
import numpy as np

# Import extractor so normalisation is always the same code path as inference
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from core.mediapipe_extractor import MediaPipeExtractor, draw_skeleton

# ── Paths ───────────────────────────────────────────────────────────────────
DATA_DIR   = ROOT / "data"
CSV_PATH   = DATA_DIR / "landmarks.csv"
CSV_HEADER = ["label"] + [f"{c}{i}" for i in range(21) for c in ("x", "y", "z")]

CAPTURE_INTERVAL_S = 0.15   # min seconds between samples (adds frame diversity)
COUNTDOWN_SECONDS  = 3


# ── Drawing helpers ─────────────────────────────────────────────────────────
def draw_countdown(frame: np.ndarray, seconds_left: int) -> np.ndarray:
    h, w = frame.shape[:2]
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (w, h), (0, 0, 0), -1)
    cv2.addWeighted(overlay, 0.55, frame, 0.45, 0, frame)
    digit_str = str(seconds_left)
    (tw, th), _ = cv2.getTextSize(digit_str, cv2.FONT_HERSHEY_SIMPLEX, 9, 12)
    cx, cy = (w - tw) // 2, (h + th) // 2
    cv2.putText(frame, digit_str, (cx, cy),
                cv2.FONT_HERSHEY_SIMPLEX, 9, (0, 255, 255), 12, cv2.LINE_AA)
    cv2.putText(frame, "Get ready!", (w // 2 - 140, cy - th - 20),
                cv2.FONT_HERSHEY_SIMPLEX, 1.6, (255, 255, 255), 3, cv2.LINE_AA)
    return frame


def draw_hud(frame: np.ndarray, sign: str, collected: int, target: int) -> np.ndarray:
    h, w = frame.shape[:2]
    cv2.putText(frame, f"Sign: {sign}", (20, 65),
                cv2.FONT_HERSHEY_SIMPLEX, 2.2, (0, 255, 0), 5, cv2.LINE_AA)
    cv2.putText(frame, f"{collected} / {target}", (20, 120),
                cv2.FONT_HERSHEY_SIMPLEX, 1.4, (255, 220, 0), 3, cv2.LINE_AA)
    bar_x0, bar_y0 = 20, h - 45
    bar_x1, bar_y1 = w - 20, h - 18
    cv2.rectangle(frame, (bar_x0, bar_y0), (bar_x1, bar_y1), (60, 60, 60), -1)
    fill = bar_x0 + int((collected / max(target, 1)) * (bar_x1 - bar_x0))
    cv2.rectangle(frame, (bar_x0, bar_y0), (fill, bar_y1), (0, 200, 60), -1)
    cv2.rectangle(frame, (bar_x0, bar_y0), (bar_x1, bar_y1), (140, 140, 140), 2)
    return frame


# ── Main collection loop ─────────────────────────────────────────────────────
def collect(sign: str, num_samples: int) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    write_header = not CSV_PATH.exists()
    csv_file = open(CSV_PATH, "a", newline="", encoding="utf-8")
    writer   = csv.writer(csv_file)
    if write_header:
        writer.writerow(CSV_HEADER)

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        csv_file.close()
        raise RuntimeError("Cannot open webcam (device 0)")
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

    # macOS needs a brief warmup — drain the first few frames before the
    # AVFoundation pipeline delivers live video.
    for _ in range(5):
        cap.read()

    collected       = 0
    countdown_done  = False
    countdown_start: float | None = None
    last_capture_t  = 0.0

    print(f"\nBabelSign collector — sign: '{sign}'  target: {num_samples}")
    print("Press Q at any time to quit early.\n")

    with MediaPipeExtractor() as extractor:
        while True:
            ret, frame = cap.read()
            if not ret:
                print("ERROR: webcam frame read failed")
                break

            frame = cv2.flip(frame, 1)

            # extract_landmarks returns (norm, annotated_frame, hand_label)
            norm, annotated, _ = extractor.extract_landmarks(frame)

            # ── Countdown phase ───────────────────────────────────────────
            if not countdown_done:
                if countdown_start is None:
                    countdown_start = time.time()
                elapsed   = time.time() - countdown_start
                remaining = max(1, COUNTDOWN_SECONDS - int(elapsed))
                if elapsed >= COUNTDOWN_SECONDS:
                    countdown_done = True
                else:
                    annotated = draw_countdown(annotated, remaining)
                cv2.imshow("BabelSign — Data Collection", annotated)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
                continue

            # ── Capture phase ─────────────────────────────────────────────
            draw_hud(annotated, sign, collected, num_samples)

            if norm is not None:
                now = time.time()
                if now - last_capture_t >= CAPTURE_INTERVAL_S:
                    writer.writerow([sign] + norm)
                    csv_file.flush()
                    last_capture_t = now
                    collected += 1
                    print(f"Collected {collected}/{num_samples} samples for sign {sign}")

                    if collected >= num_samples:
                        h, w = annotated.shape[:2]
                        cv2.putText(annotated, "DONE!", (w // 2 - 140, h // 2),
                                    cv2.FONT_HERSHEY_SIMPLEX, 4.5, (0, 255, 80), 10, cv2.LINE_AA)
                        cv2.putText(annotated, "Run next sign or press Q to quit",
                                    (w // 2 - 280, h // 2 + 80),
                                    cv2.FONT_HERSHEY_SIMPLEX, 1.1, (255, 255, 255), 3, cv2.LINE_AA)
                        cv2.imshow("BabelSign — Data Collection", annotated)
                        cv2.waitKey(2000)
                        print("\nDone! Run next sign or press Q to quit")
                        break

            cv2.imshow("BabelSign — Data Collection", annotated)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

    csv_file.close()
    cap.release()
    cv2.destroyAllWindows()

    if collected < num_samples:
        print(f"\nWarning: only {collected}/{num_samples} samples collected for '{sign}'")
    else:
        print(f"\nSuccess: {collected} samples saved to {CSV_PATH}")


# ── Entry point ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="BabelSign ASL landmark data collector")
    parser.add_argument("--sign",    required=True,
                        help="Label for this sign (e.g. A, B, HELP, SPACE, DELETE)")
    parser.add_argument("--samples", type=int, default=50,
                        help="Number of samples to collect (default: 50)")
    args = parser.parse_args()

    if args.samples < 1:
        print("--samples must be at least 1")
        sys.exit(1)

    collect(args.sign.upper(), args.samples)
