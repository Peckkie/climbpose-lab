// M06 · core/kinematics — smoothing, wall coordinates, metric scale, centre of mass, speed, joint angles.
// Ported 1:1 from the first part of v0.2 process().

import { CONFIG } from '../../config';
import type { F32 } from '../../types';
import { fillGaps, gsmooth, deriv, pct, angleAt, cleanRuns } from '../signal';

/** [a,b,c] landmark triplets: elbow L, elbow R, knee L, knee R. */
export const ANGLES: [number, number, number][] = [[11, 13, 15], [12, 14, 16], [23, 25, 27], [24, 26, 28]];

export interface KinInput { N: number; fps: number; vh: number; X: F32; Y: F32; V: F32; OX: F32; OY: F32; }

export interface Kinematics {
  X: F32[]; Y: F32[]; V: F32[]; XS: F32[]; YS: F32[];          // image coords (light / strong smoothing)
  XW: F32[]; YW: F32[]; XSW: F32[]; YSW: F32[];               // wall coords
  oX: F32; oY: F32;                                          // smoothed camera shift
  torso: F32; torsoPx: number; mpp: number;
  comX: F32; comY: F32; cxs: F32; cys: F32;                  // CoM (wall), light / strong smoothing
  vx: F32; vy: F32; speed: F32; valid: Uint8Array; moving: Uint8Array;
  ang: F32[];
}

const mid = (A: F32[], k1: number, k2: number, i: number) => (A[k1][i] + A[k2][i]) / 2;
const seg = (A: F32[], i: number, p: number, d: number, f: number) => A[p][i] + (A[d][i] - A[p][i]) * f;

/** Segment-model centre of mass (Dempster / de Leva mass fractions). */
function comAt(A: F32[], B: F32[], i: number): [number, number] {
  const head = [(A[0][i] + A[7][i] + A[8][i]) / 3, (B[0][i] + B[7][i] + B[8][i]) / 3];
  const sh = [mid(A, 11, 12, i), mid(B, 11, 12, i)], hp = [mid(A, 23, 24, i), mid(B, 23, 24, i)];
  const parts: [number, number, number][] = [
    [0.081, head[0], head[1]], [0.497, (sh[0] + hp[0]) / 2, (sh[1] + hp[1]) / 2],
    [0.028, seg(A, i, 11, 13, 0.436), seg(B, i, 11, 13, 0.436)], [0.028, seg(A, i, 12, 14, 0.436), seg(B, i, 12, 14, 0.436)],
    [0.022, seg(A, i, 13, 15, 0.682), seg(B, i, 13, 15, 0.682)], [0.022, seg(A, i, 14, 16, 0.682), seg(B, i, 14, 16, 0.682)],
    [0.100, seg(A, i, 23, 25, 0.433), seg(B, i, 23, 25, 0.433)], [0.100, seg(A, i, 24, 26, 0.433), seg(B, i, 24, 26, 0.433)],
    [0.061, seg(A, i, 25, 27, 0.606), seg(B, i, 25, 27, 0.606)], [0.061, seg(A, i, 26, 28, 0.606), seg(B, i, 26, 28, 0.606)]];
  let x = 0, y = 0;
  for (const p of parts) { x += p[0] * p[1]; y += p[0] * p[2]; }
  return [x, y];
}

export function buildKinematics(R: KinInput, heightCm: number, cfg = CONFIG): Kinematics {
  const { N, fps, vh } = R;
  const X: F32[] = [], Y: F32[] = [], V: F32[] = [], XS: F32[] = [], YS: F32[] = [];
  const gap = Math.round(fps * cfg.smoothing.gapFillS);
  for (let k = 0; k < 33; k++) {
    const x = fillGaps(R.X.slice(k * N, (k + 1) * N), gap), y = fillGaps(R.Y.slice(k * N, (k + 1) * N), gap);
    X[k] = gsmooth(x, fps * cfg.smoothing.drawSigmaS); Y[k] = gsmooth(y, fps * cfg.smoothing.drawSigmaS);
    XS[k] = gsmooth(x, fps * cfg.smoothing.metricSigmaS); YS[k] = gsmooth(y, fps * cfg.smoothing.metricSigmaS);
    V[k] = gsmooth(fillGaps(R.V.slice(k * N, (k + 1) * N), gap), fps * cfg.smoothing.visSigmaS);
  }
  // wall coordinates = image coordinates minus accumulated camera motion (typed-array map keeps float32)
  const oX = gsmooth(R.OX, fps * cfg.smoothing.drawSigmaS), oY = gsmooth(R.OY, fps * cfg.smoothing.drawSigmaS);
  const XW = X.map((a) => a.map((v, i) => v - oX[i])), YW = Y.map((a) => a.map((v, i) => v - oY[i]));
  const XSW = XS.map((a) => a.map((v, i) => v - oX[i])), YSW = YS.map((a) => a.map((v, i) => v - oY[i]));
  // metric scale from trunk length, ignoring close-ups / far shots
  const torso = new Float32Array(N);
  for (let i = 0; i < N; i++) torso[i] = Math.hypot(mid(XS, 11, 12, i) - mid(XS, 23, 24, i), mid(YS, 11, 12, i) - mid(YS, 23, 24, i));
  const tMed = pct(torso, 0.5);
  const torsoPx = pct(torso.map((v) => v > cfg.scale.trunkBandLo * tMed && v < cfg.scale.trunkBandHi * tMed ? v : NaN), cfg.scale.trunkPercentile) || vh * 0.15;
  const heightM = (heightCm || 170) / 100;
  const mpp = cfg.scale.trunkToStature * heightM / torsoPx;
  // centre of mass in wall coordinates
  const comX = new Float32Array(N), comY = new Float32Array(N), cxs = new Float32Array(N), cys = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = comAt(XW, YW, i); comX[i] = a[0]; comY[i] = a[1];
    const b = comAt(XSW, YSW, i); cxs[i] = b[0]; cys[i] = b[1];
  }
  const vx = deriv(cxs, fps), vy = deriv(cys, fps), speed = new Float32Array(N);
  for (let i = 0; i < N; i++) speed[i] = Math.hypot(vx[i], vy[i]) * mpp;
  const valid = new Uint8Array(N);
  for (let i = 0; i < N; i++) valid[i] = isFinite(cxs[i]) ? 1 : 0;
  const moving = new Uint8Array(N);
  for (let i = 0; i < N; i++) moving[i] = valid[i] && speed[i] > cfg.moving.speedMs ? 1 : 0;
  cleanRuns(moving, Math.round(fps * cfg.moving.minRunS));
  for (let i = 0; i < N; i++) if (!valid[i]) moving[i] = 0;
  const ang = ANGLES.map(([a, b, c]) => { const o = new Float32Array(N); for (let i = 0; i < N; i++) o[i] = angleAt(X[a][i], Y[a][i], X[b][i], Y[b][i], X[c][i], Y[c][i]); return o; });
  return { X, Y, V, XS, YS, XW, YW, XSW, YSW, oX, oY, torso, torsoPx, mpp, comX, comY, cxs, cys, vx, vy, speed, valid, moving, ang };
}
