// M11 · core/load — static body-load estimate: kg at each supporting hand/foot, Nm at joints.
// Supports = still end effectors. Body weight in the wall plane (W·cosθ) is shared by 2D statics:
// force vectors sum to it and torques about the CoM balance (weighted least-norm; feet preferred).
// The off-the-wall part on overhangs (W·sinθ) goes to the hands. Quasi-static, 2D.
// Ported 1:1 from v0.2 process().

import { CONFIG } from '../../config';
import type { F32, LimbKey, LoadTrack, Metrics, TorqueTrack } from '../../types';
import { pct } from '../signal';
import type { Kinematics } from '../kinematics';

export interface LoadOut { load: LoadTrack; tq: TorqueTrack; handShare: F32; bwKg: number; bwKnown: boolean; }

const det3 = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

/**
 * Weighted least-norm 2D statics. Unknown force (fx, fy) per support at lever arm (rx, ry) from the CoM:
 * ΣFx = 0, ΣFy = Win, Σ(rx·fy − ry·fx) = 0. F = Wt·Aᵀ(A·Wt·Aᵀ)⁻¹b with a tiny ridge (Cramer's rule).
 * One support carries everything vertically.
 */
export function solveStatics(rx: number[], ry: number[], w: number[], Win: number): { fx: number[]; fy: number[] } {
  const n = rx.length, fx = new Array(n).fill(0), fy = new Array(n).fill(0);
  if (n === 1) { fy[0] = Win; return { fx, fy }; }
  const Mx = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let q = 0; q < n; q++) { const cx2 = [1, 0, -ry[q]], cy2 = [0, 1, rx[q]]; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) Mx[r][c] += w[q] * (cx2[r] * cx2[c] + cy2[r] * cy2[c]); }
  for (let r = 0; r < 3; r++) Mx[r][r] += 1e-6;
  const dm = det3(Mx), b = [0, Win, 0], lam = [0, 0, 0];
  for (let c = 0; c < 3; c++) { const m = Mx.map((r) => r.slice()); for (let r = 0; r < 3; r++) m[r][c] = b[r]; lam[c] = det3(m) / dm; }
  for (let q = 0; q < n; q++) { fx[q] = w[q] * (lam[0] - ry[q] * lam[2]); fy[q] = w[q] * (lam[1] + rx[q] * lam[2]); }
  return { fx, fy };
}

export function solveLoad(
  k: Kinematics, supp: Record<LimbKey, Uint8Array>, endPos: Record<LimbKey, { x: F32; y: F32 }>,
  weightKg: number | null, wallDeg: number, cfg = CONFIG.load,
): LoadOut {
  const { valid, cxs, cys, XSW, YSW, mpp } = k, N = valid.length;
  const bwKnown = !!weightKg && weightKg > 0, bwKg = bwKnown ? (weightKg as number) : cfg.assumedWeightKg;
  const th = (wallDeg || 0) * Math.PI / 180, G = cfg.g;
  const Win = bwKg * Math.cos(th), Pn = bwKg * Math.sin(th);
  const LK: LimbKey[] = ['LH', 'RH', 'LF', 'RF'], isHand = (q: LimbKey) => q[1] === 'H', WGT = cfg.weights;
  const load = {} as LoadTrack;
  for (const q of LK) load[q] = new Float32Array(N).fill(NaN);
  const tq = {} as TorqueTrack;
  for (const j of ['shL', 'shR', 'elL', 'elR', 'hipL', 'hipR', 'knL', 'knR'] as const) tq[j] = new Float32Array(N).fill(NaN);
  const handShare = new Float32Array(N).fill(NaN);
  const JT: Record<LimbKey, [keyof TorqueTrack, number][]> = { LH: [['shL', 11], ['elL', 13]], RH: [['shR', 12], ['elR', 14]], LF: [['hipL', 23], ['knL', 25]], RF: [['hipR', 24], ['knR', 26]] };
  for (let i = 0; i < N; i++) {
    if (!valid[i] || !isFinite(cxs[i])) continue;
    const act = LK.filter((q) => supp[q] && supp[q][i] && isFinite(endPos[q].x[i]));
    if (!act.length) continue; // airborne
    const n = act.length, rx: number[] = [], ry: number[] = [], w: number[] = [];
    for (const q of act) { rx.push((endPos[q].x[i] - cxs[i]) * mpp); ry.push(-(endPos[q].y[i] - cys[i]) * mpp); w.push(WGT[q]); }
    const { fx, fy } = solveStatics(rx, ry, w, Win);
    const p: Partial<Record<LimbKey, number>> = {};
    const hs = act.filter(isHand), fs = act.filter((q) => !isHand(q));
    if (Pn > 0) { const sh = hs.length ? hs : act; for (const q of sh) p[q] = Pn / sh.length; }
    else if (Pn < 0) { const sh = fs.length ? fs : act; for (const q of sh) p[q] = -Pn / sh.length; }
    let tot = 0, hand = 0;
    act.forEach((q, j) => {
      const pn = p[q] || 0, kg = Math.hypot(fx[j], fy[j], pn);
      load[q][i] = kg; tot += kg; if (isHand(q)) hand += kg;
      for (const [jn, jk] of JT[q]) {
        const dx = (endPos[q].x[i] - XSW[jk][i]) * mpp, dy = -(endPos[q].y[i] - YSW[jk][i]) * mpp;
        tq[jn][i] = G * Math.hypot(dx * fy[j] - dy * fx[j], pn * Math.hypot(dx, dy));
      }
    });
    handShare[i] = tot > 0 ? hand / tot : NaN;
  }
  return { load, tq, handShare, bwKg, bwKnown };
}

/** Summary over counted frames: share on hands, peak hand kg, peak shoulder Nm, support histogram. */
export function loadSummary(L: LoadOut, use: Uint8Array, wallDeg: number, cfg = CONFIG.load): Partial<Metrics> {
  const { load, tq, handShare, bwKg, bwKnown } = L, N = use.length, M: Partial<Metrics> = {};
  const hsUse: number[] = [], pk: number[] = [], shq: number[] = [];
  for (let i = 0; i < N; i++) {
    if (!use[i]) continue;
    if (isFinite(handShare[i])) hsUse.push(handShare[i]);
    const h = Math.max(load.LH[i] || 0, load.RH[i] || 0); if (h) pk.push(h);
    const sq = Math.max(tq.shL[i] || 0, tq.shR[i] || 0); if (sq) shq.push(sq);
  }
  M.handShare = hsUse.length ? hsUse.reduce((a, b) => a + b, 0) / hsUse.length : NaN;
  M.peakHandKg = pk.length ? pct(Float32Array.from(pk), 0.98) : NaN;
  M.peakShoulderNm = shq.length ? pct(Float32Array.from(shq), 0.98) : NaN;
  const cnt = [0, 0, 0, 0, 0];
  let n = 0;
  for (let i = 0; i < N; i++) { if (!use[i]) continue; n++; cnt[(['LH', 'RH', 'LF', 'RF'] as LimbKey[]).filter((q) => isFinite(load[q][i])).length]++; }
  M.supportHist = cnt.map((c) => (n ? Math.round(100 * c / n) : 0));
  M.highLoadPct = pk.length ? pk.filter((v) => v > cfg.highLoadShareOfBw * bwKg).length / Math.max(1, hsUse.length) : NaN;
  M.bodyKg = bwKg; M.bodyKgAssumed = !bwKnown; M.wallDeg = wallDeg || 0;
  return M;
}
