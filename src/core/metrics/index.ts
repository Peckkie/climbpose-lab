// M09 · core/metrics — movement metrics on the wall and the heuristic Flow score.
// Ported 1:1 from v0.2 process().

import { CONFIG } from '../../config';
import type { Attempt, Metrics, Scores } from '../../types';
import { clamp01, deriv, hull, runs, type Pt } from '../signal';
import type { Kinematics } from '../kinematics';

export interface MotionMetrics {
  M: Partial<Metrics>;
  use: Uint8Array;   // frames counted (on the wall when attempts exist)
  y0: number;
}

/** Path/GIE/straightness per attempt, height, immobility, straight-arm rest, LDLJ fluency. */
export function computeMotionMetrics(k: Kinematics, attempts: Attempt[], onWall: Uint8Array, fps: number, cfg = CONFIG.flow): MotionMetrics {
  const { valid, cxs, cys, moving, ang, vx, vy, speed, mpp } = k, N = valid.length;
  const M: Partial<Metrics> = {};
  M.attempts = attempts.length;
  const use = new Uint8Array(N);
  for (let i = 0; i < N; i++) use[i] = valid[i] && (attempts.length ? onWall[i] : 1);
  const spans: [number, number][] = attempts.length ? attempts.map((a) => [a.i0, a.i1]) : [[0, N]];
  const vIdx: number[] = [];
  for (let i = 0; i < N; i++) if (use[i]) vIdx.push(i);
  M.coverage = vIdx.length ? Array.from(valid).reduce((p, c) => p + c, 0) / N : 0;
  M.time = vIdx.length / fps;
  let L = 0, gW = 0, gS = 0, stS = 0;
  for (const [a, b] of spans) {
    const ids: number[] = [];
    for (let i = a; i < b; i++) if (use[i]) ids.push(i);
    if (ids.length < fps) continue;
    let l = 0;
    for (let n = 1; n < ids.length; n++) { const i = ids[n], j = ids[n - 1]; if (i - j <= 2) l += Math.hypot(cxs[i] - cxs[j], cys[i] - cys[j]); }
    const Hh = hull(ids.map((i): Pt => [cxs[i], cys[i]]));
    let per = 0;
    for (let n = 0; n < Hh.length; n++) { const p = Hh[n], q = Hh[(n + 1) % Hh.length]; per += Math.hypot(p[0] - q[0], p[1] - q[1]); }
    // straightness: start → highest point (the climb, not the drop back down)
    let top = ids[0];
    for (const i of ids) if (cys[i] < cys[top]) top = i;
    let lUp = 0;
    for (let n = 1; n < ids.length && ids[n] <= top; n++) { const i = ids[n], j = ids[n - 1]; if (i - j <= 2) lUp += Math.hypot(cxs[i] - cxs[j], cys[i] - cys[j]); }
    const w = ids.length;
    L += l;
    if (per > 0 && l > 0) { gS += Math.log2(2 * l / per) * w; gW += w; }
    if (lUp > 0) stS += Math.min(1, Math.hypot(cxs[top] - cxs[ids[0]], cys[top] - cys[ids[0]]) / lUp) * w;
  }
  M.pathM = L * mpp; M.gie = gW ? gS / gW : NaN; M.straightness = gW ? stS / gW : NaN;
  let best: Attempt | null = null;
  for (const a of attempts) if (!best || a.highFootM > best.highFootM) best = a;
  const y0 = vIdx.length ? cys[vIdx[0]] : NaN;
  if (best) {
    let topI = best.i0;
    for (let i = best.i0; i < best.i1; i++) if (isFinite(cys[i]) && cys[i] < cys[topI]) topI = i;
    M.ascentM = (cys[best.i0] - cys[topI]) * mpp;
    M.vSpeed = topI > best.i0 ? M.ascentM / ((topI - best.i0) / fps) * 60 : NaN;
    M.highFootM = best.highFootM;
  } else {
    let minY = Infinity;
    for (const i of vIdx) minY = Math.min(minY, cys[i]);
    M.ascentM = (y0 - minY) * mpp; M.vSpeed = M.time > 0 ? M.ascentM / M.time * 60 : NaN; M.highFootM = NaN;
  }
  let still = 0, stillArm = 0, stillArmN = 0;
  for (const i of vIdx) {
    if (!moving[i]) {
      still++;
      const e = Math.max(ang[0][i] || 0, ang[1][i] || 0);
      if (isFinite(ang[0][i]) || isFinite(ang[1][i])) { stillArmN++; if (e > cfg.straightArmDeg) stillArm++; }
    }
  }
  M.immobility = vIdx.length ? still / vIdx.length : NaN;
  M.straightArm = stillArmN ? stillArm / stillArmN : NaN;
  // fluency: log dimensionless jerk per movement segment on the wall
  const ax = deriv(vx, fps), ay = deriv(vy, fps), jx = deriv(ax, fps), jy = deriv(ay, fps);
  const mv = new Uint8Array(N);
  for (let i = 0; i < N; i++) mv[i] = moving[i] && use[i];
  let ldljSum = 0, ldljW = 0;
  const segs = runs(mv).filter(([a, b]) => b - a >= fps * cfg.ldljMinSegS);
  for (const [a, b] of segs) {
    let J = 0, vp = 0;
    for (let i = a; i < b; i++) { const jj = (jx[i] ** 2 + jy[i] ** 2) * mpp * mpp; if (isFinite(jj)) J += jj / fps; vp = Math.max(vp, speed[i]); }
    const T = (b - a) / fps;
    if (vp > 0 && J > 0) { const l = -Math.log(T ** 3 / (vp * vp) * J); ldljSum += l * T; ldljW += T; }
  }
  M.ldlj = ldljW ? ldljSum / ldljW : NaN; M.moves = segs.length;
  return { M, use, y0 };
}

/** Heuristic 0..1 component scores and the Flow score (0..100). */
export function flowScore(M: Partial<Metrics>, cfg = CONFIG.flow): { sc: Scores; flow: number } {
  const sc: Scores = {
    fluency: clamp01((M.ldlj! - cfg.ldljLo) / cfg.ldljSpan),
    path: clamp01(1 - (M.gie! - cfg.gieLo) / cfg.gieSpan),
    arms: isFinite(M.straightArm!) ? clamp01(M.straightArm! / cfg.straightArmFull) : 0.5,
    feet: isFinite(M.footHand!) ? clamp01(M.footHand! / cfg.footHandFull) : 0.5,
  };
  for (const key of Object.keys(sc) as (keyof Scores)[]) if (!isFinite(sc[key])) sc[key] = 0.5;
  const W = cfg.weights;
  const flow = Math.round(100 * (W.fluency * sc.fluency + W.path * sc.path + W.arms * sc.arms + W.feet * sc.feet));
  return { sc, flow };
}
