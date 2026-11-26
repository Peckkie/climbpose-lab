// core/pipeline — runs the analysis core in order and returns everything render/export/history need.
// Pure: no DOM, no global state. Same order as v0.2 process() so results match.
//   cleanup → kinematics → floor → attempts → motion metrics → holds → results → crux → load → scores

import { CONFIG } from '../config';
import type { Analysis, Edits, Env, Metrics, RawTrack, Settings } from '../types';
import { fillAll, gsmooth, pct } from './signal';
import { rejectOutliers, fixLeftRight, type Cleaned, type LRResult } from './cleanup';
import { buildKinematics } from './kinematics';
import { estimateFloor, detectAttempts, detectHolds, holdCounts } from './segmentation';
import { computeMotionMetrics, flowScore } from './metrics';
import { resolveResults } from './results';
import { findCruxes, addLoadCues } from './crux';
import { solveLoad, loadSummary } from './load';

export const NO_EDITS: Edits = { add: [], remove: [], attemptResult: {} };

/** Cache for the expensive cleanup steps, so edits (hold tags, overrides, weight) re-run fast. */
export interface PipelineCache { clean?: Cleaned; lr?: LRResult | null; lrFix?: boolean; }

export interface PipelineInput {
  raw: RawTrack;
  settings: Settings;
  env: Env;
  edits?: Edits;
  cache?: PipelineCache;
}

export function runPipeline({ raw, settings, env, edits = NO_EDITS, cache = {} }: PipelineInput): Analysis {
  const { N, fps, vw, vh } = raw;
  // M04 cleanup (cached)
  if (!cache.clean) cache.clean = rejectOutliers(raw);
  if (cache.lr === undefined || cache.lrFix !== settings.lrFix) {
    cache.lr = settings.lrFix ? fixLeftRight(cache.clean) : null;
    cache.lrFix = settings.lrFix;
  }
  const track = cache.lr ? { ...raw, X: cache.lr.X, Y: cache.lr.Y, V: cache.lr.V } : { ...raw, X: cache.clean.X, Y: cache.clean.Y, V: cache.clean.V };
  // M06 kinematics
  const k = buildKinematics(track, settings.heightCm);
  // M07 floor + attempts
  const fl = estimateFloor(k);
  const { attempts, onWall, comH } = detectAttempts(k, fl, fps);
  // M09 motion metrics (before holds, as in v0.2)
  const mm = computeMotionMetrics(k, attempts, onWall, fps);
  const M = mm.M as Metrics;
  // M07 holds + support masks
  const { holds, supp, endPos } = detectHolds(k, fl.floorY, fps, edits);
  const hc = holdCounts(holds);
  Object.assign(M, hc); M.footHand = hc.handMoves ? hc.footMoves / hc.handMoves : NaN;
  // M08 results
  const sends = resolveResults(attempts, holds, endPos, fl.floorY, k.mpp, N, fps, env, edits);
  M.sends = sends.length;
  // M10 crux
  const cruxes = findCruxes(k, attempts, holds, fps);
  M.cruxes = cruxes.length;
  // M11 load
  const L = solveLoad(k, supp, endPos, settings.weightKg, settings.wallDeg);
  Object.assign(M, loadSummary(L, mm.use, settings.wallDeg));
  addLoadCues(cruxes, L.handShare);
  // M09 scores
  const { sc, flow } = flowScore(M);
  M.flow = flow;
  // camera follow path for the renderer
  const camX = gsmooth(fillAll(k.comX.map((v, i) => v + k.oX[i])), fps * CONFIG.camera.followSigmaS);
  const camY = gsmooth(fillAll(k.comY.map((v, i) => v + k.oY[i])), fps * CONFIG.camera.followSigmaS);
  for (let i = 0; i < N; i++) { if (!isFinite(camX[i])) camX[i] = vw / 2; if (!isFinite(camY[i])) camY[i] = vh / 2; }
  const vmax = Math.max(0.6, pct(k.speed, 0.97) || 1);
  M.lrSwapFrames = cache.lr ? cache.lr.swaps : null;
  M.rejectedFrames = cache.clean.rejected;
  M.floor = fl.info;
  M.cameraTravelPx = Math.round(Math.hypot(k.oX[N - 1], k.oY[N - 1]));
  return {
    env, N, fps, vw, vh, t0: raw.t0, t1: raw.t1,
    X: k.X, Y: k.Y, XW: k.XW, YW: k.YW, V: k.V, oX: k.oX, oY: k.oY,
    mpp: k.mpp, torsoPx: k.torsoPx,
    comX: k.comX, comY: k.comY, cxs: k.cxs, cys: k.cys, speed: k.speed, vmax,
    moving: k.moving, valid: k.valid, ang: k.ang,
    onWall, comH, footH: fl.footH, y0: mm.y0,
    holds, attempts, sends, cruxes,
    load: L.load, tq: L.tq, handShare: L.handShare,
    M, sc, camX, camY,
  };
}
