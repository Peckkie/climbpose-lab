// M07 · core/segmentation — floor level, attempts (on/off the wall), hand/foot holds, support masks.
// Ported 1:1 from v0.2 process().

import { CONFIG } from '../../config';
import type { Attempt, AttemptEnd, Edits, F32, FloorInfo, Hold, LimbKey } from '../../types';
import { cleanRuns, deriv, pct, runs } from '../signal';
import type { Kinematics } from '../kinematics';

/** Hand/foot end effectors: averaged landmarks. */
export const ENDS: [LimbKey, number[], 'hand' | 'foot'][] = [['LH', [15, 17, 19], 'hand'], ['RH', [16, 18, 20], 'hand'], ['LF', [29, 31], 'foot'], ['RF', [30, 32], 'foot']];

export interface Floor {
  floorY: number; info: FloorInfo; footH: F32; lowFoot: F32;
  handUp: (i: number) => boolean;
}

/**
 * Floor = where the feet stand at the BASE OF THE WALL. The mat is a plane seen in perspective
 * (feet nearer the camera look lower), so take the lowest feet while a hand is up at chest height
 * and the climber is at wall distance; fall back to all at-wall frames if implausible.
 */
export function estimateFloor(k: Kinematics, cfg = CONFIG.floor): Floor {
  const { YSW, torso, torsoPx, mpp } = k, N = torso.length;
  const footY = (ids: number[]) => { const o = new Float32Array(N); for (let i = 0; i < N; i++) { let y = 0; for (const j of ids) y += YSW[j][i]; o[i] = y / ids.length; } return o; };
  const fL = footY([29, 31]), fR = footY([30, 32]), lowFoot = new Float32Array(N);
  for (let i = 0; i < N; i++) lowFoot[i] = Math.max(fL[i], fR[i]);
  const handUp = (i: number) => { const hy = (YSW[23][i] + YSW[24][i]) / 2, t = torso[i] || torsoPx; return Math.min(YSW[15][i], YSW[16][i]) < hy - cfg.handUpTrunks * t; };
  const atWallBand = (i: number) => torso[i] > cfg.atWallLo * torsoPx && torso[i] < cfg.atWallHi * torsoPx;
  const atWall = lowFoot.map((v, i) => atWallBand(i) ? v : NaN);
  const floorAll = pct(atWall, cfg.percentile) || pct(lowFoot, cfg.percentile);
  const floorBase = pct(lowFoot.map((v, i) => handUp(i) && atWallBand(i) ? v : NaN), cfg.percentile);
  const floorY = isFinite(floorBase) && (floorAll - floorBase) * mpp < cfg.maxBaseAboveAllM ? floorBase : floorAll;
  const info: FloorInfo = { baseAboveAllM: +((floorAll - floorBase) * mpp).toFixed(2), used: floorY === floorBase ? 'wall base' : 'all frames' };
  const footH = new Float32Array(N);
  for (let i = 0; i < N; i++) footH[i] = (floorY - lowFoot[i]) * mpp;
  return { floorY, info, footH, lowFoot, handUp };
}

export interface AttemptsOut { attempts: Attempt[]; onWall: Uint8Array; comH: F32; }

/**
 * On the wall = both feet off the floor; an attempt only STARTS once a hand is above chest height,
 * continues while the feet stay up, and short gaps with a hand still up are merged (low traverse /
 * sit start). End = fall/jump-off (fast drop), ongoing (clip ends), top-out, or down-climb.
 */
export function detectAttempts(k: Kinematics, fl: Floor, fps: number, cfg = CONFIG.attempt): AttemptsOut {
  const { valid, cys, vy, mpp } = k, { footH, handUp, floorY } = fl, N = valid.length;
  const onWall = new Uint8Array(N);
  for (let i = 0; i < N; i++) onWall[i] = valid[i] && footH[i] > cfg.feetUpM ? 1 : 0;
  cleanRuns(onWall, Math.round(fps * cfg.cleanRunS));
  for (const [a, b] of runs(onWall)) { let s0 = a; while (s0 < b && !handUp(s0)) s0++; for (let i = a; i < s0; i++) onWall[i] = 0; }
  const comH = new Float32Array(N);
  for (let i = 0; i < N; i++) comH[i] = isFinite(cys[i]) ? (floorY - cys[i]) * mpp : NaN;
  const pieces: [number, number][] = [];
  for (const [a, b] of runs(onWall)) {
    const last = pieces[pieces.length - 1];
    if (last && a - last[1] < fps * cfg.mergeGapS) {
      let up = 0; for (let i = last[1]; i < a; i++) if (handUp(i)) up++;
      if (up >= cfg.mergeHandUpShare * (a - last[1])) { for (let i = last[1]; i < a; i++) onWall[i] = 1; last[1] = b; continue; }
    }
    pieces.push([a, b]);
  }
  const attempts: Attempt[] = [];
  for (const [a, b] of pieces) {
    if (b - a < fps * cfg.minDurS) { for (let i = a; i < b; i++) onWall[i] = 0; continue; }
    let hiFoot = 0, hiCom = -1e9, drop = 0;
    for (let i = a; i < b; i++) { hiFoot = Math.max(hiFoot, footH[i] || 0); if (isFinite(comH[i])) hiCom = Math.max(hiCom, comH[i]); }
    for (let i = Math.max(a, b - Math.round(fps * cfg.dropLookbackS)); i < Math.min(N, b + Math.round(fps * cfg.dropLookaheadS)); i++) if (isFinite(vy[i])) drop = Math.max(drop, vy[i] * mpp);
    let endFoot = 0, ne = 0;
    for (let i = Math.max(a, b - Math.round(fps * cfg.topOutEndS)); i < b; i++) if (isFinite(footH[i])) { endFoot += footH[i]; ne++; }
    endFoot = ne ? endFoot / ne : 0;
    const end: AttemptEnd = drop > cfg.dropMs ? 'fall / jump-off' : b >= N - 1 ? 'ongoing' : (hiFoot > cfg.topOutMinFootM && endFoot > hiFoot - cfg.topOutWithinM) ? 'top-out' : 'down-climb';
    attempts.push({ n: attempts.length + 1, i0: a, i1: b, dur: (b - a) / fps, highFootM: hiFoot, highComM: hiCom, end });
  }
  return { attempts, onWall, comH };
}

export interface HoldsOut {
  holds: Hold[];
  supp: Record<LimbKey, Uint8Array>;
  endPos: Record<LimbKey, { x: F32; y: F32 }>;
}

/**
 * Holds = hand/foot end effector still for >= minDurS (hand on hip = chalking, foot on the floor
 * excluded; re-grips nearby merged). Also builds the looser support masks used by the load model.
 * Manual edits (hold tagging) are applied before numbering.
 */
export function detectHolds(k: Kinematics, floorY: number, fps: number, edits: Edits, suppSpeedMs: number = CONFIG.load.supportSpeedMs, cfg = CONFIG.holds): HoldsOut {
  const { XSW, YSW, V, mpp } = k, N = V[0].length;
  const holds: Hold[] = [];
  const hipY = (i: number) => (YSW[23][i] + YSW[24][i]) / 2;
  const supp = {} as Record<LimbKey, Uint8Array>, endPos = {} as Record<LimbKey, { x: F32; y: F32 }>;
  for (const [name, ids, kind] of ENDS) {
    const ex = new Float32Array(N), ey = new Float32Array(N), ev = new Float32Array(N);
    for (let i = 0; i < N; i++) { let x = 0, y = 0, v = 0; for (const j of ids) { x += XSW[j][i]; y += YSW[j][i]; v += V[j][i]; } ex[i] = x / ids.length; ey[i] = y / ids.length; ev[i] = v / ids.length; }
    const dx = deriv(ex, fps), dy = deriv(ey, fps);
    const stillM = new Uint8Array(N);
    for (let i = 0; i < N; i++) stillM[i] = isFinite(dx[i]) && Math.hypot(dx[i], dy[i]) * mpp < (kind === 'hand' ? cfg.handStillMs : cfg.footStillMs) && ev[i] > cfg.minVis ? 1 : 0;
    cleanRuns(stillM, Math.round(fps * cfg.cleanRunS));
    // support mask for the load model: no visibility gate (feet are often low-visibility from behind)
    const sm = new Uint8Array(N);
    for (let i = 0; i < N; i++) sm[i] = isFinite(dx[i]) && Math.hypot(dx[i], dy[i]) * mpp < suppSpeedMs ? 1 : 0;
    cleanRuns(sm, Math.round(fps * CONFIG.load.supportCleanS));
    supp[name] = sm;
    endPos[name] = { x: ex, y: ey };
    let prev: Hold | null = null;
    for (const [a, b] of runs(stillM)) {
      if (b - a < fps * cfg.minDurS) continue;
      const xs: number[] = [], ys: number[] = [];
      for (let i = a; i < b; i++) { xs.push(ex[i]); ys.push(ey[i]); }
      xs.sort((p, q) => p - q); ys.sort((p, q) => p - q);
      const hx = xs[xs.length >> 1], hy = ys[ys.length >> 1];
      if (kind === 'hand' && hy > hipY((a + b) >> 1)) continue;          // hand on hip = chalking
      if (kind === 'foot' && (floorY - hy) * mpp < cfg.footMinAboveFloorM) continue; // foot on the mat
      if (prev && Math.hypot(hx - prev.x, hy - prev.y) * mpp < cfg.mergeDistM && (a - prev.i1) < fps * cfg.mergeGapS) { prev.i1 = b; continue; }
      prev = { limb: name, kind, x: hx, y: hy, i0: a, i1: b };
      holds.push(prev);
    }
  }
  if (edits.add.length || edits.remove.length) {
    for (const r of edits.remove) { const j = holds.findIndex((h) => h.kind === r.kind && Math.hypot(h.x - r.x, h.y - r.y) * mpp < cfg.editMatchM); if (j >= 0) holds.splice(j, 1); }
    for (const a of edits.add) holds.push({ ...a });
  }
  holds.sort((p, q) => p.i0 - q.i0);
  let hn = 0, fn = 0;
  for (const h of holds) h.n = h.kind === 'hand' ? ++hn : ++fn;
  return { holds, supp, endPos };
}
