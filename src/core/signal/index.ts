// M05 · core/signal — generic signal helpers (no climbing knowledge, no DOM).
// Ported 1:1 from v0.2 index.html; Float32Array is kept wherever v0.2 used it so results match bit-for-bit.

export type F32 = Float32Array;

export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Linear-interpolate NaN runs of length <= maxGap that have values on both sides (in place). */
export function fillGaps(a: F32, maxGap: number): F32 {
  const n = a.length;
  let i = 0;
  while (i < n) {
    if (!isNaN(a[i])) { i++; continue; }
    let j = i;
    while (j < n && isNaN(a[j])) j++;
    if (i > 0 && j < n && j - i <= maxGap) {
      const x0 = a[i - 1], x1 = a[j];
      for (let k = i; k < j; k++) a[k] = x0 + (x1 - x0) * (k - i + 1) / (j - i + 1);
    }
    i = j;
  }
  return a;
}

/** Nearest-value fill (forward then backward) — used for camera follow paths. */
export function fillAll(a: ArrayLike<number>): F32 {
  const n = a.length, o = Float32Array.from(a);
  let last = NaN;
  for (let i = 0; i < n; i++) { if (isNaN(o[i])) o[i] = last; else last = o[i]; }
  last = NaN;
  for (let i = n - 1; i >= 0; i--) { if (isNaN(o[i])) o[i] = last; else last = o[i]; }
  return o;
}

/** NaN-aware Gaussian smoothing; NaN inputs stay NaN. */
export function gsmooth(a: ArrayLike<number>, sigma: number): F32 {
  const n = a.length, out = new Float32Array(n);
  if (sigma < 0.5) { out.set(a); return out; }
  const r = Math.ceil(sigma * 3), w = new Float32Array(2 * r + 1);
  for (let k = -r; k <= r; k++) w[k + r] = Math.exp(-k * k / (2 * sigma * sigma));
  for (let i = 0; i < n; i++) {
    if (isNaN(a[i])) { out[i] = NaN; continue; }
    let s = 0, ws = 0;
    for (let k = -r; k <= r; k++) {
      const j = i + k;
      if (j < 0 || j >= n) continue;
      const v = a[j];
      if (isNaN(v)) continue;
      s += v * w[k + r]; ws += w[k + r];
    }
    out[i] = s / ws;
  }
  return out;
}

/** Central difference × fps, one-sided at edges/gaps. */
export function deriv(a: ArrayLike<number>, fps: number): F32 {
  const n = a.length, o = new Float32Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const p = i > 0 ? a[i - 1] : NaN, q = i < n - 1 ? a[i + 1] : NaN;
    if (!isNaN(p) && !isNaN(q)) o[i] = (q - p) * fps / 2;
    else if (!isNaN(q) && !isNaN(a[i])) o[i] = (q - a[i]) * fps;
    else if (!isNaN(p) && !isNaN(a[i])) o[i] = (a[i] - p) * fps;
  }
  return o;
}

/** Percentile (floor index) over finite values; NaN if none. */
export function pct(arr: ArrayLike<number>, p: number): number {
  const v = Array.from(arr).filter((x) => isFinite(x)).sort((a, b) => a - b);
  return v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : NaN;
}

/** Median of finite values (upper median), NaN if none. */
export function median(a: number[]): number {
  const v = a.filter(isFinite).sort((p, q) => p - q);
  return v.length ? v[v.length >> 1] : NaN;
}

export type Pt = [number, number];

/** Monotone-chain convex hull. */
export function hull(pts: Pt[]): Pt[] {
  pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Pt[] = [], up: Pt[] = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  up.pop(); lo.pop();
  return lo.concat(up);
}

/** Angle ABC in degrees. */
export function angleAt(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const ux = ax - bx, uy = ay - by, vx = cx - bx, vy = cy - by;
  const d = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (!d) return NaN;
  return Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / d))) * 180 / Math.PI;
}

/** Boolean-run cleanup: flip interior runs shorter than minLen to the previous value (in place). */
export function cleanRuns(b: Uint8Array, minLen: number): Uint8Array {
  const n = b.length;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && b[j] === b[i]) j++;
    if (j - i < minLen && i > 0 && j < n) { for (let k = i; k < j; k++) b[k] = b[i - 1]; }
    i = j;
  }
  return b;
}

/** [start, end) index ranges where mask is truthy. */
export function runs(mask: ArrayLike<number>): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  const n = mask.length;
  while (i < n) {
    if (!mask[i]) { i++; continue; }
    let j = i;
    while (j < n && mask[j]) j++;
    out.push([i, j]);
    i = j;
  }
  return out;
}
