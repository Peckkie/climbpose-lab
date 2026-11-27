// M12 render — per-frame layers on the analysed video, in drawing order.
import { ANGLES } from '../core/kinematics';
import { ENDS } from '../core/segmentation';
import { clamp01, lerp } from '../util';
import { line } from './draw';
import { drawSkeleton } from './skeleton';
import { trailColor, BONES_C, BONES_L, BONES_R } from './style';
import { drawHUD } from './hud';
import { drawCrux, drawLoad, drawSend } from './overlays';
import { drawSummary } from './endcards';
import { alignByHeight, pickGhost } from '../core/compare';
import type { Analysis, Attempt } from '../types';
import type { Layer } from './types';

/** Hold markers (beta map) appearing as they are grabbed. */
const holds: Layer = {
  name: 'holds', on: (fc) => !!fc.r.s.show.holds,
  draw({ ctx, D, st, u, f, Tw }) {
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const h of D.holds) {
      if (h.i0 > f) break;
      const [x, y] = Tw(h.x, h.y), age = (f - h.i0) / D.fps, active = f <= h.i1, pop = 1 + 0.8 * Math.exp(-age * 7);
      const col = h.kind === 'hand' ? st.hand : st.foot;
      ctx.globalAlpha = active ? 1 : 0.45; ctx.strokeStyle = col; ctx.lineWidth = (active ? 3 : 2) * u; ctx.shadowBlur = active ? st.glow * u : 0; ctx.shadowColor = col;
      if (h.kind === 'hand') {
        const r = 15 * u * pop; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
        ctx.shadowBlur = 0; ctx.fillStyle = col; ctx.font = `700 ${13 * u}px "JetBrains Mono"`; ctx.fillText(String(h.n), x + r + 9 * u, y - r * 0.6);
      } else { const r = 10 * u * pop; ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.stroke(); }
    }
    ctx.restore();
  },
};

/** Centre-of-mass trail: faint full path + speed-coloured recent tail. */
const comTrail: Layer = {
  name: 'com-trail', on: (fc) => !!fc.r.s.show.com,
  draw({ ctx, D, st, u, i, Tw }) {
    ctx.save(); ctx.lineCap = 'round';
    const tail = Math.round(D.fps * 5), j0 = Math.max(1, i - tail);
    // old path: one faint batched stroke
    ctx.strokeStyle = trailColor(st, 0.3, 0.18); ctx.lineWidth = 2 * u; ctx.beginPath(); let pen = false;
    for (let j = 0; j <= j0; j++) { const p = Tw(D.comX[j], D.comY[j]); if (!isFinite(p[0])) { pen = false; continue; } if (pen) ctx.lineTo(p[0], p[1]); else { ctx.moveTo(p[0], p[1]); pen = true; } }
    ctx.stroke();
    // glow underlay for the recent tail: one blurred stroke instead of one per segment
    if (st.glow) {
      ctx.save(); ctx.shadowBlur = st.glow * u; ctx.shadowColor = trailColor(st, 0.5, 1); ctx.strokeStyle = trailColor(st, 0.5, 0.35); ctx.lineWidth = 7 * u; ctx.beginPath(); pen = false;
      for (let j = j0 - 1; j <= i; j++) { if (j < 0) continue; const p = Tw(D.comX[j], D.comY[j]); if (!isFinite(p[0])) { pen = false; continue; } if (pen) ctx.lineTo(p[0], p[1]); else { ctx.moveTo(p[0], p[1]); pen = true; } }
      ctx.stroke(); ctx.restore();
    }
    // recent tail: per-segment speed colour, no blur
    ctx.lineWidth = 4.5 * u;
    for (let j = j0; j <= i; j++) {
      const p0 = Tw(D.comX[j - 1], D.comY[j - 1]), p1 = Tw(D.comX[j], D.comY[j]); if (!isFinite(p0[0]) || !isFinite(p1[0])) continue;
      const sp = clamp01(D.speed[j] / D.vmax); ctx.strokeStyle = trailColor(st, sp, lerp(1, 0.25, (i - j) / tail));
      line(ctx, p0[0], p0[1], p1[0], p1[1]);
    }
    ctx.restore();
  },
};

/** Short fading trails behind hands and feet. */
const limbTrails: Layer = {
  name: 'limb-trails', on: (fc) => !!fc.r.s.show.limbs,
  draw({ ctx, D, st, u, i, Tw }) {
    ctx.save(); ctx.lineCap = 'round'; const tail = Math.round(D.fps * 0.6);
    for (const [, ids, kind] of ENDS) {
      const col = kind === 'hand' ? st.hand : st.foot;
      const pt = (jj: number) => { let x = 0, y = 0; for (const k of ids) { x += D.XW[k][jj]; y += D.YW[k][jj]; } return Tw(x / ids.length, y / ids.length); };
      for (let j = Math.max(1, i - tail); j <= i; j++) {
        const p0 = pt(j - 1), p1 = pt(j); if (!isFinite(p0[0]) || !isFinite(p1[0])) continue;
        ctx.strokeStyle = col; ctx.globalAlpha = 0.7 * (1 - (i - j) / tail); ctx.lineWidth = (2 + 4 * (1 - (i - j) / tail)) * u; line(ctx, p0[0], p0[1], p1[0], p1[1]);
      }
    }
    ctx.restore();
  },
};

/** Ghost of another attempt at the moment it reached the same height (wall coordinates, so it sits
 *  right even when the camera moved). */
const ghostCache = new WeakMap<Analysis, Map<string, Int32Array>>();
function ghostFrame(D: Analysis, a: Attempt, b: Attempt, i: number): number {
  let m = ghostCache.get(D); if (!m) { m = new Map(); ghostCache.set(D, m); }
  const key = `${a.n}>${b.n}`;
  let map = m.get(key); if (!map) { map = alignByHeight(D.comH, a, b); m.set(key, map); }
  return map[i - a.i0] ?? -1;
}
const ghost: Layer = {
  name: 'ghost', on: (fc) => !!fc.r.s.show.ghost && fc.D.attempts.length > 1,
  draw({ ctx, D, u, i, Tw }) {
    const a = D.attempts.find((x) => i >= x.i0 && i < x.i1); if (!a) return;
    const b = pickGhost(D.attempts, a); if (!b) return;
    const j = ghostFrame(D, a, b, i); if (j < 0) return;
    const P = (k: number) => { const x = D.XW[k][j], y = D.YW[k][j]; return isFinite(x) && isFinite(y) ? Tw(x, y) : null; };
    ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 6 * u; ctx.setLineDash([10 * u, 8 * u]);
    for (const [p, q] of BONES_C.concat(BONES_L, BONES_R)) { const A = P(p), B = P(q); if (A && B) line(ctx, A[0], A[1], B[0], B[1]); }
    ctx.setLineDash([]);
    const n = P(0), e1 = P(7), e2 = P(8);
    if (n && e1 && e2) { const hx = (n[0] + e1[0] + e2[0]) / 3, hy = (n[1] + e1[1] + e2[1]) / 3; ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.arc(hx, hy, 14 * u, 0, 7); ctx.stroke();
      const label = `A${b.n}${b.sent ? ' SENT' : ''} · same height`; ctx.font = `700 ${14 * u}px "JetBrains Mono"`; const w = ctx.measureText(label).width + 14 * u;
      ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.beginPath(); ctx.roundRect(hx - w / 2, hy - 46 * u, w, 22 * u, 6 * u); ctx.fill(); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, hx, hy - 35 * u); }
    ctx.restore();
  },
};

const skeleton: Layer = { name: 'skeleton', on: (fc) => !!fc.r.s.show.skel, draw: ({ ctx, P, u, st }) => drawSkeleton(ctx, P, u, st) };

/** Elbow / knee angles (hidden while the load overlay is on — same spots). */
const angles: Layer = {
  name: 'angles', on: (fc) => !!fc.r.s.show.angles && !fc.r.s.show.load,
  draw({ ctx, D, st, u, i, i1, a, P }) {
    ctx.save(); ctx.font = `600 ${13 * u}px "JetBrains Mono"`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ANGLES.forEach(([ka, kb, kc], n) => {
      const A = P(ka), B = P(kb), C = P(kc); if (!A || !B || !C || B[2] < 0.5) return;
      const deg = lerp(D.ang[n][i], D.ang[n][i1], a); if (!isFinite(deg)) return;
      const a1 = Math.atan2(A[1] - B[1], A[0] - B[0]), a2 = Math.atan2(C[1] - B[1], C[0] - B[0]);
      let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      const r = 20 * u; ctx.strokeStyle = st.accent; ctx.globalAlpha = .9; ctx.lineWidth = 2 * u; ctx.beginPath(); ctx.arc(B[0], B[1], r, a1, a1 + d, d < 0); ctx.stroke();
      const mA = a1 + d / 2 + Math.PI, tx = B[0] + Math.cos(mA) * r * 2.1, ty = B[1] + Math.sin(mA) * r * 2.1;
      const label = Math.round(deg) + '°', tw = ctx.measureText(label).width + 10 * u;
      ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(tx - tw / 2, ty - 10 * u, tw, 20 * u);
      ctx.fillStyle = (n < 2 && deg > 150) ? st.accent : st.text; ctx.fillText(label, tx, ty);
    });
    ctx.restore();
  },
};

const comMarker: Layer = {
  name: 'com-marker', on: (fc) => !!fc.r.s.show.com,
  draw({ ctx, D, st, u, i, i1, a, Tw }) {
    const cx = lerp(D.comX[i], D.comX[i1], a), cy = lerp(D.comY[i], D.comY[i1], a);
    if (!isFinite(cx)) return;
    const [x, y] = Tw(cx, cy);
    ctx.save(); ctx.strokeStyle = st.accent; ctx.fillStyle = st.accent; ctx.lineWidth = 2 * u; ctx.shadowBlur = st.glow * u; ctx.shadowColor = st.accent;
    ctx.beginPath(); ctx.arc(x, y, 9 * u, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, 3 * u, 0, 7); ctx.fill();
    line(ctx, x - 16 * u, y, x - 11 * u, y); line(ctx, x + 11 * u, y, x + 16 * u, y); line(ctx, x, y - 16 * u, x, y - 11 * u); line(ctx, x, y + 11 * u, x, y + 16 * u);
    ctx.shadowBlur = 0; ctx.font = `600 ${11 * u}px "JetBrains Mono"`; ctx.fillText('CoM', x + 14 * u, y - 14 * u); ctx.restore();
  },
};

/** SENT card / body load / crux breakdown — frozen in export, or when paused on that frame. */
const overlays: Layer = {
  name: 'overlays', on: () => true,
  draw(fc) {
    const { D, f, r } = fc, s = r.s, idle = r.video.paused && !s.busy;
    const sd = s.sendFreeze ?? (idle ? D.sends.find((x) => Math.abs(f - x.i) <= 1.5) ?? null : null);
    if (sd && !s.cruxFreeze) drawSend(fc, sd);
    const cx = s.cruxFreeze ?? (s.show.crux && idle ? D.cruxes.find((c) => Math.abs(f - c.i) <= 1.5) ?? null : null);
    if (s.show.load && D.load && !cx) drawLoad(fc);
    if (cx) drawCrux(fc, cx);
  },
};

const hud: Layer = { name: 'hud', on: (fc) => !!fc.r.s.show.hud, draw: drawHUD };

const reportCard: Layer = { name: 'report-card', on: (fc) => fc.summary > 0, draw: (fc) => drawSummary(fc.r, fc.summary, fc.u, fc.st) };

export const LAYERS: Layer[] = [holds, comTrail, limbTrails, ghost, skeleton, angles, comMarker, overlays, hud, reportCard];
