// M02 + M03: step through the clip, run pose on every sampled frame and track the camera.
// Output is the RawTrack the analysis core takes.

import type { RawTrack } from '../types';
import { seekTo, frameTime, clampTime } from '../media';
import { CameraTracker } from '../camera';
import type { Landmark, PoseLandmarker } from '.';

export interface ExtractOptions {
  video: HTMLVideoElement;
  landmarker: PoseLandmarker;
  t0: number; t1: number; fps: number;
  camera: boolean;
  /** Called after every frame (for the live preview and progress bar). */
  onFrame?: (i: number, N: number, found: number, lm: Landmark[] | null) => void;
}

let ts = 0; // MediaPipe needs increasing timestamps

export async function extractTrack(o: ExtractOptions): Promise<{ raw: RawTrack; found: number }> {
  const { video, landmarker, fps } = o, vw = video.videoWidth, vh = video.videoHeight;
  let t0 = Math.max(0, o.t0 || 0), t1 = Math.min(video.duration, o.t1 || video.duration);
  if (t1 - t0 < 1) { t0 = 0; t1 = video.duration; }
  const N = Math.max(2, Math.floor((t1 - t0) * fps));
  const X = new Float32Array(33 * N).fill(NaN), Y = new Float32Array(33 * N).fill(NaN), V = new Float32Array(33 * N).fill(0);
  const OX = new Float32Array(N), OY = new Float32Array(N);
  const cam = o.camera ? new CameraTracker(vw, vh) : null;
  let found = 0;
  for (let i = 0; i < N; i++) {
    await seekTo(video, clampTime(video, frameTime(t0, i, fps)));
    if (i === 1 && Math.abs(video.currentTime - frameTime(t0, 1, fps)) > 0.5)
      throw new Error('this video source cannot seek (if it is a URL, the server must support range requests) — download it and open the file instead');
    ts += Math.round(1000 / fps);
    let r: ReturnType<PoseLandmarker['detectForVideo']> = undefined;
    try { r = landmarker.detectForVideo(video, ts); } catch (e) { console.warn(e); }
    const lm = r?.landmarks?.[0] ?? null;
    if (lm) { found++; for (let k = 0; k < 33; k++) { X[k * N + i] = lm[k].x * vw; Y[k * N + i] = lm[k].y * vh; V[k * N + i] = lm[k].visibility ?? 1; } }
    if (cam) [OX[i], OY[i]] = cam.push(video, lm);
    o.onFrame?.(i, N, found, lm);
  }
  return { raw: { N, fps, vw, vh, X, Y, V, OX, OY, t0, t1: t0 + N / fps }, found };
}
