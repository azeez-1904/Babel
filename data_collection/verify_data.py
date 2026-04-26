"""
BabelSign Data Verifier
Run before training to catch collection errors.

Checks:
  - Sample counts per sign (flags < MIN_SAMPLES)
  - No NaN values
  - Correct column count (1 label + 63 floats)
  - Plots average hand skeleton per sign for visual sanity check
"""

import math
import sys
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

# ── Paths ──────────────────────────────────────────────────────────────────
ROOT     = Path(__file__).parent.parent
CSV_PATH = ROOT / "data" / "landmarks.csv"

MIN_SAMPLES    = 30
EXPECTED_COLS  = 1 + 63   # label + (x,y,z) × 21 landmarks

# MediaPipe HAND_CONNECTIONS as index pairs — defined locally so this script
# runs without a display/camera/mediapipe import (fast CI check).
HAND_CONNECTIONS = [
    (0, 1),  (1, 2),  (2, 3),  (3, 4),         # Thumb
    (0, 5),  (5, 6),  (6, 7),  (7, 8),          # Index finger
    (5, 9),  (9, 10), (10, 11), (11, 12),        # Middle finger
    (9, 13), (13, 14), (14, 15), (15, 16),       # Ring finger
    (13, 17), (17, 18), (18, 19), (19, 20),      # Pinky
    (0, 17),                                      # Palm base
]

# Column names — must match collect_data.py exactly
COORD_COLS = [f"{c}{i}" for i in range(21) for c in ("x", "y", "z")]


# ── Checks ─────────────────────────────────────────────────────────────────
def load_csv() -> pd.DataFrame:
    if not CSV_PATH.exists():
        print(f"ERROR: {CSV_PATH} not found. Run collect_data.py first.")
        sys.exit(1)
    df = pd.read_csv(CSV_PATH)
    return df


def check_integrity(df: pd.DataFrame) -> bool:
    print("=" * 56)
    print("INTEGRITY CHECK")
    print("=" * 56)
    ok = True

    # Column count
    ncols = len(df.columns)
    status = "OK" if ncols == EXPECTED_COLS else f"FAIL — expected {EXPECTED_COLS}"
    print(f"  Columns        : {ncols:4d}   [{status}]")
    if ncols != EXPECTED_COLS:
        ok = False

    # NaN check
    nan_total = int(df.isnull().sum().sum())
    status = "OK" if nan_total == 0 else f"FAIL — {nan_total} NaN values found"
    print(f"  NaN values     : {nan_total:4d}   [{status}]")
    if nan_total > 0:
        ok = False

    # Total rows
    print(f"  Total rows     : {len(df):4d}")
    print()
    return ok


def check_samples(df: pd.DataFrame) -> pd.Series:
    print("=" * 56)
    print("SAMPLE COUNTS PER SIGN")
    print("=" * 56)
    counts = df["label"].value_counts().sort_index()

    low_signs = []
    for sign, count in counts.items():
        flag = "   OK" if count >= MIN_SAMPLES else f"   !! below {MIN_SAMPLES} minimum"
        print(f"  {str(sign):12s}: {count:4d} samples{flag}")
        if count < MIN_SAMPLES:
            low_signs.append(sign)

    print(f"\n  Total rows : {len(df)}")
    print(f"  Unique signs: {len(counts)}")
    if low_signs:
        print(f"\n  Signs needing more data: {', '.join(str(s) for s in low_signs)}")
        print(f"  Re-run: python collect_data.py --sign <X> --samples 50")
    else:
        print(f"\n  All signs have >= {MIN_SAMPLES} samples — ready to train!")
    print()
    return counts


# ── Skeleton plot ───────────────────────────────────────────────────────────
def plot_average_skeletons(df: pd.DataFrame) -> None:
    """
    For each sign, compute the mean of all sample landmark positions and
    render as a hand skeleton. Visually confirms that signs are distinct
    and that normalisation is working (wrist should cluster near origin).
    """
    labels  = sorted(df["label"].astype(str).unique())
    n       = len(labels)
    ncols   = min(6, n)
    nrows   = math.ceil(n / ncols)

    fig, axes = plt.subplots(nrows, ncols,
                             figsize=(ncols * 2.8, nrows * 3.0),
                             squeeze=False)
    axes_flat = axes.flatten()

    for ax, label in zip(axes_flat, labels):
        subset = df[df["label"].astype(str) == label][COORD_COLS].values
        avg    = subset.mean(axis=0)          # (63,)
        pts    = avg.reshape(21, 3)           # (21, 3)  — [x, y, z] per landmark

        # Draw connections — flip y because MediaPipe origin is top-left
        for a, b in HAND_CONNECTIONS:
            ax.plot([pts[a, 0], pts[b, 0]],
                    [-pts[a, 1], -pts[b, 1]],
                    color="#4a90e2", linewidth=1.8, alpha=0.8)

        # Fingertips (4,8,12,16,20) in accent colour, joints in neutral
        fingertips = {4, 8, 12, 16, 20}
        for i, pt in enumerate(pts):
            color  = "#e74c3c" if i in fingertips else "#f0c040"
            marker = "*"       if i in fingertips else "o"
            size   = 70        if i in fingertips else 30
            ax.scatter(pt[0], -pt[1], c=color, s=size,
                       marker=marker, zorder=5, edgecolors="none")

        # Wrist dot in a distinct colour
        ax.scatter(pts[0, 0], -pts[0, 1],
                   c="#2ecc71", s=50, zorder=6, edgecolors="none")

        ax.set_title(label, fontsize=11, fontweight="bold", pad=4)
        ax.set_aspect("equal")
        ax.axis("off")
        ax.text(0.5, -0.04, f"n={len(subset)}", transform=ax.transAxes,
                ha="center", fontsize=8, color="#888888")

    # Hide any empty axes
    for ax in axes_flat[n:]:
        ax.set_visible(False)

    fig.suptitle("Average Hand Skeleton Per Sign\n(wrist = green dot, fingertips = red)",
                 fontsize=13, fontweight="bold", y=1.01)
    plt.tight_layout()
    plt.show()


# ── Entry point ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    df = load_csv()
    integrity_ok = check_integrity(df)
    check_samples(df)

    if not integrity_ok:
        print("Fix integrity issues before plotting or training.\n")
        sys.exit(1)

    print("Plotting average skeletons — close the window to exit.\n")
    plot_average_skeletons(df)
