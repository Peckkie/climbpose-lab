// M02 + M03 in a Web Worker: pose model and camera tracking off the main thread, so the page stays
// responsive while a clip is analysed. Messages: init → ready | error; frame → result; close.
/// <reference lib="webworker" />
import { MODEL_URL, MP_URL, WASM_URL, POSE_OPTIONS, type ModelKind, type Landmark } from './config';
import { SimTracker, toFullRes, type Box } from '../camera/tracker';

declare const self: DedicatedWorkerGlobalScope;

// MediaPipe's wasm loader calls importScripts(), which module workers don't allow: load it with a
// synchronous request instead and run it in the global scope.
(self as unknown as { importScripts: (...u: string[]) => void }).importScripts = (...urls: string[]) => {
  for (const u of urls) {
    const x = new XMLHttpRequest(); x.open('GET', u, false); x.send();
    if (x.status !== 200) throw new Error(`could not load ${u} (${x.status})`);
    (0, eval)(x.responseText);
  }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mp: any = null, fileset: unknown = null, lmk: any = null;
let cam: { tr: SimTracker; ctx: OffscreenCanvasRenderingContext2D; sw: number; sh: number; ms: number; lastBox: Box } | null = null;

export type ToWorker =
  | { type: 'init'; kind: ModelKind; camera: boolean; vw: number; vh: number }
  | { type: 'frame'; i: number; ts: number; bitmap: ImageBitmap }
  | { type: 'close' };
export type FromWorker =
  | { type: 'ready'; delegate: 'GPU' | 'CPU' }
  | { type: 'error'; message: string }
  | { type: 'result'; i: number; lm: Float32Array | null; cam: [number, number, number, number] | null };

function gray(d: Uint8ClampedArray, n: number): Float32Array {
  const g = new Float32Array(n);
  for (let p = 0, q = 0; p < n; p++, q += 4) g[p] = 0.299 * d[q] + 0.587 * d[q + 1] + 0.114 * d[q + 2];
  return g;
}
function box(lm: Landmark[], sw: number, sh: number): Box {
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  for (const p of lm) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const mx = (x1 - x0) * 0.35 + 0.03, my = (y1 - y0) * 0.2 + 0.03;
  return [(x0 - mx) * sw, (y0 - my) * sh, (x1 + mx) * sw, (y1 + my) * sh];
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      if (!mp) mp = await import(/* @vite-ignore */ MP_URL);
      if (!fileset) fileset = await mp.FilesetResolver.forVisionTasks(WASM_URL);
      if (lmk) { try { lmk.close(); } catch { /* closed */ } }
      const make = (delegate: 'GPU' | 'CPU') => mp.PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: MODEL_URL[m.kind], delegate }, ...POSE_OPTIONS });
      let delegate: 'GPU' | 'CPU' = 'GPU';
      try { lmk = await make('GPU'); } catch { delegate = 'CPU'; lmk = await make('CPU'); }
      cam = null;
      if (m.camera) {
        const ms = Math.min(1, 320 / Math.max(m.vw, m.vh)), sw = Math.round(m.vw * ms), sh = Math.round(m.vh * ms);
        const c = new OffscreenCanvas(sw, sh);
        cam = { tr: new SimTracker(sw, sh), ctx: c.getContext('2d', { willReadFrequently: true })!, sw, sh, ms, lastBox: null };
      }
      self.postMessage({ type: 'ready', delegate } satisfies FromWorker);
    } else if (m.type === 'frame') {
      let lm: Landmark[] | null = null;
      try { lm = lmk.detectForVideo(m.bitmap, m.ts)?.landmarks?.[0] ?? null; } catch (err) { console.warn(err); }
      let c: [number, number, number, number] | null = null;
      if (cam) {
        cam.ctx.drawImage(m.bitmap, 0, 0, cam.sw, cam.sh);
        const b = lm ? box(lm, cam.sw, cam.sh) : cam.lastBox; cam.lastBox = b;
        const s = toFullRes(cam.tr.push(gray(cam.ctx.getImageData(0, 0, cam.sw, cam.sh).data, cam.sw * cam.sh), b), cam.ms);
        c = [s.a, s.b, s.tx, s.ty];
      }
      m.bitmap.close();
      let out: Float32Array | null = null;
      if (lm) { out = new Float32Array(99); lm.forEach((p, k) => { out![3 * k] = p.x; out![3 * k + 1] = p.y; out![3 * k + 2] = p.visibility ?? 1; }); }
      self.postMessage({ type: 'result', i: m.i, lm: out, cam: c } satisfies FromWorker, out ? [out.buffer] : []);
    } else if (m.type === 'close') {
      if (lmk) { try { lmk.close(); } catch { /* closed */ } lmk = null; }
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: (err as Error).message || String(err) } satisfies FromWorker);
  }
};
