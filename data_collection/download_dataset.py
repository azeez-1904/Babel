"""
data_collection/download_dataset.py
Download a targeted subset of the Kaggle ASL Fingerspelling 2023 dataset
using Bearer-token auth (required for new KGAT_ API tokens).

Bypasses the kaggle CLI (which uses Basic auth and fails on KGAT_ tokens)
and hits the Kaggle REST API directly.

Usage:
  python data_collection/download_dataset.py
"""

from __future__ import annotations

import io
import json
import sys
import time
import zipfile
from collections import defaultdict
from pathlib import Path

import pandas as pd
import requests

ROOT     = Path(__file__).parent.parent
DATA_DIR = ROOT / "data" / "kaggle"
COMP     = "asl-fingerspelling"
BASE_URL = f"https://www.kaggle.com/api/v1/competitions/data/download/{COMP}"

# How many parquet files (file_ids) to download per target letter.
# Each parquet holds many sequences so ~15 files/letter gives plenty of samples.
FILES_PER_LETTER = 15
MAX_SAMPLES      = 500   # passed to load_kaggle_data.py


def get_headers() -> dict[str, str]:
    cred_path = Path.home() / ".kaggle" / "kaggle.json"
    if not cred_path.exists():
        print("ERROR: ~/.kaggle/kaggle.json not found.")
        sys.exit(1)
    key = json.loads(cred_path.read_text())["key"]
    return {"Authorization": f"Bearer {key}"}


def download_zip(url: str, headers: dict, dest_path: Path) -> Path:
    """Download a URL (possibly zip-wrapped) and save the first file inside."""
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    if dest_path.exists():
        return dest_path

    resp = requests.get(url, headers=headers, timeout=60, stream=True)
    resp.raise_for_status()

    ctype = resp.headers.get("Content-Type", "")
    raw   = resp.content

    if "zip" in ctype or raw[:2] == b"PK":
        z    = zipfile.ZipFile(io.BytesIO(raw))
        name = z.namelist()[0]
        dest_path.write_bytes(z.read(name))
    else:
        dest_path.write_bytes(raw)

    return dest_path


def download_metadata(headers: dict) -> pd.DataFrame:
    print("[1/4] Downloading train.csv …")
    csv_path = DATA_DIR / "train.csv"
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    if not csv_path.exists():
        url  = f"{BASE_URL}/train.csv"
        resp = requests.get(url, headers=headers, timeout=60)
        resp.raise_for_status()
        raw = resp.content
        if raw[:2] == b"PK":
            z = zipfile.ZipFile(io.BytesIO(raw))
            csv_path.write_bytes(z.read(z.namelist()[0]))
        else:
            csv_path.write_bytes(raw)
        print(f"  Saved → {csv_path}")
    else:
        print(f"  Already cached → {csv_path}")

    meta = pd.read_csv(csv_path)
    meta.columns = [c.lower() for c in meta.columns]
    print(f"  {len(meta):,} sequences  |  columns: {list(meta.columns)}")
    return meta


def select_file_ids(meta: pd.DataFrame) -> list[int]:
    """
    Pick file_ids whose sequences cover every letter A-Z and space.
    Selects up to FILES_PER_LETTER file_ids per target letter, deduped.
    """
    print("\n[2/4] Selecting targeted file_ids …")
    target = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ ")
    coverage: dict[str, set[int]] = defaultdict(set)

    for _, row in meta.iterrows():
        phrase  = str(row.get("phrase", "")).upper()
        file_id = int(row["file_id"])
        for ch in set(phrase):
            if ch in target and len(coverage[ch]) < FILES_PER_LETTER:
                coverage[ch].add(file_id)

    selected: set[int] = set()
    for fids in coverage.values():
        selected.update(fids)

    missing = [c for c in target if c != " " and not coverage.get(c)]
    if missing:
        print(f"  WARNING: no file_ids found for letters: {missing}")
    else:
        print(f"  All 27 targets covered  |  {len(selected)} unique parquet files")

    return sorted(selected)


def download_parquets(file_ids: list[int], headers: dict) -> Path:
    lm_dir = DATA_DIR / "train_landmarks"
    lm_dir.mkdir(parents=True, exist_ok=True)

    total   = len(file_ids)
    done    = 0
    skipped = 0
    failed  = 0
    t0      = time.time()

    print(f"\n[3/4] Downloading {total} parquet files …")

    for i, fid in enumerate(file_ids, 1):
        dest = lm_dir / f"{fid}.parquet"
        if dest.exists():
            skipped += 1
            continue

        url  = f"{BASE_URL}/train_landmarks/{fid}.parquet"
        try:
            resp = requests.get(url, headers=headers, timeout=120, stream=True)
            resp.raise_for_status()
            raw = resp.content
            # Parquet files come back as zip on Kaggle competition endpoints
            if raw[:2] == b"PK":
                z = zipfile.ZipFile(io.BytesIO(raw))
                dest.write_bytes(z.read(z.namelist()[0]))
            else:
                dest.write_bytes(raw)
            done += 1
        except Exception as e:
            failed += 1
            print(f"  SKIP {fid}: {e}")
            continue

        if i % 10 == 0 or i == total:
            elapsed = time.time() - t0
            rate    = (i - skipped) / max(elapsed, 1)
            eta     = (total - i) / max(rate, 0.01)
            size_mb = sum(p.stat().st_size for p in lm_dir.glob("*.parquet")) / 1e6
            print(f"  [{i:3d}/{total}]  downloaded={done}  cached={skipped}"
                  f"  failed={failed}  disk={size_mb:.0f}MB  ETA={eta/60:.1f}min")

    print(f"  Done — {done} downloaded, {skipped} cached, {failed} failed")
    return lm_dir


def run_loader(lm_dir: Path, meta_csv: Path) -> None:
    import subprocess
    print("\n[4/4] Building landmarks.csv …")
    subprocess.run(
        [
            sys.executable,
            str(ROOT / "data_collection" / "load_kaggle_data.py"),
            "--data_dir",  str(lm_dir),
            "--meta_path", str(meta_csv),
            "--max_samples_per_sign", str(MAX_SAMPLES),
        ],
        check=True,
    )


def main() -> None:
    print("=" * 60)
    print("  BabelSign — Kaggle Dataset Downloader")
    print(f"  {FILES_PER_LETTER} parquet files/letter  →  ~150-300 samples/letter")
    print("=" * 60)

    headers  = get_headers()
    meta     = download_metadata(headers)
    file_ids = select_file_ids(meta)
    lm_dir   = download_parquets(file_ids, headers)
    run_loader(lm_dir, DATA_DIR / "train.csv")

    print("\n" + "=" * 60)
    print("  Pipeline complete. Run:")
    print("    python3 data_collection/verify_data.py")
    print("    python3 model/train_classifier.py")
    print("    python3 core/gesture_recognizer.py")
    print("=" * 60)


if __name__ == "__main__":
    main()
