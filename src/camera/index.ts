// M03 camera — global translation of the wall between frames (hand-held / panning camera),
// by block matching on a small grayscale copy, ignoring patches on the climber.

import type { Landmark } from '../pose';

type Box = [number, number, number, number] | null;

export function toGray(d: Uint8ClampedArray, n: number): Float32Array {
  const g = new Float32Array(n);
  for (let p = 0, q = 0; p < n; p++, q += 4) g[p] = 0.299 * d[q] + 0.587 * d[q + 1] + 0.114 * d[q + 2];
  return g;
}

/** Climber's bounding box (with margin) in small-image pixels. */
export function personBox(lm: Landmark[], sw: number, sh: number): Box {
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  for (const p of lm) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const mx = (x1 - x0) * 0.35 + 0.03, my = (y1 - y0) * 0.2 + 0.03;
  return [(x0 - mx) * sw, (y0 - my) * sh, (x1 + mx) * sw, (y1 + my) * sh];
}

/** [dx, dy]: how far the wall texture moved from A to B (median of patch matches, sub-pixel). */
export function estShift(A: Float32Array, B: Float32Array, w: number, h: number, boxes: Box[]): [number, number] {
  const P = 14, R = 12, step = 2, res: [number, number][] = [];
  const hit = (x: number, y: number) => boxes.some((b) => b && x + P > b[0] - R && x < b[2] + R && y + P > b[1] - R && y < b[3] + R);
  for (let y = R + 1; y + P + R + 1 < h; y += 18) for (let x = R + 1; x + P + R + 1 < w; x += 18) {
    if (hit(x, y)) continue;
    let m = 0, v = 0, c = 0;
    for (let j = 0; j < P; j += step) for (let i = 0; i < P; i += step) { const a = A[(y + j) * w + x + i]; m += a; v += a * a; c++; }
    m /= c; if (v / c - m * m < 40) continue; // flat patch: nothing to lock onto
    const cost = new Float32Array((2 * R + 1) * (2 * R + 1)); let best = 1e18, bx = 0, by = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      let s = 0;
      for (let j = 0; j < P; j += step) { const ra = (y + j) * w + x, rb = (y + j + dy) * w + x + dx; for (let i = 0; i < P; i += step) s += Math.abs(A[ra + i] - B[rb + i]); }
      cost[(dy + R) * (2 * R + 1) + dx + R] = s; if (s < best) { best = s; bx = dx; by = dy; }
    }
    if (Math.abs(bx) === R || Math.abs(by) === R) continue;
    const C = (dx: number, dy: number) => cost[(dy + R) * (2 * R + 1) + dx + R];
    const sub = (l: number, c0: number, r: number) => { const den = l - 2 * c0 + r; return den > 0 ? 0.5 * (l - r) / den : 0; };
    res.push([bx + sub(C(bx - 1, by), best, C(bx + 1, by)), by + sub(C(bx, by - 1), best, C(bx, by + 1))]);
  }
  if (res.length < 4) return [0, 0];
  const med = (k: 0 | 1) => { const a = res.map((r) => r[k]).sort((p, q) => p - q); return a[a.length >> 1]; };
  return [med(0), med(1)];
}

/** Accumulates the camera shift frame by frame, in full-video pixels. */
export class CameraTracker {
  private ctx: CanvasRenderingContext2D;
  private sw: number; private sh: number; private ms: number;
  private prevG: Float32Array | null = null; private prevBox: Box = null;
  private cx = 0; private cy = 0;
  constructor(vw: number, vh: number, maxSide = 320) {
    this.ms = Math.min(1, maxSide / Math.max(vw, vh));
    this.sw = Math.round(vw * this.ms); this.sh = Math.round(vh * this.ms);
    const c = document.createElement('canvas'); c.width = this.sw; c.height = this.sh;
    this.ctx = c.getContext('2d', { willReadFrequently: true })!;
  }
  /** Feed the current frame; returns the accumulated shift [ox, oy]. */
  push(src: CanvasImageSource, lm: Landmark[] | null): [number, number] {
    const { sw, sh } = this;
    this.ctx.drawImage(src, 0, 0, sw, sh);
    const g = toGray(this.ctx.getImageData(0, 0, sw, sh).data, sw * sh);
    const box = lm ? personBox(lm, sw, sh) : this.prevBox;
    if (this.prevG) { const d = estShift(this.prevG, g, sw, sh, [this.prevBox, box]); this.cx += d[0]; this.cy += d[1]; }
    this.prevG = g; this.prevBox = box;
    return [this.cx / this.ms, this.cy / this.ms];
  }
}
