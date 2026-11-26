// 2D similarity transforms (scale + rotation + translation): image = [a −b; b a]·p + (tx, ty).
// Used for the camera model: wall coordinates (first analysed frame) ↔ image of frame i.

export interface Sim { a: number; b: number; tx: number; ty: number; }

export const IDENTITY: Sim = { a: 1, b: 0, tx: 0, ty: 0 };

export const apply = (m: Sim, x: number, y: number): [number, number] => [m.a * x - m.b * y + m.tx, m.b * x + m.a * y + m.ty];

export function invert(m: Sim): Sim {
  const d = m.a * m.a + m.b * m.b, a = m.a / d, b = -m.b / d;
  return { a, b, tx: -(a * m.tx - b * m.ty), ty: -(b * m.tx + a * m.ty) };
}

/** (m2 ∘ m1)(p) = m2(m1(p)) */
export function compose(m2: Sim, m1: Sim): Sim {
  return { a: m2.a * m1.a - m2.b * m1.b, b: m2.b * m1.a + m2.a * m1.b, tx: m2.a * m1.tx - m2.b * m1.ty + m2.tx, ty: m2.b * m1.tx + m2.a * m1.ty + m2.ty };
}

export const scaleOf = (m: Sim): number => Math.hypot(m.a, m.b);

/** Least-squares similarity mapping P[k] → Q[k] (weights optional). Null if degenerate. */
export function fitSimilarity(P: [number, number][], Q: [number, number][], idx?: number[]): Sim | null {
  const ids = idx ?? P.map((_, k) => k), n = ids.length;
  if (n < 2) return null;
  let px = 0, py = 0, qx = 0, qy = 0;
  for (const k of ids) { px += P[k][0]; py += P[k][1]; qx += Q[k][0]; qy += Q[k][1]; }
  px /= n; py /= n; qx /= n; qy /= n;
  let sxx = 0, sab = 0, sba = 0;
  for (const k of ids) {
    const x = P[k][0] - px, y = P[k][1] - py, u = Q[k][0] - qx, v = Q[k][1] - qy;
    sxx += x * x + y * y; sab += x * u + y * v; sba += x * v - y * u;
  }
  if (sxx < 1e-9) return null;
  const a = sab / sxx, b = sba / sxx;
  return { a, b, tx: qx - (a * px - b * py), ty: qy - (b * px + a * py) };
}

/** RANSAC similarity (deterministic): best consensus within `tol`, refit on its inliers. */
export function ransacSimilarity(P: [number, number][], Q: [number, number][], tol: number, iters = 200, seed = 1): { m: Sim; inliers: number[] } | null {
  const n = P.length; if (n < 3) return null;
  let s = seed >>> 0; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  let best: number[] = [];
  const inl = (m: Sim) => { const out: number[] = []; for (let k = 0; k < n; k++) { const [x, y] = apply(m, P[k][0], P[k][1]); if (Math.hypot(x - Q[k][0], y - Q[k][1]) < tol) out.push(k); } return out; };
  for (let it = 0; it < iters; it++) {
    const i = Math.floor(rnd() * n); let j = Math.floor(rnd() * n); if (j === i) j = (j + 1) % n;
    if (Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]) < 8) continue;
    const m = fitSimilarity(P, Q, [i, j]); if (!m) continue;
    const sc = scaleOf(m); if (sc < 0.7 || sc > 1.4) continue;
    const c = inl(m); if (c.length > best.length) best = c;
  }
  if (best.length < 3) return null;
  let m = fitSimilarity(P, Q, best)!;
  const again = inl(m); if (again.length >= best.length) { best = again; m = fitSimilarity(P, Q, best)!; }
  return { m, inliers: best };
}

/** Per-frame camera track: image = [cA −cB; cB cA]·wall + (oX, oY). cA/cB absent = translation only. */
export interface CamTrack { cA?: ArrayLike<number>; cB?: ArrayLike<number>; oX: ArrayLike<number>; oY: ArrayLike<number>; }

export const camAt = (c: CamTrack, i: number): Sim => ({ a: c.cA ? c.cA[i] : 1, b: c.cB ? c.cB[i] : 0, tx: c.oX[i], ty: c.oY[i] });

/** Camera at fractional frame i + t (linear blend of neighbours). */
export function camLerp(c: CamTrack, i: number, i1: number, t: number): Sim {
  const p = camAt(c, i), q = camAt(c, i1), l = (x: number, y: number) => x + (y - x) * t;
  return { a: l(p.a, q.a), b: l(p.b, q.b), tx: l(p.tx, q.tx), ty: l(p.ty, q.ty) };
}

/** Wall → image; exact x + tx for a translation-only camera (keeps old results bit-identical). */
export const wallToImage = (m: Sim, x: number, y: number): [number, number] =>
  m.a === 1 && m.b === 0 ? [x + m.tx, y + m.ty] : apply(m, x, y);

/** Image → wall. */
export const imageToWall = (m: Sim, x: number, y: number): [number, number] =>
  m.a === 1 && m.b === 0 ? [x - m.tx, y - m.ty] : apply(invert(m), x, y);
