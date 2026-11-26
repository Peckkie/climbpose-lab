// M02 pose — MediaPipe Pose Landmarker, loaded from the CDN on first use.

export const MP_VER = '0.10.14';
const MP_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/vision_bundle.mjs`;
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/wasm`;
export const MODEL_URL = {
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  heavy: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
} as const;
export type ModelKind = keyof typeof MODEL_URL;

export interface Landmark { x: number; y: number; z?: number; visibility?: number; }
export interface PoseLandmarker {
  detectForVideo(src: HTMLVideoElement, timestampMs: number): { landmarks?: Landmark[][] } | undefined;
  close(): void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mp: any = null, fileset: unknown = null, current: PoseLandmarker | null = null;

/** A fresh landmarker for every analysis: in VIDEO mode it keeps tracking the region from the last
 *  frame it saw, so reusing one would start a new clip from the old clip's position. */
export async function createLandmarker(kind: ModelKind): Promise<PoseLandmarker> {
  if (!mp) mp = await import(/* @vite-ignore */ MP_URL);
  if (!fileset) fileset = await mp.FilesetResolver.forVisionTasks(WASM_URL);
  if (current) { try { current.close(); } catch { /* already closed */ } current = null; }
  const make = (delegate: 'GPU' | 'CPU'): Promise<PoseLandmarker> => mp.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL[kind], delegate }, runningMode: 'VIDEO', numPoses: 1,
    minPoseDetectionConfidence: 0.4, minPosePresenceConfidence: 0.4, minTrackingConfidence: 0.5,
  });
  try { current = await make('GPU'); } catch { current = await make('CPU'); }
  return current;
}
