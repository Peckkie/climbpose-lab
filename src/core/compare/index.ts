// Compare attempts — line up two attempts on the same route by how high the climber has got, so
// a frame of one attempt can be shown next to the matching moment of another. Pure.
import type { Attempt, F32 } from '../../types';

type Span = Pick<Attempt, 'i0' | 'i1'>;

/** Running max of CoM height above the floor over an attempt (progress up the route). */
function progress(comH: F32, a: Span): Float32Array {
  const out = new Float32Array(Math.max(0, a.i1 - a.i0));
  let best = -Infinity;
  for (let i = a.i0; i < a.i1; i++) { const h = comH[i]; if (isFinite(h) && h > best) best = h; out[i - a.i0] = best; }
  return out;
}

/** For every frame of attempt a: the frame of attempt b where b first got as high (or -1 if b never
 *  did). Aligns by progress on the route, not by time. */
export function alignByHeight(comH: F32, a: Span, b: Span): Int32Array {
  const pa = progress(comH, a), pb = progress(comH, b), out = new Int32Array(pa.length).fill(-1);
  let j = 0;
  for (let k = 0; k < pa.length; k++) {
    if (!isFinite(pa[k])) continue;
    while (j < pb.length && !(pb[j] >= pa[k])) j++;
    if (j >= pb.length) break; // b never got this high; neither will later (higher) frames
    out[k] = b.i0 + j;
  }
  return out;
}

/** The attempt to compare with: a sent one if there is one, else the one that got highest. */
export function pickGhost(attempts: Attempt[], current: Attempt): Attempt | null {
  const others = attempts.filter((a) => a.n !== current.n);
  if (!others.length) return null;
  const sent = others.filter((a) => a.sent);
  const pool = sent.length ? sent : others;
  return pool.reduce((b, a) => (a.highComM > b.highComM ? a : b));
}
