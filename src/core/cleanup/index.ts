// M04 · core/cleanup — drop false detections, then fix left/right label swaps.
// Ported 1:1 from v0.2 (rejectOutliers, fixLeftRight).

import { CONFIG } from '../../config';
import type { RawTrack, F32 } from '../../types';

export interface Cleaned extends RawTrack { rejected: number; badMask: Uint8Array; }

/**
 * Drop frames whose hip position or trunk size disagrees with the nearest frames that have a pose.
 * Catches the model locking onto wall shapes / the floor for a few frames. Short window so real
 * fast moves (dynos, falls) survive.
 */
export function rejectOutliers(R: RawTrack, cfg = CONFIG.outliers): Cleaned {
  const N = R.N, fps = R.fps, X = R.X.slice(), Y = R.Y.slice(), V = R.V.slice();
  const hx = new Float32Array(N), hy = new Float32Array(N), tl = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    hx[i] = (X[23 * N + i] + X[24 * N + i]) / 2; hy[i] = (Y[23 * N + i] + Y[24 * N + i]) / 2;
    tl[i] = Math.hypot((X[11 * N + i] + X[12 * N + i]) / 2 - hx[i], (Y[11 * N + i] + Y[12 * N + i]) / 2 - hy[i]);
  }
  const w = Math.max(2, Math.round(fps * cfg.windowS)), bad = new Uint8Array(N);
  const med = (a: number[]) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  for (let i = 0; i < N; i++) {
    if (!isFinite(hx[i])) continue;
    // the 2w+1 nearest frames with a pose (±searchS): a false run right after a gap is still
    // judged against the real frames that follow it
    const R6 = Math.round(fps * cfg.searchS), near: number[] = [];
    for (let j = Math.max(0, i - R6); j <= Math.min(N - 1, i + R6); j++) if (isFinite(hx[j])) near.push(j);
    near.sort((a, b) => Math.abs(a - i) - Math.abs(b - i)); near.length = Math.min(near.length, 2 * w + 1);
    if (near.length < cfg.minNeighbours) continue;
    const mx = med(near.map((j) => hx[j])), my = med(near.map((j) => hy[j])), mt = med(near.map((j) => tl[j]));
    if (Math.hypot(hx[i] - mx, hy[i] - my) > cfg.hipJumpTrunks * mt || tl[i] > cfg.trunkMax * mt || tl[i] < cfg.trunkMin * mt) bad[i] = 1;
  }
  let n = 0;
  for (let i = 0; i < N; i++) if (bad[i]) { n++; for (let k = 0; k < 33; k++) { X[k * N + i] = NaN; Y[k * N + i] = NaN; V[k * N + i] = 0; } }
  return { ...R, X, Y, V, rejected: n, badMask: bad };
}

const LR_SHOULDERS: [number, number][] = [[11, 12], [7, 8]];
const LR_HIPS: [number, number][] = [[23, 24]];
const LR_ARMS: [number, number][] = [[13, 14], [15, 16], [17, 18], [19, 20], [21, 22]];
const LR_LEGS: [number, number][] = [[25, 26], [27, 28], [29, 30], [31, 32]];

export interface LRResult { X: F32; Y: F32; V: F32; swaps: { shoulders: number; hips: number; arms: number; legs: number }; }

/**
 * Per body group (shoulders, hips, arms, legs) choose "as labelled" or "swapped" per frame with a
 * Viterbi pass minimising frame-to-frame jumps; limbs also pay a penalty when thighs/upper arms cross.
 * Legs also pay when the left leg sits on the body's right side (relative to the shoulder + hip
 * axis, which are fixed first): breaks the tie when both legs start together and one lifts.
 */
export function fixLeftRight(R: { N: number; X: F32; Y: F32; V: F32 }, cfg = CONFIG.leftRight): LRResult {
  const N = R.N, X = R.X.slice(), Y = R.Y.slice(), V = R.V.slice();
  const idx: number[] = [];
  for (let i = 0; i < N; i++) if (isFinite(X[11 * N + i])) idx.push(i);
  const out: LRResult = { X, Y, V, swaps: { shoulders: 0, hips: 0, arms: 0, legs: 0 } };
  if (idx.length < 3) return out;
  const med = (a: number[]) => { const v = a.filter(isFinite).sort((p, q) => p - q); return v.length ? v[v.length >> 1] : NaN; };
  const torso = med(idx.map((i) => Math.hypot((X[11 * N + i] + X[12 * N + i] - X[23 * N + i] - X[24 * N + i]) / 2, (Y[11 * N + i] + Y[12 * N + i] - Y[23 * N + i] - Y[24 * N + i]) / 2))) || 1;
  const map = (pairs: [number, number][], k: number, s: number) => { if (s) for (const [a, b] of pairs) { if (k === a) return b; if (k === b) return a; } return k; };
  const swapAt = (pairs: [number, number][], i: number) => { for (const [a, b] of pairs) for (const A of [X, Y, V]) { const t = A[a * N + i]; A[a * N + i] = A[b * N + i]; A[b * N + i] = t; } };
  const viterbi = (pairs: [number, number][], emit: (i: number, s: number) => number) => {
    const pts = pairs.flat(), n = idx.length, PRIOR = cfg.prior;
    let cost = [emit(idx[0], 0), emit(idx[0], 1) + PRIOR];
    const back: number[][] = [[0, 0]];
    for (let m = 1; m < n; m++) {
      const i = idx[m], j = idx[m - 1], c = [0, 0], b = [0, 0];
      for (let s = 0; s < 2; s++) {
        let best = 1e18, bs = 0;
        for (let sp = 0; sp < 2; sp++) {
          let tr = 0, cnt = 0;
          for (const k of pts) { const a = map(pairs, k, s), q = map(pairs, k, sp); const dd = Math.hypot(X[a * N + i] - X[q * N + j], Y[a * N + i] - Y[q * N + j]); if (isFinite(dd)) { tr += dd; cnt++; } }
          const v = cost[sp] + (cnt ? tr / cnt / torso : 0);
          if (v < best) { best = v; bs = sp; }
        }
        c[s] = best + emit(i, s) + (s ? PRIOR : 0); b[s] = bs;
      }
      cost = c; back.push(b);
    }
    let s = cost[0] <= cost[1] ? 0 : 1, sw = 0;
    for (let m = n - 1; m >= 0; m--) { if (s) { swapAt(pairs, idx[m]); sw++; } s = back[m][s]; }
    return sw;
  };
  out.swaps.shoulders = viterbi(LR_SHOULDERS, () => 0);
  out.swaps.hips = viterbi(LR_HIPS, () => 0);
  type P = [number, number];
  const cross = (p1: P, p2: P, p3: P, p4: P) => { const o = (a: P, b: P, c: P) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])); return o(p1, p2, p3) * o(p1, p2, p4) < 0 && o(p3, p4, p1) * o(p3, p4, p2) < 0; };
  const Pt = (k: number, i: number): P => [X[k * N + i], Y[k * N + i]];
  const crossCost = (pairs: [number, number][], base: [number, number], joint: [number, number], w: number) => (i: number, s: number) => {
    const jl = map(pairs, joint[0], s), jr = map(pairs, joint[1], s);
    return cross(Pt(base[0], i), Pt(jl, i), Pt(base[1], i), Pt(jr, i)) ? w : 0;
  };
  out.swaps.arms = viterbi(LR_ARMS, crossCost(LR_ARMS, [11, 12], [13, 14], cfg.crossPenalty));
  // body side: lateral direction = perpendicular to the spine, pointing to the body's right (sign
  // from the already-fixed shoulders + hips). The left leg's knee / ankle / foot should be lateral-left
  // of the right leg's. Side-on, the shoulder/hip axis is short, so the cue counts less.
  const sideCost = (i: number, s: number) => {
    const ax = X[12 * N + i] - X[11 * N + i] + X[24 * N + i] - X[23 * N + i], ay = Y[12 * N + i] - Y[11 * N + i] + Y[24 * N + i] - Y[23 * N + i];
    const sx = (X[11 * N + i] + X[12 * N + i] - X[23 * N + i] - X[24 * N + i]) / 2, sy = (Y[11 * N + i] + Y[12 * N + i] - Y[23 * N + i] - Y[24 * N + i]) / 2;
    const sl = Math.hypot(sx, sy); if (!isFinite(sl) || !isFinite(ax) || sl < 1e-6) return 0;
    let ux = -sy / sl, uy = sx / sl;
    const along = ax * ux + ay * uy; if (along < 0) { ux = -ux; uy = -uy; }
    const trust = Math.min(1, Math.abs(along) / 2 / (cfg.sideAxisFull * torso));
    let off = 0, c = 0;
    for (const [l, r] of [[25, 26], [27, 28], [31, 32]] as [number, number][]) {
      const L = map(LR_LEGS, l, s), R2 = map(LR_LEGS, r, s);
      const d = (X[L * N + i] - X[R2 * N + i]) * ux + (Y[L * N + i] - Y[R2 * N + i]) * uy;
      if (isFinite(d)) { off += d; c++; }
    }
    return c ? cfg.sidePenalty * trust * Math.max(0, off / c / torso) : 0;
  };
  const legCross = crossCost(LR_LEGS, [23, 24], [25, 26], cfg.crossPenalty);
  out.swaps.legs = viterbi(LR_LEGS, (i, s) => legCross(i, s) + sideCost(i, s));
  return out;
}
