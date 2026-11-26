// M13 export — data files: summary JSON, per-frame CSV, pose fixture; and the download helper.
import type { Analysis, Env, RawTrack } from '../types';
import type { RouteInfo } from '../route';
import type { EnvScores } from '../environment';

/** Save a blob and keep a link to it in `area` (the downloads list). */
export function download(blob: Blob, name: string, area?: HTMLElement | null): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.className = 'dl'; a.textContent = '⬇ ' + name;
  area?.prepend(a); a.click();
}

export interface SummaryInput {
  D: Analysis; app: string; env: Env; envDetected: Env | null; route: RouteInfo;
  photo: 'upload' | 'frame' | 'auto'; holdEdits: { added: number; removed: number };
  source: string; heightCm: number;
}

export function summaryJson(o: SummaryInput): object {
  const D = o.D;
  return {
    app: o.app, environment: o.env, environment_detected: o.envDetected,
    route: { ...o.route, photo: o.photo, manual_hold_edits: o.holdEdits },
    source: o.source, video: { w: D.vw, h: D.vh, fps_analyzed: D.fps, frames: D.N, t_start: D.t0, t_end: D.t1 },
    climber_height_cm: o.heightCm, meters_per_px: D.mpp,
    metrics: D.M, scores: D.sc,
    cruxes: D.cruxes.map((c) => ({
      attempt: c.att, t: +(D.t0 + c.i / D.fps).toFixed(2), reach_hand: c.hand ? 'R' : 'L', push_leg: c.leg ? 'R' : 'L',
      knee_deg: Math.round(c.knee), elbow_deg: Math.round(c.elbow), hip_pct: Math.round(c.hipPct * 100), reach_pct: Math.round(c.ext * 100),
      com_up_ms: +(+c.comUp).toFixed(2), gap_to_next_hold_cm: c.target ? Math.round(c.target.distM * 100) : null,
      cues: c.cues.map((q) => q.t), tips: c.tips, hand_load_share_pct: isFinite(c.handShare as number) ? Math.round((c.handShare as number) * 100) : null,
    })),
    attempts: D.attempts.map((a) => ({
      sent: a.sent, result_source: a.override, last_hold: a.lastHold ? { n: a.lastHold.n, height_m: +(+(a.lastHoldM as number)).toFixed(2) } : null,
      n: a.n, t_start: +(D.t0 + a.i0 / D.fps).toFixed(2), t_end: +(D.t0 + a.i1 / D.fps).toFixed(2), duration_s: +a.dur.toFixed(2),
      high_foot_m: +a.highFootM.toFixed(2), high_com_m: +a.highComM.toFixed(2), end: a.end,
    })),
    holds: D.holds.map((h) => ({ n: h.n, limb: h.limb, kind: h.kind, x: +(h.x / D.vw).toFixed(4), y: +(h.y / D.vh).toFixed(4), t_start: +(h.i0 / D.fps).toFixed(2), t_end: +(h.i1 / D.fps).toFixed(2) })),
  };
}

export function framesCsv(D: Analysis): string {
  const head = ['frame', 't', 'valid', 'attempt', 'com_x_m', 'com_y_m', 'feet_above_floor_m', 'speed_ms', 'moving', 'elbow_L', 'elbow_R', 'knee_L', 'knee_R'];
  for (let k = 0; k < 33; k++) head.push(`lm${k}_x`, `lm${k}_y`, `lm${k}_vis`);
  const rows = [head.join(',')], r = (v: number) => isFinite(v) ? (+v).toFixed(4) : '';
  for (let i = 0; i < D.N; i++) {
    const row: (string | number)[] = [i, (D.t0 + i / D.fps).toFixed(3), D.valid[i], (D.attempts.find((a) => i >= a.i0 && i < a.i1) || { n: 0 }).n,
      r(D.cxs[i] * D.mpp), r(D.cys[i] * D.mpp), r(D.footH[i]), r(D.speed[i]), D.moving[i], r(D.ang[0][i]), r(D.ang[1][i]), r(D.ang[2][i]), r(D.ang[3][i])];
    for (let k = 0; k < 33; k++) row.push(r(D.X[k][i] / D.vw), r(D.Y[k][i] / D.vh), r(D.V[k][i]));
    rows.push(row.join(','));
  }
  return rows.join('\n');
}

export interface FixtureInput {
  raw: RawTrack; clip: string; createdWith: string; env: Env; envScores: EnvScores | null;
  settings: { heightCm: number; fps: number; model: string; wallDeg: number; weightKg: number | null; cameraCompensation: boolean; lrFix: boolean };
}
/** Pose fixture (raw pose + camera track, rounded) for tests/fixtures/ — see tests/helpers/fixtures.ts. */
export function poseFixture(o: FixtureInput): object {
  const R = o.raw;
  const r1 = (v: number) => isFinite(v) ? Math.round(v * 10) : null, r3 = (v: number) => isFinite(v) ? Math.round(v * 1000) : null;
  return {
    format: 'climbpose.pose/1', clip: o.clip, createdWith: o.createdWith, settings: o.settings,
    env: o.env, envScores: o.envScores, N: R.N, fps: R.fps, t0: R.t0, t1: R.t1, width: R.vw, height: R.vh, scale: { xy: 10, vis: 1000 },
    x: Array.from(R.X, r1), y: Array.from(R.Y, r1), vis: Array.from(R.V, r3), ox: Array.from(R.OX, r1), oy: Array.from(R.OY, r1),
  };
}
