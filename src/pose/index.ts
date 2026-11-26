// M02 pose — MediaPipe Pose Landmarker, loaded from the CDN on first use.

import { MODEL_URL, MP_URL, WASM_URL, POSE_OPTIONS, type ModelKind, type Landmark } from './config';
export { MODEL_URL, MP_VER, type ModelKind, type Landmark } from './config';

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
    baseOptions: { modelAssetPath: MODEL_URL[kind], delegate }, ...POSE_OPTIONS,
  });
  try { current = await make('GPU'); } catch { current = await make('CPU'); }
  return current;
}
