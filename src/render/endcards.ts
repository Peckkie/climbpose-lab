// M12 render — end of clip: ROUTE MAP (every placement on the wall, ghost skeletons, CoM path)
// building up, then the report card.
import type { Analysis, Attempt } from '../types';
import { clamp01, fmt } from '../util';
import { camAt, wallToImage } from '../core/signal/similarity';
import { drawBackground, line } from './draw';
import { BONES_C, BONES_L, BONES_R, trailColor, type Style } from './style';
import type { Renderer, ViewState } from './types';

export const ROUTE_SEC = 4.5, ROUTE_BUILD = 2.5, SUMMARY_FADE = 0.5;

type RouteSpan = Pick<Attempt, 'i0' | 'i1'> & Partial<Attempt>;

/** Longest attempt that has holds: the route the map shows (null = no map). */
export function routeAttempt(D: Analysis | null): RouteSpan | null {
  if (!D || !D.holds.length) return null;
  let best: Attempt | null = null;
  for (const a of D.attempts) if (!best || a.i1 - a.i0 > best.i1 - best.i0) best = a;
  return best || { i0: 0, i1: D.N };
}

/** Where we are in the end sequence: route map build-up (0..1) or report card alpha. */
export function endPhase(s: ViewState): { route: number | null; summary: number } {
  if (s.routeProg != null) return { route: s.routeProg, summary: 0 };
  if (s.endCardAlpha != null) return { route: null, summary: s.endCardAlpha };
  if (!s.endCard || !s.D) return { route: null, summary: 0 };
  const dt = (performance.now() - s.endCard) / 1000, hasRoute = !!routeAttempt(s.D);
  if (hasRoute && dt < ROUTE_SEC) return { route: clamp01(dt / ROUTE_BUILD), summary: 0 };
  return { route: null, summary: clamp01((dt - (hasRoute ? ROUTE_SEC : 0)) / SUMMARY_FADE) };
}

/** ROUTE MAP, framed on the route; p (0..1) builds it up in climbing order. */
export function drawRoute(r: Renderer, p: number, u: number, st: Style): void {
  const { cv, ctx, video, s } = r, D = s.D!, E = r.env(), RL = r.route();
  const W = cv.width, H = cv.height, vw = D.vw, vh = D.vh, at = routeAttempt(D)!;
  const i0 = at.i0, i1 = Math.min(at.i1, D.N - 1), iCut = i0 + (i1 - i0) * p;
  // background: route photo (upload / picked frame) or the video frame where the attempt starts
  const ib = s.routeBg != null ? s.routeBg : Math.min(D.N - 1, Math.max(0, Math.round((video.currentTime - D.t0) * D.fps)));
  const ph = s.routePhoto; let srcEl: CanvasImageSource = video, sw = vw, sh = vh, M: (x: number, y: number) => [number, number];
  if (ph && ph.kind === 'upload') { srcEl = ph.el; sw = ph.w; sh = ph.h; const k = sw / vw; M = (x, y) => [x * k, (y - vh / 2) * k + sh / 2]; } // same camera position
  else { const c = camAt(D, ph && ph.kind === 'frame' ? ph.k ?? 0 : ib); if (!isFinite(c.tx)) c.tx = 0; if (!isFinite(c.ty)) c.ty = 0; if (ph) srcEl = ph.el; M = (x, y) => wallToImage(c, x, y); }
  // frame the route: bounding box of holds + CoM path (in the background image's coords)
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  const ext = (x: number, y: number) => { if (!isFinite(x) || !isFinite(y)) return; [x, y] = M(x, y); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
  for (const h of D.holds) if (h.i0 >= i0 && h.i0 <= i1) ext(h.x, h.y);
  for (let i = i0; i <= i1; i += 3) ext(D.comX[i], D.comY[i]);
  const kS = sw / vw, base = s.frame === 'reel' ? Math.max(W / sw, H / sh) : W / sw;
  let sc = base;
  if (x1 > x0) { const bw = (x1 - x0) * 1.12 + D.torsoPx * kS * 1.4, bh = (y1 - y0) * 1.08 + D.torsoPx * kS * 1.6; sc = Math.max(base, Math.min(W / bw, H * 0.8 / bh)); }
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  let ox = W / 2 - (isFinite(mx) ? mx : sw / 2) * sc, oy = H * 0.53 - (isFinite(my) ? my : sh / 2) * sc;
  ox = sw * sc >= W ? Math.min(0, Math.max(W - sw * sc, ox)) : (W - sw * sc) / 2;
  oy = sh * sc >= H ? Math.min(0, Math.max(H - sh * sc, oy)) : (H - sh * sc) / 2;
  const T = (x: number, y: number): [number, number] => { const q = M(x, y); return [ox + q[0] * sc, oy + q[1] * sc]; };
  drawBackground(r, { s: sc, ox, oy }, srcEl, sw, sh);
  ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(0, 0, W, H); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // ghost skeletons (chronophotography), coloured start → finish
  const step = Math.max(1, Math.round(D.fps * 1.2));
  for (let i = i0; i <= iCut; i += step) {
    const k = (i - i0) / Math.max(1, i1 - i0); ctx.strokeStyle = trailColor(st, k, 0.42); ctx.lineWidth = 2.4 * u;
    for (const [a, b] of BONES_C.concat(BONES_L, BONES_R)) { const pa = T(D.XW[a][i], D.YW[a][i]), pb = T(D.XW[b][i], D.YW[b][i]); if (isFinite(pa[0]) && isFinite(pb[0])) line(ctx, pa[0], pa[1], pb[0], pb[1]); }
  }
  // CoM path: one blurred underlay stroke (glow), then speed-coloured segments without blur
  const comPath = () => { ctx.beginPath(); let pen = false; for (let i = i0; i <= iCut; i++) { const q = T(D.comX[i], D.comY[i]); if (!isFinite(q[0])) { pen = false; continue; } if (pen) ctx.lineTo(q[0], q[1]); else { ctx.moveTo(q[0], q[1]); pen = true; } } };
  if (st.glow) { ctx.save(); ctx.shadowBlur = st.glow * u; ctx.shadowColor = trailColor(st, 0.5, 1); ctx.strokeStyle = trailColor(st, 0.5, 0.3); ctx.lineWidth = 7 * u; comPath(); ctx.stroke(); ctx.restore(); }
  ctx.lineWidth = 3 * u;
  for (let i = i0 + 1; i <= iCut; i++) {
    const pa = T(D.comX[i - 1], D.comY[i - 1]), pb = T(D.comX[i], D.comY[i]); if (!isFinite(pa[0]) || !isFinite(pb[0])) continue;
    ctx.strokeStyle = trailColor(st, clamp01(D.speed[i] / D.vmax), 0.9); line(ctx, pa[0], pa[1], pb[0], pb[1]);
  }
  // top / high point
  const hs = D.holds.filter((h) => h.i0 >= i0 && h.i0 <= iCut);
  if (at.lastHold && p >= 1) {
    const [lx, ly] = T(at.lastHold.x, at.lastHold.y), txt = at.sent ? (E.rock ? 'TOP-OUT ✓' : 'TOP ✓') : 'HIGH POINT', col = at.sent ? '#FFD23F' : '#FFFFFF';
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 4 * u; ctx.beginPath(); ctx.arc(lx, ly, 30 * u, 0, 7); ctx.stroke(); ctx.font = `700 ${17 * u}px "JetBrains Mono"`; const tw = ctx.measureText(txt).width + 16 * u;
    ctx.fillStyle = 'rgba(0,0,0,.8)'; ctx.beginPath(); ctx.roundRect(lx - tw / 2, ly - 70 * u, tw, 28 * u, 8 * u); ctx.fill(); ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, lx, ly - 55 * u); ctx.restore();
  }
  // placements in order, joined per limb kind; one numbered marker per physical hold
  for (const kind of ['foot', 'hand'] as const) {
    const list = hs.filter((h) => h.kind === kind), col = kind === 'hand' ? st.hand : st.foot;
    ctx.strokeStyle = col; ctx.globalAlpha = 0.55; ctx.lineWidth = 2 * u; ctx.setLineDash([8 * u, 7 * u]); ctx.beginPath();
    list.forEach((h, j) => { const [x, y] = T(h.x, h.y); if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    const drawn = new Set<number | undefined>();
    for (const h of list) {
      if (drawn.has(h.n)) continue; // re-grip / match on a hold already drawn
      drawn.add(h.n);
      const [x, y] = T(h.x, h.y), age = (iCut - h.i0) / D.fps, pop = 1 + 0.7 * Math.exp(-age * 6);
      ctx.strokeStyle = col; ctx.lineWidth = 3 * u; if (st.glow) { ctx.shadowBlur = st.glow * u; ctx.shadowColor = col; }
      if (kind === 'hand') {
        const rr = 17 * u * pop; ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.beginPath(); ctx.arc(x, y, rr, 0, 7); ctx.fill(); ctx.stroke();
        ctx.shadowBlur = 0; ctx.fillStyle = col; ctx.font = `700 ${15 * u}px "JetBrains Mono"`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(h.n), x, y + 1 * u);
      } else { const rr = 11 * u * pop; ctx.beginPath(); ctx.moveTo(x, y - rr); ctx.lineTo(x + rr, y); ctx.lineTo(x, y + rr); ctx.lineTo(x - rr, y); ctx.closePath(); ctx.stroke(); ctx.shadowBlur = 0; }
    }
  }
  // title
  const pad = 36 * u; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, W, 150 * u);
  ctx.fillStyle = st.text; ctx.font = `700 ${44 * u}px "Space Grotesk"`; const MT = E.map; ctx.fillText(MT[0], pad, pad + 44 * u);
  const rw = ctx.measureText(MT[0] + ' ').width; ctx.fillStyle = st.accent; ctx.fillText(MT[1], pad + rw, pad + 44 * u);
  if (RL.label) { ctx.textAlign = 'right'; ctx.font = `700 ${24 * u}px "Space Grotesk"`; ctx.fillStyle = RL.tagHex || st.accent; ctx.fillText(RL.label, W - pad, pad + 40 * u); ctx.textAlign = 'left'; }
  const nh = new Set(hs.filter((h) => h.kind === 'hand').map((h) => h.n)).size, nf = new Set(hs.filter((h) => h.kind === 'foot').map((h) => h.n)).size;
  ctx.fillStyle = st.mute; ctx.font = `500 ${17 * u}px "JetBrains Mono"`;
  ctx.fillText(`✋ ${nh} hand holds  ·  🦶 ${nf} footholds  ·  ${fmt((i1 - i0) / D.fps)}${at.highFootM ? `  ·  top ${at.highFootM.toFixed(1)} m` : ''}`, pad, pad + 80 * u);
  ctx.restore();
}

/** Report card: Flow score, mini CoM path, the four sub-scores. */
export function drawSummary(r: Renderer, alpha: number, u: number, st: Style): void {
  const { cv, ctx, s } = r, D = s.D!, M = D.M, E = r.env(), RL = r.route();
  const W = cv.width, H = cv.height;
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(6,7,9,.86)'; ctx.fillRect(0, 0, W, H);
  const pw = Math.min(W - 60 * u, 860 * u), ph = Math.min(H - 60 * u, 820 * u), px = (W - pw) / 2, py = (H - ph) / 2, pad = 36 * u;
  ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1.5 * u; ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 24 * u); ctx.stroke();
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.fillStyle = st.mute; ctx.font = `600 ${15 * u}px "JetBrains Mono"`; ctx.fillText(`SEND REPORT  ·  ${E.badge}  ·  ${s.srcFile || 'CLIMB/POSE'}`, px + pad, py + pad + 10 * u);
  ctx.fillStyle = st.accent; ctx.font = `700 ${150 * u}px "Space Grotesk"`; ctx.fillText(String(M.flow), px + pad - 6 * u, py + pad + 150 * u);
  const sw = ctx.measureText(String(M.flow)).width;
  ctx.fillStyle = st.text; ctx.font = `700 ${26 * u}px "Space Grotesk"`; ctx.fillText('FLOW SCORE', px + pad + sw + 14 * u, py + pad + 110 * u);
  ctx.fillStyle = st.mute; ctx.font = `500 ${15 * u}px "JetBrains Mono"`;
  ctx.fillText(`${M.attempts} attempt${M.attempts === 1 ? '' : 's'}  ·  ${fmt(M.time)}  ·  ${M.moves} moves`, px + pad + sw + 14 * u, py + pad + 142 * u);
  if (RL.label) { ctx.fillStyle = RL.tagHex || st.accent; ctx.font = `700 ${20 * u}px "Space Grotesk"`; ctx.fillText(RL.label, px + pad + sw + 14 * u, py + pad + 72 * u); }
  // mini path
  const mx = px + pw - pad - 200 * u, my = py + pad + 10 * u, ms = 200 * u;
  const ids: number[] = []; for (let k = 0; k < D.N; k++) if (D.valid[k]) ids.push(k);
  if (ids.length > 2) {
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const k of ids) { x0 = Math.min(x0, D.cxs[k]); x1 = Math.max(x1, D.cxs[k]); y0 = Math.min(y0, D.cys[k]); y1 = Math.max(y1, D.cys[k]); }
    const k2 = ms / Math.max(x1 - x0, y1 - y0, 1), ox = mx + (ms - (x1 - x0) * k2) / 2, oy = my + (ms - (y1 - y0) * k2) / 2;
    ctx.lineWidth = 3 * u; ctx.lineCap = 'round';
    for (let n = 1; n < ids.length; n++) { const p = ids[n - 1], q = ids[n]; if (q - p > 2) continue; ctx.strokeStyle = trailColor(st, clamp01(D.speed[q] / D.vmax), .95); line(ctx, ox + (D.cxs[p] - x0) * k2, oy + (D.cys[p] - y0) * k2, ox + (D.cxs[q] - x0) * k2, oy + (D.cys[q] - y0) * k2); }
    ctx.fillStyle = st.mute; ctx.font = `500 ${11 * u}px "JetBrains Mono"`; ctx.textAlign = 'center'; ctx.fillText('CoM PATH', mx + ms / 2, my + ms + 18 * u); ctx.textAlign = 'left';
  }
  // bars
  const items: [string, number, string][] = [
    ['FLUENCY', D.sc.fluency, isFinite(M.ldlj) ? 'LDLJ ' + M.ldlj.toFixed(1) : ''], ['PATH', D.sc.path, isFinite(M.gie) ? 'GIE ' + M.gie.toFixed(2) : ''],
    ['STRAIGHT ARMS', D.sc.arms, isFinite(M.straightArm) ? Math.round(M.straightArm * 100) + '% of rest' : ''], ['FOOTWORK', D.sc.feet, `${M.footMoves} foot : ${M.handMoves} hand moves`],
  ];
  let y = py + pad + 300 * u; const bw = pw - 2 * pad;
  for (const [k, v, sub] of items) {
    if (y + 60 * u > py + ph) break;
    ctx.fillStyle = st.text; ctx.font = `700 ${19 * u}px "Space Grotesk"`; ctx.fillText(k, px + pad, y);
    ctx.textAlign = 'right'; ctx.fillStyle = st.mute; ctx.font = `500 ${14 * u}px "JetBrains Mono"`; ctx.fillText(sub + '   ' + Math.round(v * 100), px + pad + bw, y); ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.beginPath(); ctx.roundRect(px + pad, y + 12 * u, bw, 10 * u, 5 * u); ctx.fill();
    ctx.fillStyle = st.accent; ctx.beginPath(); ctx.roundRect(px + pad, y + 12 * u, Math.max(10 * u, bw * v * alpha), 10 * u, 5 * u); ctx.fill();
    y += Math.min(110 * u, (ph - 340 * u) / 4);
  }
  ctx.restore();
}
