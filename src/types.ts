// Data contracts shared across modules (see docs/ARCHITECTURE.md §5).
// Field names of `Analysis` deliberately match v0.2's `S.D` so the renderer can be ported without renames.

export type F32 = Float32Array;
export type Env = 'gym' | 'rock';
export type LimbKey = 'LH' | 'RH' | 'LF' | 'RF';

/** Output of the pose stage (M02) + camera stage (M03). Flat arrays: index = landmark*N + frame. */
export interface RawTrack {
  N: number; fps: number; t0: number; t1: number;
  vw: number; vh: number;          // video size after rotation
  X: F32; Y: F32; V: F32;          // [33*N] image px / visibility
  OX: F32; OY: F32;                // [N] camera translation (px): image = [CA −CB; CB CA]·wall + (OX, OY)
  CA?: F32; CB?: F32;              // [N] camera scale·cos / scale·sin (zoom, roll); absent = translation only
}

export interface Settings {
  heightCm: number;
  weightKg: number | null;         // null = unknown → assumed (flagged)
  wallDeg: number;                 // 0 vertical, + overhang, − slab
  lrFix: boolean;
}

/** One placement of a hand / foot. `n` = physical hold number (first touch order, per kind):
 *  re-grips and matches on the same hold share it. */
export interface Hold {
  n?: number; kind: 'hand' | 'foot'; limb: string;
  x: number; y: number; i0: number; i1: number; manual?: boolean;
}

export interface Edits {
  add: Hold[];
  remove: { x: number; y: number; kind: 'hand' | 'foot' }[];
  attemptResult: Record<number, 'sent' | 'fail'>;
}

export type AttemptEnd = 'down-climb' | 'fall / jump-off' | 'top-out' | 'ongoing';

export interface Attempt {
  n: number; i0: number; i1: number; dur: number;
  highFootM: number; highComM: number; end: AttemptEnd;
  lastHold?: Hold | null; lastHoldM?: number;
  sentAuto?: boolean; sent?: boolean; override?: 'auto' | 'sent' | 'fail'; sendI?: number | null;
}

export interface Send { att: number; i: number; hold: Hold | null | undefined; how: string; }

export interface Cue { bad: 0 | 1; t: string; }

export interface Crux {
  lastHold: Hold | null | undefined; lastHoldM: number | undefined;
  att: number; i: number; hand: 0 | 1; leg: 0 | 1;
  knee: number; elbow: number; otherElbow: number; hipPct: number; ext: number; comUp: number;
  target: { x: number; y: number; distM: number } | null;
  cues: Cue[]; tips: string[]; end: AttemptEnd; handShare?: number;
}

export interface FloorInfo { baseAboveAllM: number; used: 'wall base' | 'all frames'; }

export interface Metrics {
  attempts: number; coverage: number; time: number;
  pathM: number; gie: number; straightness: number;
  ascentM: number; vSpeed: number; highFootM: number;
  immobility: number; straightArm: number; ldlj: number; moves: number;
  handHolds: number; footHolds: number;            // distinct physical holds
  handMoves: number; footMoves: number; footHand: number; // placements, not counting a limb re-gripping the same hold
  sends: number; cruxes: number;
  handShare: number; peakHandKg: number; peakShoulderNm: number; supportHist: number[];
  highLoadPct: number; bodyKg: number; bodyKgAssumed: boolean; wallDeg: number;
  flow: number;
  lrSwapFrames: { shoulders: number; hips: number; arms: number; legs: number } | null;
  rejectedFrames: number; floor: FloorInfo; cameraTravelPx: number;
}

export interface Scores { fluency: number; path: number; arms: number; feet: number; }

export type LoadTrack = Record<LimbKey, F32>;
export type TorqueTrack = Record<'shL' | 'shR' | 'elL' | 'elR' | 'hipL' | 'hipR' | 'knL' | 'knR', F32>;

/** Everything the renderer / exporter / history need. Output of core/pipeline. */
export interface Analysis {
  env: Env;
  N: number; fps: number; vw: number; vh: number; t0: number; t1: number;
  X: F32[]; Y: F32[]; XW: F32[]; YW: F32[]; V: F32[]; oX: F32; oY: F32; cA?: F32; cB?: F32; // camera: see RawTrack
  mpp: number; torsoPx: number;
  comX: F32; comY: F32; cxs: F32; cys: F32; speed: F32; vmax: number;
  moving: Uint8Array; valid: Uint8Array; ang: F32[];
  onWall: Uint8Array; comH: F32; footH: F32; y0: number;
  holds: Hold[]; attempts: Attempt[]; sends: Send[]; cruxes: Crux[];
  load: LoadTrack; tq: TorqueTrack; handShare: F32;
  M: Metrics; sc: Scores; camX: F32; camY: F32;
}
