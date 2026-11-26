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
  footHL: F32; footHR: F32;   // each foot's height above the floor (m)
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
  const footH = new Float32Array(N), footHL = new Float32Array(N), footHR = new Float32Array(N);
  for (let i = 0; i < N; i++) { footH[i] = (floorY - lowFoot[i]) * mpp; footHL[i] = (floorY - fL[i]) * mpp; footHR[i] = (floorY - fR[i]) * mpp; }
  return { floorY, info, footH, lowFoot, footHL, footHR, handUp };
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
  // Very low start footholds (a few cm) look like the floor in 2D, so the height rule starts late.
  // Move the start back to the last STEP-UP (a foot rising sharply while a hand is up), as long as
  // both feet stayed clearly off the floor from that moment on.
  for (const [a] of runs(onWall)) {
    const s1 = findStepUp(fl, a, fps, cfg);
    for (let i = s1; i < a; i++) onWall[i] = 1;
  }
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

/** Latest step-up event in the lookback window before `a`, or `a` if none qualifies. */
function findStepUp(fl: Floor, a: number, fps: number, cfg: typeof CONFIG.attempt): number {
  const { footH, footHL, footHR, handUp } = fl, N = footH.length;
  const d = Math.max(1, Math.round(fps * cfg.stepUpWindowS / 2)), lo = Math.max(d, a - Math.round(fps * cfg.stepUpLookbackS));
  for (let i = a - 1; i >= lo; i--) {
    if (!(footH[i] > cfg.stepUpOffFloorM)) return a;   // a foot was on the floor here: stop looking back
    if (!handUp(i) || i + d >= N) continue;
    // the rising foot must start at floor level — a foot moving between holds is not a step-up
    const fromFloorL = footHL[i - d] < cfg.feetUpM && footHL[i + d] - footHL[i - d] >= cfg.stepUpRiseM;
    const fromFloorR = footHR[i - d] < cfg.feetUpM && footHR[i + d] - footHR[i - d] >= cfg.stepUpRiseM;
    if (fromFloorL || fromFloorR) {
      // start at the beginning of the rise (first frame where the lower foot is off the floor)
      let s = i;
      while (s > i - d && footH[s - 1] > cfg.stepUpOffFloorM) s--;
      return s;
    }
  }
  return a;
}

export interface HoldsOut {
  holds: Hold[];
  supp: Record<LimbKey, Uint8Array>;
  endPos: Record<LimbKey, { x: F32; y: F32 }>;
}

/**
 * Holds = hand/foot end effector still for >= minDurS (hand on hip = chalking, foot on the floor
 * excluded; a quick re-grip by the same limb is merged). Each placement is numbered by physical
 * hold (groupHolds), so re-grips and matches share a number. Also builds the looser support masks
 * used by the load model. Manual edits (hold tagging) are applied before numbering.
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
  holds.sort((p, q) => p.i0 - q.i0);
  groupHolds(holds, mpp, cfg.groupDistM);
  if (edits.add.length || edits.remove.length) {
    // removing a hold removes every placement on it (all its re-grips)
    for (const r of edits.remove) {
      let best: Hold | null = null, bd = Infinity;
      for (const h of holds) { if (h.kind !== r.kind) continue; const d = Math.hypot(h.x - r.x, h.y - r.y) * mpp; if (d < bd) { bd = d; best = h; } }
      if (best && bd < cfg.editMatchM) { const g = best.n; for (let j = holds.length - 1; j >= 0; j--) if (holds[j].kind === r.kind && holds[j].n === g) holds.splice(j, 1); }
    }
    for (const a of edits.add) holds.push({ ...a });
    holds.sort((p, q) => p.i0 - q.i0);
    groupHolds(holds, mpp, cfg.groupDistM);
  }
  return { holds, supp, endPos };
}

/** Number placements by physical hold (in first-touch order, per kind): a placement within
 *  `distM` of an existing hold's centre is the same hold. Placements must be sorted by time. */
export function groupHolds(holds: Hold[], mpp: number, distM: number): void {
  const groups: Record<'hand' | 'foot', { x: number; y: number; c: number }[]> = { hand: [], foot: [] };
  for (const h of holds) {
    const gs = groups[h.kind];
    let best = -1, bd = Infinity;
    gs.forEach((g, k) => { const d = Math.hypot(g.x - h.x, g.y - h.y) * mpp; if (d < bd) { bd = d; best = k; } });
    if (best >= 0 && bd < distM) { const g = gs[best]; g.x = (g.x * g.c + h.x) / (g.c + 1); g.y = (g.y * g.c + h.y) / (g.c + 1); g.c++; h.n = best + 1; }
    else { gs.push({ x: h.x, y: h.y, c: 1 }); h.n = gs.length; }
  }
}

/** Distinct holds and moves per kind. A move is a placement, except a limb going back onto the
 *  hold it last held (re-grip, shake-out). Holds must be numbered by groupHolds. */
export function holdCounts(holds: Hold[]): { handHolds: number; footHolds: number; handMoves: number; footMoves: number } {
  const seen = { hand: new Set<number>(), foot: new Set<number>() }, moves = { hand: 0, foot: 0 }, last: Record<string, number> = {};
  for (const h of holds) {
    seen[h.kind].add(h.n!);
    if (h.limb === 'tag' || last[h.limb] !== h.n) moves[h.kind]++;
    if (h.limb !== 'tag') last[h.limb] = h.n!;
  }
  return { handHolds: seen.hand.size, footHolds: seen.foot.size, handMoves: moves.hand, footMoves: moves.foot };
}
