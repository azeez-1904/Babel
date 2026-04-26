"""
data_collection/load_kaggle_data.py
Build landmarks.csv from the Kaggle ASL Fingerspelling 2023 parquet files.

Parquet structure (discovered empirically):
  - Index name : sequence_id  (int64)
  - Each row   : one video frame for that sequence
  - Columns    : frame, x_face_0…x_face_467, x_left_hand_0…x_left_hand_20,
                 y_left_hand_0…y_left_hand_20, z_left_hand_0…z_left_hand_20,
                 (same for right_hand), x_pose_0… etc.
  - Landmark coordinates are raw image coordinates, NOT normalised to [0,1].
    Our normalise_landmarks() removes scale and position anyway, so this is fine.

Usage:
  python data_collection/load_kaggle_data.py \\
      --data_dir  data/kaggle/train_landmarks \\
      --meta_path data/kaggle/train.csv \\
      --max_samples_per_sign 300
"""

from __future__ import annotations

import argparse
import csv
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from core.mediapipe_extractor import normalise_landmarks

DATA_DIR   = ROOT / "data"
CSV_PATH   = DATA_DIR / "landmarks.csv"
CSV_HEADER = ["label"] + [f"{c}{i}" for i in range(21) for c in ("x", "y", "z")]

VALID_CHARS: dict[str, str] = {c: c for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"}
VALID_CHARS[" "] = "SPACE"

# Build column lists once
RIGHT_X = [f"x_right_hand_{i}" for i in range(21)]
RIGHT_Y = [f"y_right_hand_{i}" for i in range(21)]
RIGHT_Z = [f"z_right_hand_{i}" for i in range(21)]
LEFT_X  = [f"x_left_hand_{i}"  for i in range(21)]
LEFT_Y  = [f"y_left_hand_{i}"  for i in range(21)]
LEFT_Z  = [f"z_left_hand_{i}"  for i in range(21)]
ALL_RIGHT = RIGHT_X + RIGHT_Y + RIGHT_Z
ALL_LEFT  = LEFT_X  + LEFT_Y  + LEFT_Z


class _LM:
    """Minimal landmark object matching the .x/.y/.z interface expected by normalise_landmarks."""
    __slots__ = ("x", "y", "z")
    def __init__(self, x: float, y: float, z: float):
        self.x = float(x); self.y = float(y); self.z = float(z)


def _extract_frame(seg: pd.DataFrame, pos: int, side: str) -> list[float] | None:
    """Extract and normalise landmarks from a single frame at position `pos`."""
    if side == "right":
        x_cols, y_cols, z_cols = RIGHT_X, RIGHT_Y, RIGHT_Z
    else:
        x_cols, y_cols, z_cols = LEFT_X, LEFT_Y, LEFT_Z

    x_cols = [c for c in x_cols if c in seg.columns]
    y_cols = [c for c in y_cols if c in seg.columns]
    z_cols = [c for c in z_cols if c in seg.columns]
    if len(x_cols) < 21:
        return None

    row = seg.iloc[pos]
    xs = row[x_cols].values.astype(float)
    ys = row[y_cols].values.astype(float)
    zs = row[z_cols].values.astype(float)
    if np.isnan(xs).any() or np.isnan(ys).any() or np.isnan(zs).any():
        return None

    landmarks = [_LM(xs[i], ys[i], zs[i]) for i in range(21)]
    return normalise_landmarks(landmarks)


def _best_frame_for_segment(seg: pd.DataFrame, side: str) -> list[float] | None:
    """
    Pick the most stable frame from a segment.
    Strategy: try the middle third of the segment (most stable part of a sign),
    then fall back to first/last third. Transition frames at segment edges are
    skipped. Returns None only if no clean frame exists anywhere in the segment.
    """
    n = len(seg)
    if n == 0:
        return None

    # Try middle third first, then full segment from center outward
    mid = n // 2
    search_order = [mid]
    for delta in range(1, n):
        if mid - delta >= 0:
            search_order.append(mid - delta)
        if mid + delta < n:
            search_order.append(mid + delta)

    for pos in search_order:
        norm = _extract_frame(seg, pos, side)
        if norm is not None:
            return norm
    return None


def process_parquet(
    path: Path,
    seq_to_phrase: dict,
    cap: dict[str, int],
    samples: dict[str, list],
) -> tuple[int, int]:
    """
    Process one parquet file. Returns (accepted, skipped) counts.
    The parquet index IS the sequence_id — group by index to get per-sequence frames.
    """
    try:
        df = pd.read_parquet(path)
    except Exception as e:
        print(f"  Could not read {path.name}: {e}")
        return 0, 0

    accepted = skipped = 0

    for seq_id, seq_df in df.groupby(level=0):
        phrase = seq_to_phrase.get(seq_id) or seq_to_phrase.get(str(seq_id))
        if not phrase:
            continue

        phrase = str(phrase).upper()
        n_frames = len(seq_df)
        n_chars  = len(phrase)
        if n_frames < n_chars:
            skipped += n_chars
            continue

        seg_size = max(1, n_frames // n_chars)

        for char_idx, char in enumerate(phrase):
            label = VALID_CHARS.get(char)
            if label is None:
                continue
            if len(samples[label]) >= cap.get(label, 9999):
                continue

            seg_start = char_idx * seg_size
            seg_end   = seg_start + seg_size if char_idx < n_chars - 1 else n_frames
            seg       = seq_df.iloc[seg_start:seg_end]

            # Sample up to 3 frames per character: 25%, 50%, 75% of segment
            # This gives training diversity while staying in the stable center.
            n_seg = len(seg)
            positions = sorted(set([
                max(0, n_seg // 4),
                max(0, n_seg // 2),
                max(0, 3 * n_seg // 4),
            ]))

            for pos in positions:
                if len(samples[label]) >= cap.get(label, 9999):
                    break
                side = "right"
                norm = _extract_frame(seg, pos, side)
                if norm is None:
                    side = "left"
                    norm = _extract_frame(seg, pos, side)
                if norm is None:
                    skipped += 1
                    continue
                samples[label].append(norm)
                accepted += 1

    return accepted, skipped


def load(data_dir: Path, meta_path: Path, max_samples: int, output: Path) -> None:
    print(f"\n{'='*60}")
    print(f"  BabelSign — Kaggle Landmark Loader")
    print(f"{'='*60}")
    print(f"  data_dir  : {data_dir}")
    print(f"  meta_path : {meta_path}")
    print(f"  max/sign  : {max_samples}")
    print(f"  output    : {output}")
    print()

    if not meta_path.exists():
        print(f"ERROR: {meta_path} not found.")
        sys.exit(1)

    meta = pd.read_csv(meta_path)
    meta.columns = [c.lower() for c in meta.columns]
    seq_to_phrase: dict = dict(zip(meta["sequence_id"], meta["phrase"]))
    print(f"Loaded metadata: {len(seq_to_phrase):,} sequences")

    parquet_files = sorted(data_dir.rglob("*.parquet"))
    if not parquet_files:
        print(f"ERROR: no .parquet files found under {data_dir}")
        sys.exit(1)
    print(f"Parquet files  : {len(parquet_files)}")

    samples: dict[str, list] = defaultdict(list)
    cap    = {lbl: max_samples for lbl in VALID_CHARS.values()}
    total_accepted = total_skipped = 0
    t0 = time.time()

    for i, pf in enumerate(parquet_files, 1):
        acc, skip = process_parquet(pf, seq_to_phrase, cap, samples)
        total_accepted += acc
        total_skipped  += skip
        filled = sum(1 for v in samples.values() if len(v) >= max_samples)
        print(f"  [{i}/{len(parquet_files)}] {pf.name}  "
              f"accepted={total_accepted}  signs_full={filled}/{len(VALID_CHARS)}  "
              f"elapsed={time.time()-t0:.0f}s")

        if all(len(samples.get(l, [])) >= max_samples for l in VALID_CHARS.values()):
            print("  All signs at cap — stopping early.")
            break

    # Write CSV
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    written = 0
    with open(output, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(CSV_HEADER)
        for label, rows in sorted(samples.items()):
            for norm in rows:
                writer.writerow([label] + norm)
                written += 1

    print(f"\n{'='*60}")
    print(f"  Done  —  {written} rows written  |  {total_skipped} frames skipped")
    print(f"{'='*60}")
    print()
    print("  Samples per sign:")
    for label, rows in sorted(samples.items()):
        bar = "█" * min(20, len(rows) * 20 // max(max_samples, 1))
        flag = " ⚠ low" if len(rows) < 30 else ""
        print(f"    {label:12s} {len(rows):4d}  {bar}{flag}")
    print()
    print("Next steps:")
    print("  python3 data_collection/verify_data.py")
    print("  python3 model/train_classifier.py")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data_dir",  default="data/kaggle/train_landmarks")
    parser.add_argument("--meta_path", default="data/kaggle/train.csv")
    parser.add_argument("--max_samples_per_sign", type=int, default=300)
    parser.add_argument("--output",    default=str(CSV_PATH))
    args = parser.parse_args()

    load(
        data_dir  = Path(args.data_dir),
        meta_path = Path(args.meta_path),
        max_samples = args.max_samples_per_sign,
        output    = Path(args.output),
    )
