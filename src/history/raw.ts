// Compact, JSON-safe form of a RawTrack (rounded ints; null = no pose). Same layout as the pose
// fixtures in tests/fixtures, so saved sessions, exported files and fixtures are interchangeable.
import type { RawTrack } from '../types';

export interface EncodedRaw {
  N: number; fps: number; t0: number; t1: number; width: number; height: number;
  scale: { xy: number; vis: number };
  x: (number | null)[]; y: (number | null)[]; vis: (number | null)[]; ox: (number | null)[]; oy: (number | null)[];
  camera?: 'similarity/1'; ca?: (number | null)[]; cb?: (number | null)[]; // scale 1e5
}

const XY = 10, VIS = 1000, CAM = 1e5;

export function encodeRaw(R: RawTrack): EncodedRaw {
  const r1 = (v: number) => (isFinite(v) ? Math.round(v * XY) : null), r3 = (v: number) => (isFinite(v) ? Math.round(v * VIS) : null);
  return {
    N: R.N, fps: R.fps, t0: R.t0, t1: R.t1, width: R.vw, height: R.vh, scale: { xy: XY, vis: VIS },
    x: Array.from(R.X, r1), y: Array.from(R.Y, r1), vis: Array.from(R.V, r3), ox: Array.from(R.OX, r1), oy: Array.from(R.OY, r1),
    ...(R.CA && R.CB ? { camera: 'similarity/1' as const, ca: Array.from(R.CA, (v) => Math.round(v * CAM)), cb: Array.from(R.CB, (v) => Math.round(v * CAM)) } : {}),
  };
}

export function decodeRaw(f: EncodedRaw): RawTrack {
  const s = f.scale.xy, sv = f.scale.vis;
  const dec = (a: (number | null)[]) => Float32Array.from(a, (q) => (q === null ? NaN : q / s));
  return {
    N: f.N, fps: f.fps, t0: f.t0, t1: f.t1, vw: f.width, vh: f.height,
    X: dec(f.x), Y: dec(f.y), V: Float32Array.from(f.vis, (q) => (q === null ? 0 : q / sv)),
    OX: dec(f.ox), OY: dec(f.oy),
    ...(f.ca && f.cb ? { CA: Float32Array.from(f.ca, (q) => (q === null ? 1 : q / CAM)), CB: Float32Array.from(f.cb, (q) => (q === null ? 0 : q / CAM)) } : {}),
  };
}
