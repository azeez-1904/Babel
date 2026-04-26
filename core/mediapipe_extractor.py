"""
core/mediapipe_extractor.py
MediaPipe hand landmark extraction using the Tasks API (mediapipe >= 0.10.x).

Note on API version:
  mediapipe >= 0.10 removed mp.solutions in favour of the Tasks API.
  This file uses HandLandmarker from mediapipe.tasks.python.vision.
  The model file (hand_landmarker.task) is downloaded automatically on first run.

IMPORTANT — normalisation contract:
  normalise_landmarks() below is a verbatim copy of the function in
  data_collection/collect_data.py. Any change to normalisation MUST be applied
  to BOTH files simultaneously. A drift between train-time and inference-time
  normalisation is a silent model failure.

Normalisation steps (must match collect_data.py exactly):
  1. Translate: subtract wrist (landmark 0) so wrist = origin.
  2. Scale:     divide all coordinates by ||landmark_9|| (wrist→middle-MCP distance).
  3. Flatten:   [x0,y0,z0, x1,y1,z1, ..., x20,y20,z20] → 63 floats.
"""

from __future__ import annotations

import urllib.request
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import vision as mp_vision
from mediapipe.tasks.python.core import base_options as mp_base_options
from mediapipe.tasks.python.vision.hand_landmarker import HandLandmarksConnections

# ── Model file ───────────────────────────────────────────────────────────────
MODEL_DIR  = Path(__file__).parent.parent / "model"
MODEL_PATH = MODEL_DIR / "hand_landmarker.task"
MODEL_URL  = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/1/hand_landmarker.task"
)

HAND_CONNECTIONS = HandLandmarksConnections.HAND_CONNECTIONS

# ── Landmark indices ─────────────────────────────────────────────────────────
WRIST_IDX      = 0
MIDDLE_MCP_IDX = 9    # scale reference: wrist → middle-finger MCP
FINGERTIPS     = {4, 8, 12, 16, 20}

# ── Colour scheme (BGR) ──────────────────────────────────────────────────────
COLOR_FINGERTIP  = (0,   80, 255)   # vivid red-orange
COLOR_JOINT      = (0,  220,  80)   # green
COLOR_WRIST      = (255, 180,   0)  # cyan
COLOR_CONNECTION = (180, 180, 180)  # light grey
COLOR_INDEX_TEXT = (200, 200, 200)  # dim white


def _ensure_model() -> str:
    """Download hand_landmarker.task if not present. Returns the local path string."""
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    if not MODEL_PATH.exists():
        print(f"Downloading MediaPipe hand landmarker model → {MODEL_PATH} …")
        urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
        print("Download complete.")
    return str(MODEL_PATH)


def normalise_landmarks(landmarks: list) -> list[float] | None:
    """
    Canonical normalisation — must stay in sync with collect_data.py.

    `landmarks` is a list of NormalizedLandmark objects (each has .x, .y, .z).

    Returns 63 normalised floats, or None if the scale reference is degenerate
    (e.g. hand so close to camera that wrist and middle-MCP overlap at sub-pixel).
    """
    pts = np.array([[lm.x, lm.y, lm.z] for lm in landmarks], dtype=np.float32)
    pts -= pts[WRIST_IDX]
    scale = np.linalg.norm(pts[MIDDLE_MCP_IDX])
    if scale < 1e-6:
        return None
    pts /= scale
    return pts.flatten().tolist()


def draw_skeleton(frame: np.ndarray, landmarks: list, hand_id: int = 0) -> None:
    """
    Draw the full 21-point skeleton on `frame` (in-place).

    Args:
        frame:     BGR image.
        landmarks: list of NormalizedLandmark (each has .x, .y, .z in [0,1]).
        hand_id:   offsets label positions so two-hand overlays don't collide.
    """
    h, w = frame.shape[:2]

    # Connections
    for conn in HAND_CONNECTIONS:
        a = landmarks[conn.start]
        b = landmarks[conn.end]
        ax, ay = int(a.x * w), int(a.y * h)
        bx, by = int(b.x * w), int(b.y * h)
        cv2.line(frame, (ax, ay), (bx, by), COLOR_CONNECTION, 2, cv2.LINE_AA)

    # Landmark dots + index labels
    for idx, lm in enumerate(landmarks):
        px, py = int(lm.x * w), int(lm.y * h)

        if idx == WRIST_IDX:
            color, radius = COLOR_WRIST, 7
        elif idx in FINGERTIPS:
            color, radius = COLOR_FINGERTIP, 6
        else:
            color, radius = COLOR_JOINT, 4

        cv2.circle(frame, (px, py), radius, color, -1, cv2.LINE_AA)
        cv2.putText(
            frame, str(idx),
            (px + 6 + hand_id * 2, py - 4),
            cv2.FONT_HERSHEY_PLAIN, 0.65,
            COLOR_INDEX_TEXT, 1, cv2.LINE_AA,
        )


class MediaPipeExtractor:
    """
    Wraps the MediaPipe HandLandmarker Tasks API for single-hand extraction.
    Create once, reuse across frames (initialisation is slow).
    """

    def __init__(
        self,
        max_num_hands: int = 1,
        min_detection_confidence: float = 0.7,
        min_tracking_confidence: float = 0.5,
    ) -> None:
        model_path = _ensure_model()
        options = mp_vision.HandLandmarkerOptions(
            base_options=mp_base_options.BaseOptions(model_asset_path=model_path),
            num_hands=max_num_hands,
            min_hand_detection_confidence=min_detection_confidence,
            min_hand_presence_confidence=min_tracking_confidence,
            min_tracking_confidence=min_tracking_confidence,
            running_mode=mp_vision.RunningMode.IMAGE,
        )
        self._landmarker = mp_vision.HandLandmarker.create_from_options(options)

    def extract_landmarks(
        self,
        frame: np.ndarray,
    ) -> tuple[list[float] | None, np.ndarray, str | None]:
        """
        Process a BGR frame and return landmark data.

        Returns:
            (normalized_array, annotated_frame, hand_label)
            - normalized_array: 63 floats (same normalisation as training), or None.
            - annotated_frame:  frame with full skeleton drawn (always returned).
            - hand_label:       "left" | "right", or None if no hand detected.
        """
        rgb     = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_img  = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result  = self._landmarker.detect(mp_img)
        annotated = frame.copy()

        if not result.hand_landmarks:
            return None, annotated, None

        landmarks  = result.hand_landmarks[0]        # first hand
        handedness = result.handedness[0][0].category_name.lower()  # "left"/"right"

        draw_skeleton(annotated, landmarks, hand_id=0)

        norm = normalise_landmarks(landmarks)
        return norm, annotated, handedness

    def close(self) -> None:
        self._landmarker.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
