// M03 camera — similarity tracking of the wall (pan, zoom, roll) against a keyframe.
// Pure (no DOM): works on small grayscale frames, so it also runs in Node on decoded video.
//
// For each frame: textured patches of the keyframe (climber masked) are searched for around where
// the previous frame's transform predicts them, then a similarity is fitted with RANSAC. Matching
// against a keyframe instead of the previous frame stops small errors from adding up; a new
// keyframe is taken when the view has changed too much (scale, overlap) or matches get weak.
import { apply, compose, invert, ransacSimilarity, scaleOf, IDENTITY, type Sim } from '../core/signal/similarity';

export type Box = [number, number, number, number] | null;

export interface TrackerOptions {
  patch: number; step: number; grid: number; search: number;
  minTexture: number; ransacTol: number; minInliers: number;
  rekeyScale: number; rekeyShift: number;
  rekeyInliers: number;   // new keyframe when fewer than this share of the keyframe's points still match
  minKeyPts: number;      // a frame needs this many textured points to become the keyframe
}
export const TRACKER_DEFAULTS: TrackerOptions = {
  patch: 14, step: 2, grid: 10, search: 10,
  minTexture: 25, ransacTol: 1.5, minInliers: 10,
  rekeyScale: 0.08, rekeyShift: 0.2, rekeyInliers: 0.5, minKeyPts: 30,
};

interface Keyframe { g: Float32Array; box: Box; M: Sim; pts: [number, number][]; }

/** Tracks wall → frame transforms in small-image pixels; the first frame is the identity. */
export class SimTracker {
  private o: TrackerOptions;
  private kf: Keyframe | null = null;
  private history: Keyframe[] = [];     // earlier keyframes, for re-anchoring (loop closure)
  private last: Sim = IDENTITY; private prev: Sim = IDENTITY;
  /** Frames where tracking failed and the previous transform was kept; new keyframes; re-anchors. */
  lost = 0; rekeys = 0; anchors = 0;
  constructor(readonly w: number, readonly h: number, opts: Partial<TrackerOptions> = {}) { this.o = { ...TRACKER_DEFAULTS, ...opts }; }

  push(gray: Float32Array, box: Box): Sim {
    const g = normalize(gray);
    if (!this.kf) { this.kf = this.makeKey(g, box, IDENTITY); return this.last = IDENTITY; }
    const kf = this.kf;
    // 1) constant-velocity prediction, 2) no motion, 3) coarse wide search against the keyframe
    const vel = compose(compose(this.last, invert(this.prev)), this.last);
    let r = this.track(g, box, vel, kf) ?? this.track(g, box, this.last, kf);
    if (!r) { const c = this.coarse(g, box); if (c) r = this.track(g, box, c, kf); }
    let m: Sim;
    if (!r) {
      this.lost++; m = this.last;
      // stuck on a weak keyframe: restart from this frame if it has more to hold on to
      if (kf.pts.length < this.o.minKeyPts) { const k = this.makeKey(g, box, m); if (k.pts.length > kf.pts.length) this.kf = k; }
    } else {
      m = r.m;
      const rel = compose(m, invert(kf.M));
      if (Math.abs(scaleOf(rel) - 1) > this.o.rekeyScale || this.shift(rel) > this.o.rekeyShift * Math.min(this.w, this.h) || r.inliers < this.o.rekeyInliers * kf.pts.length) {
        const k = this.makeKey(g, box, m);
        if (k.pts.length >= this.o.minKeyPts || k.pts.length >= kf.pts.length) {
          // re-anchor on the oldest earlier keyframe that still sees this view: undoes drift
          m = this.reanchor(g, box, m); k.M = m;
          this.history.push(kf); if (this.history.length > 80) this.history.shift();
          this.kf = k; this.rekeys++;
        }
      }
    }
    this.prev = this.last;
    return this.last = m;
  }

  /** How far the frame centre moves under rel. */
  private shift(rel: Sim): number {
    const [x, y] = apply(rel, this.w / 2, this.h / 2);
    return Math.hypot(x - this.w / 2, y - this.h / 2);
  }

  private reanchor(g: Float32Array, box: Box, m: Sim): Sim {
    for (const old of this.history) {
      const rel = compose(m, invert(old.M));
      if (Math.abs(scaleOf(rel) - 1) > 0.15 || this.shift(rel) > 0.3 * Math.min(this.w, this.h)) continue;
      const r = this.track(g, box, m, old);
      if (r && r.inliers >= Math.max(2 * this.o.minInliers, 0.4 * old.pts.length)) { this.anchors++; return r.m; }
    }
    return m;
  }

  /** Keyframe from this frame: textured patches away from the climber. */
  private makeKey(g: Float32Array, box: Box, M: Sim): Keyframe {
    const { patch: P, step, grid, search: R, minTexture } = this.o, { w, h } = this;
    const pts: [number, number][] = [];
    for (let y = R + 1; y + P + R + 1 < h; y += grid) for (let x = R + 1; x + P + R + 1 < w; x += grid) {
      if (hit(box, x, y, P, R)) continue;
      let m = 0, v = 0, c = 0;
      for (let j = 0; j < P; j += step) for (let i = 0; i < P; i += step) { const a = g[(y + j) * w + x + i]; m += a; v += a * a; c++; }
      m /= c; if (v / c - m * m < minTexture) continue;
      pts.push([x, y]);
    }
    return { g, box, M, pts };
  }

  private track(g: Float32Array, box: Box, predM: Sim, kf: Keyframe): { m: Sim; inliers: number } | null {
    const { patch: P, step, search: R } = this.o, { w, h } = this, K = kf.g;
    const pred = compose(predM, invert(kf.M)); // keyframe → current, predicted
    const src: [number, number][] = [], dst: [number, number][] = [];
    for (const [x, y] of kf.pts) {
      const [px, py] = apply(pred, x + P / 2, y + P / 2), qx = Math.round(px - P / 2), qy = Math.round(py - P / 2);
      if (qx - R < 0 || qy - R < 0 || qx + P + R >= w || qy + P + R >= h || hit(box, qx, qy, P, R)) continue;
      let best = Infinity, bx = 0, by = 0;
      const cost = new Float32Array((2 * R + 1) * (2 * R + 1));
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        let s = 0;
        for (let j = 0; j < P; j += step) { const ra = (y + j) * w + x, rb = (qy + dy + j) * w + qx + dx; for (let i = 0; i < P; i += step) s += Math.abs(K[ra + i] - g[rb + i]); }
        cost[(dy + R) * (2 * R + 1) + dx + R] = s; if (s < best) { best = s; bx = dx; by = dy; }
      }
      if (Math.abs(bx) === R || Math.abs(by) === R) continue;
      const C = (dx: number, dy: number) => cost[(dy + R) * (2 * R + 1) + dx + R];
      const sub = (l: number, c0: number, r: number) => { const d = l - 2 * c0 + r; return d > 0 ? 0.5 * (l - r) / d : 0; };
      src.push([x + P / 2, y + P / 2]);
      dst.push([qx + bx + sub(C(bx - 1, by), best, C(bx + 1, by)) + P / 2, qy + by + sub(C(bx, by - 1), best, C(bx, by + 1)) + P / 2]);
    }
    const r = ransacSimilarity(src, dst, this.o.ransacTol, 200, 7);
    if (!r || r.inliers.length < this.o.minInliers) return null;
    return { m: compose(r.m, kf.M), inliers: r.inliers.length };
  }
  /** Lost: translation of the keyframe in this frame, by a wide search at quarter resolution
   *  (keeps the keyframe's scale / rotation). Returns a predicted wall → frame transform. */
  private coarse(g: Float32Array, box: Box): Sim | null {
    const f = 4, cw = Math.floor(this.w / f), ch = Math.floor(this.h / f), P = 6, R = 24;
    const kf = this.kf!, K = down(kf.g, this.w, cw, ch, f), G = down(g, this.w, cw, ch, f);
    const kb: Box = kf.box && [kf.box[0] / f, kf.box[1] / f, kf.box[2] / f, kf.box[3] / f];
    const gb: Box = box && [box[0] / f, box[1] / f, box[2] / f, box[3] / f];
    const dxs: number[] = [], dys: number[] = [];
    for (let y = 1; y + P < ch; y += P) for (let x = 1; x + P < cw; x += P) {
      if (hit(kb, x, y, P, 1)) continue;
      let m = 0, v = 0; for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) { const a = K[(y + j) * cw + x + i]; m += a; v += a * a; }
      m /= P * P; if (v / (P * P) - m * m < this.o.minTexture) continue;
      let best = Infinity, bx = 0, by = 0;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const qx = x + dx, qy = y + dy; if (qx < 0 || qy < 0 || qx + P > cw || qy + P > ch || hit(gb, qx, qy, P, 0)) continue;
        let s = 0; for (let j = 0; j < P; j++) { const ra = (y + j) * cw + x, rb = (qy + j) * cw + qx; for (let i = 0; i < P; i++) s += Math.abs(K[ra + i] - G[rb + i]); }
        if (s < best) { best = s; bx = dx; by = dy; }
      }
      if (best < Infinity) { dxs.push(bx); dys.push(by); }
    }
    if (dxs.length < 6) return null;
    const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1];
    const dx = med(dxs), dy = med(dys);
    // agreement check: most patches must point the same way
    let agree = 0; for (let k = 0; k < dxs.length; k++) if (Math.abs(dxs[k] - dx) <= 1 && Math.abs(dys[k] - dy) <= 1) agree++;
    if (agree < 0.3 * dxs.length) return null;
    return compose({ a: 1, b: 0, tx: dx * f, ty: dy * f }, kf.M);
  }
}

/** Box-average downsample by f. */
function down(g: Float32Array, w: number, cw: number, ch: number, f: number): Float32Array {
  const o = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { let s = 0; for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) s += g[(y * f + j) * w + x * f + i]; o[y * cw + x] = s / (f * f); }
  return o;
}

const hit = (b: Box, x: number, y: number, P: number, R: number) => !!b && x + P > b[0] - R && x < b[2] + R && y + P > b[1] - R && y < b[3] + R;

/** Zero mean, unit-ish contrast: auto-exposure changes don't break matching. */
function normalize(g: Float32Array): Float32Array {
  let m = 0, v = 0; for (const a of g) { m += a; v += a * a; }
  m /= g.length; const sd = Math.sqrt(Math.max(1e-6, v / g.length - m * m)) / 40;
  const out = new Float32Array(g.length); for (let i = 0; i < g.length; i++) out[i] = (g[i] - m) / sd;
  return out;
}

/** Small-image transform → full-video pixels (small = full × ms). */
export const toFullRes = (m: Sim, ms: number): Sim => ({ a: m.a, b: m.b, tx: m.tx / ms, ty: m.ty / ms });
