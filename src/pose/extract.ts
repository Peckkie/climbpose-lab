// M02 + M03: step through the clip, run pose on every sampled frame and track the camera.
// Output is the RawTrack the analysis core takes.
//
// Preferred: pose and camera tracking in two Web Workers (page stays responsive). The main thread
// only seeks and hands over frames. Pipelined: while the pose worker works on frame i+1, the camera
// worker tracks frame i with frame i's pose (to mask the climber), so the result is the same as
// running them one after the other. Fallbacks: camera in the pose worker (no camera worker), then
// everything on the main thread (no workers).

import type { RawTrack } from '../types';
import { seekTo, frameTime, clampTime } from '../media';
import { CameraTracker } from '../camera';
import { createLandmarker, type Landmark, type ModelKind } from '.';
import type { FromWorker, ToWorker } from './worker';
import type { FromCamera, ToCamera } from '../camera/worker';
import PoseWorker from './worker?worker&inline';
import CameraWorker from '../camera/worker?worker&inline';

export interface ExtractOptions {
  video: HTMLVideoElement;
  model: ModelKind;
  t0: number; t1: number; fps: number;
  camera: boolean;
  signal?: AbortSignal;
  /** Called after every frame (for the live preview and progress bar). */
  onFrame?: (i: number, N: number, found: number, lm: Landmark[] | null) => void;
  /** 'worker' | 'main' once known. */
  onMode?: (mode: string) => void;
}

export class Cancelled extends Error { constructor() { super('cancelled'); } }

let ts = 0; // MediaPipe needs increasing timestamps

interface Track { N: number; t0: number; vw: number; vh: number; X: Float32Array; Y: Float32Array; V: Float32Array; OX: Float32Array; OY: Float32Array; CA: Float32Array; CB: Float32Array; found: number; }

function setup(o: ExtractOptions): Track {
  const { video, fps } = o, vw = video.videoWidth, vh = video.videoHeight;
  let t0 = Math.max(0, o.t0 || 0), t1 = Math.min(video.duration, o.t1 || video.duration);
  if (t1 - t0 < 1) { t0 = 0; t1 = video.duration; }
  const N = Math.max(2, Math.floor((t1 - t0) * fps));
  return { N, t0, vw, vh, X: new Float32Array(33 * N).fill(NaN), Y: new Float32Array(33 * N).fill(NaN), V: new Float32Array(33 * N).fill(0), OX: new Float32Array(N), OY: new Float32Array(N), CA: new Float32Array(N).fill(1), CB: new Float32Array(N), found: 0 };
}

function finish(T: Track, o: ExtractOptions): { raw: RawTrack; found: number } {
  const raw: RawTrack = { N: T.N, fps: o.fps, vw: T.vw, vh: T.vh, X: T.X, Y: T.Y, V: T.V, OX: T.OX, OY: T.OY, t0: T.t0, t1: T.t0 + T.N / o.fps };
  if (o.camera) { raw.CA = T.CA; raw.CB = T.CB; }
  return { raw, found: T.found };
}

async function seekFrame(video: HTMLVideoElement, T: Track, fps: number, i: number): Promise<void> {
  await seekTo(video, clampTime(video, frameTime(T.t0, i, fps)));
  if (i === 1 && Math.abs(video.currentTime - frameTime(T.t0, 1, fps)) > 0.5)
    throw new Error('this video source cannot seek (if it is a URL, the server must support range requests) — download it and open the file instead');
}

function store(T: Track, i: number, lm: Landmark[] | null): void {
  if (!lm) return;
  T.found++;
  for (let k = 0; k < 33; k++) { T.X[k * T.N + i] = lm[k].x * T.vw; T.Y[k * T.N + i] = lm[k].y * T.vh; T.V[k * T.N + i] = lm[k].visibility ?? 1; }
}

// One worker for the page: MediaPipe and its wasm load once; each analysis only makes a fresh
// landmarker (init), so tracking never carries over from the previous clip.
let shared: Worker | null = null;

export async function extractTrack(o: ExtractOptions): Promise<{ raw: RawTrack; found: number }> {
  let cam: Worker | null = null;
  if (o.camera) { try { cam = await startCamera(o); } catch (e) { console.warn('camera worker unavailable, tracking in the pose worker:', e); } }
  let worker: Worker | null = null;
  try { worker = await startWorker(o, o.camera && !cam); } catch (e) {
    cam?.terminate();
    if (e instanceof Cancelled) throw e;
    console.warn('pose worker unavailable, running on the main thread:', e);
  }
  if (o.signal?.aborted) { cam?.terminate(); dropWorker(); throw new Cancelled(); }
  if (!worker) { o.onMode?.('main'); return extractMain(o); }
  o.onMode?.(cam ? 'workers' : 'worker');
  try { return await extractWorker(o, worker, cam); }
  catch (e) { dropWorker(); throw e; } // cancelled or failed mid-way: start clean next time
  finally { cam?.terminate(); }
}

/** A fresh camera tracker in its own worker (cheap to start, so one per analysis). */
function startCamera(o: ExtractOptions): Promise<Worker> {
  return new Promise((res, rej) => {
    let w: Worker;
    try { w = new CameraWorker(); } catch (e) { rej(e); return; }
    const timer = setTimeout(() => { w.terminate(); rej(new Error('camera worker did not start')); }, 10000);
    w.onmessage = (e: MessageEvent<FromCamera>) => { clearTimeout(timer); if (e.data.type === 'ready') res(w); else { w.terminate(); rej(new Error(e.data.type === 'error' ? e.data.message : 'unexpected reply')); } };
    w.onerror = (e) => { clearTimeout(timer); w.terminate(); rej(new Error(e.message || 'camera worker failed')); };
    w.postMessage({ type: 'init', vw: o.video.videoWidth, vh: o.video.videoHeight } satisfies ToCamera);
  });
}

function dropWorker(): void { if (shared) { shared.terminate(); shared = null; } }

/** Load a fresh model in the (shared) worker; rejects (→ fallback) if that fails or takes > 90 s. */
function startWorker(o: ExtractOptions, camera: boolean): Promise<Worker> {
  return new Promise((res, rej) => {
    let w: Worker;
    try { w = shared ?? new PoseWorker(); shared = w; } catch (e) { rej(e); return; }
    const fail = (err: Error) => { clearTimeout(timer); o.signal?.removeEventListener('abort', onAbort); dropWorker(); rej(err); };
    const timer = setTimeout(() => fail(new Error('model load timed out')), 90000);
    const onAbort = () => fail(new Cancelled());
    o.signal?.addEventListener('abort', onAbort, { once: true });
    w.onmessage = (e: MessageEvent<FromWorker>) => {
      if (e.data.type === 'ready') {
        clearTimeout(timer); o.signal?.removeEventListener('abort', onAbort);
        console.info(`pose model ready in a worker (${e.data.delegate})`); res(w);
      } else fail(new Error(e.data.type === 'error' ? e.data.message : 'unexpected reply'));
    };
    w.onerror = (e) => fail(new Error(e.message || 'worker failed'));
    const msg: ToWorker = { type: 'init', kind: o.model, camera, vw: o.video.videoWidth, vh: o.video.videoHeight };
    w.postMessage(msg);
  });
}

const IN_FLIGHT = 3; // frames handed over but not finished

async function extractWorker(o: ExtractOptions, w: Worker, camW: Worker | null): Promise<{ raw: RawTrack; found: number }> {
  const { video, fps } = o, T = setup(o), N = T.N;
  type PoseRes = FromWorker & { type: 'result' };
  const poseWait = new Map<number, (r: PoseRes) => void>(), camWait = new Map<number, (c: [number, number, number, number]) => void>();
  // a worker error or a cancel ends any wait (otherwise a lost reply would hang the analysis)
  let failure: Error | null = null, stop: (e: Error) => void = () => {};
  const stopped = new Promise<never>((_, rej) => { stop = rej; });
  stopped.catch(() => { /* handled where awaited */ });
  const fail = (e: Error) => { if (!failure) { failure = e; stop(e); } };
  o.signal?.addEventListener('abort', () => fail(new Cancelled()), { once: true });
  w.onmessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    if (m.type === 'result') { poseWait.get(m.i)?.(m); poseWait.delete(m.i); }
    else if (m.type === 'error') fail(new Error(m.message));
  };
  w.onerror = (e) => fail(new Error(e.message || 'pose worker failed'));
  if (camW) {
    camW.onmessage = (e: MessageEvent<FromCamera>) => {
      const m = e.data;
      if (m.type === 'result') { camWait.get(m.i)?.(m.cam); camWait.delete(m.i); }
      else if (m.type === 'error') fail(new Error(m.message));
    };
    camW.onerror = (e) => fail(new Error(e.message || 'camera worker failed'));
  }
  const handle = ([r, cam]: [PoseRes, [number, number, number, number] | null]) => {
    let lm: Landmark[] | null = null;
    if (r.lm) { lm = []; for (let k = 0; k < 33; k++) lm.push({ x: r.lm[3 * k], y: r.lm[3 * k + 1], visibility: r.lm[3 * k + 2] }); }
    store(T, r.i, lm);
    const c = cam ?? r.cam;
    if (c) { T.CA[r.i] = c[0]; T.CB[r.i] = c[1]; T.OX[r.i] = c[2]; T.OY[r.i] = c[3]; }
    o.onFrame?.(r.i, N, T.found, lm);
  };
  const pending: Promise<[PoseRes, [number, number, number, number] | null]>[] = [];
  const next = async () => { if (failure) throw failure; handle(await Promise.race([pending.shift()!, stopped])); };
  for (let i = 0; i < N; i++) {
    if (o.signal?.aborted) throw new Cancelled();
    if (failure) throw failure;
    await seekFrame(video, T, fps, i);
    const bitmap = await createImageBitmap(video);
    const camBitmap = camW ? await createImageBitmap(bitmap) : null; // the camera worker's own copy
    ts += Math.round(1000 / fps);
    const pose = new Promise<PoseRes>((res) => poseWait.set(i, res));
    w.postMessage({ type: 'frame', i, ts, bitmap } satisfies ToWorker, [bitmap]);
    pending.push(pose.then(async (r) => {
      if (!camW || !camBitmap) return [r, null] as [PoseRes, null];
      const c = new Promise<[number, number, number, number]>((res) => camWait.set(i, res));
      camW.postMessage({ type: 'frame', i, bitmap: camBitmap, lm: r.lm } satisfies ToCamera, [camBitmap]);
      return [r, await c] as [PoseRes, [number, number, number, number]];
    }));
    if (pending.length >= IN_FLIGHT) await next();
  }
  while (pending.length) await next();
  return finish(T, o);
}

async function extractMain(o: ExtractOptions): Promise<{ raw: RawTrack; found: number }> {
  const { video, fps } = o, T = setup(o), N = T.N;
  const landmarker = await createLandmarker(o.model);
  const cam = o.camera ? new CameraTracker(T.vw, T.vh) : null;
  for (let i = 0; i < N; i++) {
    if (o.signal?.aborted) throw new Cancelled();
    await seekFrame(video, T, fps, i);
    ts += Math.round(1000 / fps);
    let lm: Landmark[] | null = null;
    try { lm = landmarker.detectForVideo(video, ts)?.landmarks?.[0] ?? null; } catch (e) { console.warn(e); }
    store(T, i, lm);
    if (cam) { const m = cam.push(video, lm); T.CA[i] = m.a; T.CB[i] = m.b; T.OX[i] = m.tx; T.OY[i] = m.ty; }
    o.onFrame?.(i, N, T.found, lm);
  }
  return finish(T, o);
}
