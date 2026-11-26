// M03 camera tracking in its own Web Worker, running alongside the pose worker: frame i is tracked
// here while the pose model works on frame i+1. Needs frame i's pose (to mask the climber), so the
// result is the same as tracking right after pose.
/// <reference lib="webworker" />
import { SimTracker, toFullRes, type Box } from './tracker';

declare const self: DedicatedWorkerGlobalScope;

export type ToCamera =
  | { type: 'init'; vw: number; vh: number }
  | { type: 'frame'; i: number; bitmap: ImageBitmap; lm: Float64Array | null };   // lm: x,y,vis ×33 (normalised)
export type FromCamera =
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'result'; i: number; cam: [number, number, number, number] };

let st: { tr: SimTracker; ctx: OffscreenCanvasRenderingContext2D; sw: number; sh: number; ms: number; lastBox: Box } | null = null;

/** Same as camera/index.ts toGray + personBox (kept local: that module touches the DOM). */
function gray(d: Uint8ClampedArray, n: number): Float32Array {
  const g = new Float32Array(n);
  for (let p = 0, q = 0; p < n; p++, q += 4) g[p] = 0.299 * d[q] + 0.587 * d[q + 1] + 0.114 * d[q + 2];
  return g;
}
function box(lm: Float64Array, sw: number, sh: number): Box {
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  for (let k = 0; k < 33; k++) { const x = lm[3 * k], y = lm[3 * k + 1]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const mx = (x1 - x0) * 0.35 + 0.03, my = (y1 - y0) * 0.2 + 0.03;
  return [(x0 - mx) * sw, (y0 - my) * sh, (x1 + mx) * sw, (y1 + my) * sh];
}

self.onmessage = (e: MessageEvent<ToCamera>) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      const ms = Math.min(1, 320 / Math.max(m.vw, m.vh)), sw = Math.round(m.vw * ms), sh = Math.round(m.vh * ms);
      st = { tr: new SimTracker(sw, sh), ctx: new OffscreenCanvas(sw, sh).getContext('2d', { willReadFrequently: true })!, sw, sh, ms, lastBox: null };
      self.postMessage({ type: 'ready' } satisfies FromCamera);
    } else if (m.type === 'frame' && st) {
      st.ctx.drawImage(m.bitmap, 0, 0, st.sw, st.sh); m.bitmap.close();
      const b = m.lm ? box(m.lm, st.sw, st.sh) : st.lastBox; st.lastBox = b;
      const s = toFullRes(st.tr.push(gray(st.ctx.getImageData(0, 0, st.sw, st.sh).data, st.sw * st.sh), b), st.ms);
      self.postMessage({ type: 'result', i: m.i, cam: [s.a, s.b, s.tx, s.ty] } satisfies FromCamera);
    }
  } catch (err) { self.postMessage({ type: 'error', message: (err as Error).message || String(err) } satisfies FromCamera); }
};
