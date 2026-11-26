// M08 · core/results — per-attempt result: last (highest) hand hold and sent / not sent.
// Gym: both hands matched at the route's top level for >= 1 s (or top-out). Rock: top-out only.
// User overrides always win. Ported 1:1 from v0.2 process().

import { CONFIG } from '../../config';
import type { Attempt, Edits, Env, F32, Hold, LimbKey, Send } from '../../types';

export function resolveResults(
  attempts: Attempt[], holds: Hold[], endPos: Record<LimbKey, { x: F32; y: F32 }>,
  floorY: number, mpp: number, N: number, fps: number, env: Env, edits: Edits, cfg = CONFIG.send,
): Send[] {
  const handH = holds.filter((h) => h.kind === 'hand');
  const routeTopY = handH.length ? Math.min(...handH.map((h) => h.y)) : NaN;
  const sends: Send[] = [];
  for (const a of attempts) {
    const hh = handH.filter((h) => h.i0 >= a.i0 - fps * cfg.lastHoldLeadS && h.i0 <= a.i1);
    const last = hh.length ? hh.reduce((b, h) => (h.y < b.y ? h : b)) : null;
    a.lastHold = last; a.lastHoldM = last ? (floorY - last.y) * mpp : NaN;
    // matched on top: both hands at the route's top level and together, sustained.
    // Not tied to one hold entry — a big top hold gets split into several by re-grips.
    let match = -1, run = 0, best = 0;
    if (last && isFinite(routeTopY)) {
      for (let i = a.i0; i <= Math.min(N - 1, a.i1); i++) {
        const L = [endPos.LH.x[i], endPos.LH.y[i]], R = [endPos.RH.x[i], endPos.RH.y[i]];
        const ok = Math.abs(L[1] - routeTopY) * mpp < cfg.topLevelM && Math.abs(R[1] - routeTopY) * mpp < cfg.topLevelM && Math.hypot(L[0] - R[0], L[1] - R[1]) * mpp < cfg.handsApartM;
        if (ok) { run++; if (run > best) { best = run; match = i - run + 1; } } else run = 0;
      }
    }
    const matchedTop = best >= fps * cfg.matchS;
    // the top hold of a send is the one both hands matched on (camera drift can make a later,
    // lower hold look higher)
    if (matchedTop) {
      let mx = 0, my = 0, c = 0;
      for (let i = match; i < Math.min(N, match + best); i++) { mx += endPos.LH.x[i] + endPos.RH.x[i]; my += endPos.LH.y[i] + endPos.RH.y[i]; c += 2; }
      mx /= c; my /= c;
      const cand = hh.length ? hh : handH;
      let bestH: Hold | null = null, bd = Infinity;
      for (const h of cand) { const d = Math.hypot(h.x - mx, h.y - my); if (d < bd) { bd = d; bestH = h; } }
      if (bestH && bd * mpp < cfg.topHoldSearchM) { a.lastHold = bestH; a.lastHoldM = (floorY - bestH.y) * mpp; }
    }
    const auto = env === 'rock' ? a.end === 'top-out' : (matchedTop || a.end === 'top-out');
    const ov = edits.attemptResult[a.n];
    a.sentAuto = auto; a.sent = ov === 'sent' ? true : ov === 'fail' ? false : auto; a.override = ov || 'auto';
    const useMatch = matchedTop && env !== 'rock';
    a.sendI = a.sent ? (useMatch ? match : (last ? last.i0 : a.i1 - 1)) : null;
    if (a.sent) sends.push({ att: a.n, i: Math.max(a.i0, Math.min(a.i1 - 1, a.sendI!)), hold: a.lastHold, how: useMatch ? 'matched top hold' : a.end === 'top-out' ? 'topped out' : 'marked sent' });
  }
  return sends;
}
