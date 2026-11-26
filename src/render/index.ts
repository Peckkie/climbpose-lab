// M12 render — draws one frame: live preview while analysing, the analysed frame (LAYERS),
// or the end sequence (route map → report card).
import { lerp } from '../util';
import { drawBackground, viewAt } from './draw';
import { drawSkeleton } from './skeleton';
import { STYLES } from './style';
import { LAYERS } from './layers';
import { drawRoute, drawSummary, endPhase, routeAttempt } from './endcards';
import type { FrameCtx, Renderer, TFn, PFn } from './types';

export * from './types';
export { STYLES, type StyleName } from './style';
export { layoutCanvas, viewAt } from './draw';
export { ROUTE_SEC, ROUTE_BUILD, routeAttempt } from './endcards';

/** Draw at video time t (default: the video's current time). t = -1: live preview during analysis. */
export function drawFrame(r: Renderer, tOverride?: number): void {
  const { cv, ctx, video, s } = r;
  const W = cv.width, H = cv.height, u = Math.min(W, H) / 1080, st = STYLES[s.style], D = s.D;
  if (!video.videoWidth) { ctx.fillStyle = '#050506'; ctx.fillRect(0, 0, W, H); return; }
  if (tOverride === -1 || !D) {
    const v = viewAt(r, 0, 0); drawBackground(r, v);
    const lp = s.livePose;
    if (lp) drawSkeleton(ctx, (k) => [v.ox + lp[k].x * v.s, v.oy + lp[k].y * v.s, lp[k].v], u, st);
    if (s.busy) { ctx.fillStyle = st.accent; ctx.font = `700 ${26 * u}px "Space Grotesk"`; ctx.fillText('SCANNING…', 28 * u, 48 * u); }
    return;
  }
  // end of clip: ROUTE MAP card, then the report card (on top of the finished route)
  const ph = endPhase(s);
  if (ph.route != null) { drawRoute(r, ph.route, u, st); return; }
  if (ph.summary > 0 && routeAttempt(D)) { drawRoute(r, 1, u, st); drawSummary(r, ph.summary, u, st); return; }
  const t = tOverride != null ? tOverride : video.currentTime;
  if (t < D.t0 - 0.05 || t > D.t1 + 0.05) { drawBackground(r, viewAt(r, 0, 0)); return; }
  const f = Math.max(0, Math.min(D.N - 1.001, (t - D.t0) * D.fps - 0.25)), i = Math.floor(f), a = f - i, i1 = Math.min(i + 1, D.N - 1);
  const v = viewAt(r, i, a);
  const T: TFn = (x, y) => [v.ox + x * v.s, v.oy + y * v.s];
  const cox = lerp(D.oX[i], D.oX[i1], a), coy = lerp(D.oY[i], D.oY[i1], a);
  const Tw: TFn = (x, y) => T(x + cox, y + coy); // wall → current image
  const P: PFn = (k) => {
    const x = lerp(D.X[k][i], D.X[k][i1], a), y = lerp(D.Y[k][i], D.Y[k][i1], a);
    if (!isFinite(x) || !isFinite(y)) return null;
    const q = T(x, y); return [q[0], q[1], lerp(D.V[k][i], D.V[k][i1], a)];
  };
  drawBackground(r, v);
  const fc: FrameCtx = { r, ctx, D, st, u, W, H, t, f, i, a, i1, v, T, Tw, P, summary: ph.summary };
  for (const L of LAYERS) if (L.on(fc)) L.draw(fc);
}
