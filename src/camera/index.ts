// M03 camera — the wall's motion in the video (pan, zoom, roll of a hand-held camera), so paths
// and holds can be measured in wall coordinates. The tracking itself is in tracker.ts (pure);
// this wrapper feeds it small grayscale copies of video frames.

import type { Landmark } from '../pose';
import type { Sim } from '../core/signal/similarity';
import { SimTracker, toFullRes, type Box } from './tracker';

export { SimTracker, type Box } from './tracker';

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

/** Frame by frame: wall (first frame) → this frame, in full-video pixels. */
export class CameraTracker {
  private ctx: CanvasRenderingContext2D;
  private sw: number; private sh: number; private ms: number;
  private tr: SimTracker; private lastBox: Box = null;
  constructor(vw: number, vh: number, maxSide = 320) {
    this.ms = Math.min(1, maxSide / Math.max(vw, vh));
    this.sw = Math.round(vw * this.ms); this.sh = Math.round(vh * this.ms);
    const c = document.createElement('canvas'); c.width = this.sw; c.height = this.sh;
    this.ctx = c.getContext('2d', { willReadFrequently: true })!;
    this.tr = new SimTracker(this.sw, this.sh);
  }
  push(src: CanvasImageSource, lm: Landmark[] | null): Sim {
    const { sw, sh } = this;
    this.ctx.drawImage(src, 0, 0, sw, sh);
    const g = toGray(this.ctx.getImageData(0, 0, sw, sh).data, sw * sh);
    const box = lm ? personBox(lm, sw, sh) : this.lastBox; this.lastBox = box;
    return toFullRes(this.tr.push(g, box), this.ms);
  }
}
