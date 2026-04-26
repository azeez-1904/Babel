"""
api/gesture_service.py
Minimal FastAPI microservice — model inference only.

The TypeScript server handles stability buffering, word building, and
Claude disambiguation. This service just wraps the Random Forest.

Run:
  uvicorn api.gesture_service:app --port 8001 --reload
"""

from pathlib import Path

import joblib
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

ROOT       = Path(__file__).parent.parent
MODEL_PATH = ROOT / "model" / "gesture_classifier.pkl"
ENC_PATH   = ROOT / "model" / "label_encoder.pkl"

app = FastAPI(title="BabelSign Gesture Service")
app.add_middleware(CORSMiddleware, allow_origins=["*"])


# Load model once at startup
@app.on_event("startup")
def load_model() -> None:
    if not MODEL_PATH.exists():
        raise RuntimeError(
            f"Model not found at {MODEL_PATH}. "
            "Run: python3 model/train_classifier.py"
        )
    app.state.clf = joblib.load(MODEL_PATH)
    app.state.le  = joblib.load(ENC_PATH)
    print(f"Loaded model — {len(app.state.le.classes_)} classes: {list(app.state.le.classes_)}")


class PredictRequest(BaseModel):
    landmarks: list[float]   # 63 floats: [x0,y0,z0, ..., x20,y20,z20]


class Prediction(BaseModel):
    letter: str
    confidence: float


class PredictResponse(BaseModel):
    predictions: list[Prediction]


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest) -> PredictResponse:
    if len(req.landmarks) != 63:
        raise HTTPException(400, f"Expected 63 landmarks, got {len(req.landmarks)}")

    arr   = np.array(req.landmarks, dtype=np.float32).reshape(1, -1)
    proba = app.state.clf.predict_proba(arr)[0]
    top3  = np.argsort(proba)[::-1][:3]

    return PredictResponse(predictions=[
        Prediction(letter=str(app.state.le.classes_[i]), confidence=float(proba[i]))
        for i in top3
    ])


@app.get("/health")
def health() -> dict:
    classes = list(app.state.le.classes_) if hasattr(app.state, "le") else []
    return {"ok": True, "classes": len(classes)}
