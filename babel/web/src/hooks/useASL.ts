import { useEffect, useRef, useState } from 'react';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// Capture a 320×240 JPEG from the video element.
// We un-mirror the image (cancel the CSS scaleX(-1)) so Claude sees the
// correct hand orientation rather than a reflected one.
function captureFrame(video: HTMLVideoElement): string {
  const canvas = document.createElement('canvas');
  canvas.width  = 320;
  canvas.height = 240;
  const ctx = canvas.getContext('2d')!;
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
  ctx.restore();
  return canvas.toDataURL('image/jpeg', 0.75).split(',')[1];
}

interface UseASLOptions {
  enabled:  boolean;
  sendWs:   (payload: object) => void;
}

export function useASL({ enabled, sendWs }: UseASLOptions) {
  const videoRef    = useRef<HTMLVideoElement | null>(null);
  const canvasRef   = useRef<HTMLCanvasElement | null>(null);
  const detectorRef = useRef<HandLandmarker | null>(null);
  const rafRef      = useRef<number>(0);
  const lastSentRef = useRef<number>(0);
  const [ready, setReady]   = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [handVisible, setHandVisible] = useState(false);

  // Load MediaPipe once — used only for hand presence detection (no landmarks needed)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm'
        );
        const hl = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 1,
        });
        if (!cancelled) { detectorRef.current = hl; setReady(true); }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Camera loop
  useEffect(() => {
    if (!enabled || !ready) {
      cancelAnimationFrame(rafRef.current);
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
        videoRef.current.srcObject = null;
      }
      setHandVisible(false);
      return;
    }

    let stream: MediaStream;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
        });
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const loop = () => {
          if (!enabled || !detectorRef.current || !video) return;
          const now = performance.now();

          // Run hand detection every frame for the skeleton overlay
          const result = detectorRef.current.detectForVideo(video, now);
          const lms    = result.landmarks[0];
          setHandVisible(!!lms);

          // Draw skeleton on canvas overlay
          const canvas = canvasRef.current;
          if (canvas) {
            canvas.width  = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d')!;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (lms) drawSkeleton(ctx, lms, canvas.width, canvas.height);
          }

          // Send a frame to Claude at most once per second, only when hand visible
          if (lms && now - lastSentRef.current >= 1000) {
            lastSentRef.current = now;
            const imageBase64 = captureFrame(video);
            sendWs({ type: 'asl_image', imageBase64 });
          }

          rafRef.current = requestAnimationFrame(loop);
        };

        rafRef.current = requestAnimationFrame(loop);
      } catch {
        setError('Camera access denied');
      }
    })();

    return () => {
      cancelAnimationFrame(rafRef.current);
      stream?.getTracks().forEach(t => t.stop());
    };
  }, [enabled, ready, sendWs]);

  return { videoRef, canvasRef, ready, error, handVisible };
}

// ── Skeleton drawing ──────────────────────────────────────────────────────────
const CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17],
];
const FINGERTIPS = new Set([4, 8, 12, 16, 20]);

function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  lms: { x: number; y: number; z: number }[],
  w: number, h: number,
) {
  ctx.strokeStyle = 'rgba(180,180,180,0.7)';
  ctx.lineWidth   = 2;
  for (const [a, b] of CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(lms[a].x * w, lms[a].y * h);
    ctx.lineTo(lms[b].x * w, lms[b].y * h);
    ctx.stroke();
  }
  for (let i = 0; i < lms.length; i++) {
    const x = lms[i].x * w, y = lms[i].y * h;
    ctx.beginPath();
    ctx.arc(x, y, FINGERTIPS.has(i) ? 6 : 4, 0, Math.PI * 2);
    ctx.fillStyle = i === 0 ? '#4ade80' : FINGERTIPS.has(i) ? '#f97316' : '#facc15';
    ctx.fill();
  }
}

// Keep Prediction export for ASLPanel compatibility
export interface Prediction { letter: string; confidence: number }
