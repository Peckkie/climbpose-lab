// M12 render — body load (kg · Nm), SENT card and CRUX breakdown.
import type { Crux, Send, TorqueTrack, LimbKey } from '../types';
import { holdCounts } from '../core/segmentation';
import { fmt, lerp } from '../util';
import { line } from './draw';
import { loadColor } from './style';
import type { FrameCtx, P3 } from './types';

type JointRef = 'sh' | 'el' | 'hip' | 'kn';
const LOAD_POINTS: [LimbKey, number, [keyof TorqueTrack, number, JointRef][]][] = [
  ['LH', 15, [['shL', 11, 'sh'], ['elL', 13, 'el']]], ['RH', 16, [['shR', 12, 'sh'], ['elR', 14, 'el']]],
  ['LF', 27, [['hipL', 23, 'hip'], ['knL', 25, 'kn']]], ['RF', 28, [['hipR', 24, 'hip'], ['knR', 26, 'kn']]],
];
const REF: Record<JointRef, number> = { sh: 120, el: 70, hip: 160, kn: 130 };

/** kg at each supporting hand/foot, Nm at the loaded joints (green → yellow → red). */
export function drawLoad({ ctx, D, i, a, P, u, W }: FrameCtx): void {
  const i1 = Math.min(i + 1, D.N - 1), bw = D.M.bodyKg || 60;
  const L = (arr: Float32Array) => { const v0 = arr[i], v1 = arr[i1]; return isFinite(v0) && isFinite(v1) ? lerp(v0, v1, a) : isFinite(v0) ? v0 : NaN; };
  ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const tag = (x: number, y: number, text: string, col: string, big: boolean) => {
    ctx.font = `700 ${(big ? 17 : 13) * u}px "JetBrains Mono"`; const w = ctx.measureText(text).width + 12 * u, h = (big ? 26 : 20) * u;
    ctx.fillStyle = 'rgba(0,0,0,.72)'; ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, 6 * u); ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 1.5 * u; ctx.stroke(); ctx.fillStyle = col; ctx.fillText(text, x, y + 1 * u);
  };
  for (const [k, end, joints] of LOAD_POINTS) {
    const kg = L(D.load[k]); if (!isFinite(kg) || kg < 0.5) continue;
    const pe = P(end); if (!pe) continue; const col = loadColor(kg / (0.5 * bw));
    ctx.fillStyle = col; ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(pe[0], pe[1], (10 + kg / bw * 30) * u, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    tag(pe[0], pe[1] + (k[1] === 'H' ? -30 : 30) * u, `${Math.round(kg)} kg`, col, true);
    for (const [jn, jk, ref] of joints) {
      const nm = L(D.tq[jn]); const pj = P(jk); if (!pj || !isFinite(nm) || nm < 3) continue; const c2 = loadColor(nm / REF[ref]);
      ctx.strokeStyle = c2; ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.arc(pj[0], pj[1], 14 * u, 0, 7); ctx.stroke(); tag(pj[0] + (pj[0] < W / 2 ? -46 : 46) * u, pj[1], `${Math.round(nm)} Nm`, c2, false);
    }
  }
  ctx.restore();
}

/** SENT card: the attempt was finished — mark the top / last hold. */
export function drawSend({ r, ctx, D, st, u, W, H, Tw }: FrameCtx, sd: Send): void {
  const E = r.env(), GOLD = '#FFD23F';
  ctx.save(); ctx.textBaseline = 'middle';
  if (sd.hold) {
    const [x, y] = Tw(sd.hold.x, sd.hold.y);
    ctx.strokeStyle = GOLD; ctx.lineWidth = 5 * u; ctx.shadowBlur = 18 * u; ctx.shadowColor = GOLD; ctx.beginPath(); ctx.arc(x, y, 34 * u, 0, 7); ctx.stroke(); ctx.shadowBlur = 0;
    ctx.font = `700 ${18 * u}px "JetBrains Mono"`; const t = E.top, w = ctx.measureText(t).width + 18 * u, tx = Math.max(w / 2 + 8 * u, Math.min(W - w / 2 - 8 * u, x));
    ctx.fillStyle = 'rgba(0,0,0,.8)'; ctx.beginPath(); ctx.roundRect(tx - w / 2, y - 78 * u, w, 30 * u, 8 * u); ctx.fill(); ctx.fillStyle = GOLD; ctx.textAlign = 'center'; ctx.fillText(t, tx, y - 62 * u);
  }
  const a = D.attempts.find((x) => x.n === sd.att), pw = Math.min(W - 40 * u, 560 * u), ph = 150 * u, px = (W - pw) / 2, py = H - 150 * u - ph;
  ctx.fillStyle = 'rgba(8,9,11,.88)'; ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 18 * u); ctx.fill(); ctx.strokeStyle = GOLD; ctx.lineWidth = 2 * u; ctx.stroke();
  ctx.textAlign = 'left'; ctx.fillStyle = GOLD; ctx.font = `700 ${40 * u}px "Space Grotesk"`; ctx.fillText(E.sent, px + 24 * u, py + 44 * u);
  ctx.fillStyle = st.mute; ctx.font = `500 ${15 * u}px "JetBrains Mono"`; ctx.textAlign = 'right'; ctx.fillText(`ATTEMPT ${sd.att} · ${fmt(D.t0 + sd.i / D.fps)}`, px + pw - 24 * u, py + 40 * u);
  ctx.textAlign = 'left'; ctx.fillStyle = st.text; ctx.font = `500 ${19 * u}px "JetBrains Mono"`;
  const nh = a ? holdCounts(D.holds.filter((h) => h.i0 >= a.i0 && h.i0 <= a.i1)).handMoves : 0;
  ctx.fillText(`Top hold ${sd.hold ? '#' + sd.hold.n : ''}${a && isFinite(a.lastHoldM as number) ? ` · ${(a.lastHoldM as number).toFixed(1)} m up` : ''} · ${sd.how}`, px + 24 * u, py + 90 * u);
  ctx.fillText(`${a ? a.dur.toFixed(1) + ' s on the wall · ' : ''}${nh} hand moves`, px + 24 * u, py + 122 * u);
  ctx.restore();
}

/** CRUX breakdown at the frame of max reach before coming off. */
export function drawCrux({ ctx, D, st, u, W, H, P, Tw }: FrameCtx, c: Crux): void {
  const BAD = '#FF4D5E', GOOD = '#3DDC97';
  const hw = P(15 + c.hand), he = P(13 + c.hand), kn = P(25 + c.leg), an = P(27 + c.leg), h1 = P(23), h2 = P(24);
  ctx.save(); ctx.lineCap = 'round'; ctx.textBaseline = 'middle';
  const tag = (x: number, y: number, text: string, col: string) => {
    ctx.font = `700 ${16 * u}px "JetBrains Mono"`; const w = ctx.measureText(text).width + 16 * u; x = Math.max(w / 2 + 6 * u, Math.min(W - w / 2 - 6 * u, x));
    ctx.fillStyle = 'rgba(0,0,0,.78)'; ctx.beginPath(); ctx.roundRect(x - w / 2, y - 14 * u, w, 28 * u, 8 * u); ctx.fill(); ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.fillText(text, x, y + 1 * u);
  };
  // foot → hand extension line
  if (hw && an) {
    ctx.setLineDash([10 * u, 8 * u]); ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 2.5 * u; line(ctx, an[0], an[1], hw[0], hw[1]); ctx.setLineDash([]);
    tag((an[0] + hw[0]) / 2 + 40 * u, (an[1] + hw[1]) / 2, `${Math.round(c.ext * 100)}% reach`, c.ext < 0.88 ? BAD : GOOD);
  }
  // target hold + gap
  if (c.target && hw) {
    const [tx, ty] = Tw(c.target.x, c.target.y);
    ctx.strokeStyle = BAD; ctx.lineWidth = 3 * u; ctx.setLineDash([6 * u, 6 * u]); line(ctx, hw[0], hw[1], tx, ty); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(tx, ty, 22 * u, 0, 7); ctx.stroke(); tag(tx, ty - 38 * u, `${Math.round(c.target.distM * 100)} cm`, BAD);
  }
  const joint = (p: P3 | null, deg: number, bad: boolean, label: string) => {
    if (!p || !isFinite(deg)) return;
    ctx.strokeStyle = bad ? BAD : GOOD; ctx.lineWidth = 4 * u; ctx.beginPath(); ctx.arc(p[0], p[1], 26 * u, 0, 7); ctx.stroke(); tag(p[0] + (p[0] < W / 2 ? -70 : 70) * u, p[1], `${label} ${Math.round(deg)}°`, bad ? BAD : GOOD);
  };
  // last hold reached = high point of this attempt
  if (c.lastHold) {
    const [lx, ly] = Tw(c.lastHold.x, c.lastHold.y); ctx.setLineDash([6 * u, 5 * u]); ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.arc(lx, ly, 28 * u, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    tag(lx, ly + 46 * u, `LAST HOLD #${c.lastHold.n}${isFinite(c.lastHoldM as number) ? ' · ' + (c.lastHoldM as number).toFixed(1) + ' m' : ''}`, '#FFFFFF');
  }
  // both knees: the push leg is judged, the other is shown for context
  const ok = P(26 - c.leg), oDeg = D.ang[3 - c.leg][c.i];
  if (ok && isFinite(oDeg)) {
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.arc(ok[0], ok[1], 22 * u, 0, 7); ctx.stroke();
    tag(ok[0] + (ok[0] < W / 2 ? -70 : 70) * u, ok[1] + 30 * u, `${c.leg ? 'L' : 'R'} KNEE ${Math.round(oDeg)}°`, '#FFFFFF');
  }
  joint(kn, c.knee, c.knee < 155, (c.leg ? 'R' : 'L') + ' KNEE'); joint(he, c.elbow, c.elbow < 150, 'ELBOW');
  // hip level
  if (h1 && h2) {
    const y = (h1[1] + h2[1]) / 2, x = (h1[0] + h2[0]) / 2, bad = c.hipPct < 0.38; ctx.strokeStyle = bad ? BAD : GOOD; ctx.lineWidth = 3 * u; line(ctx, x - 60 * u, y, x + 60 * u, y);
    tag(x + (x < W / 2 ? -110 : 110) * u, y, `HIP ${Math.round(c.hipPct * 100)}%`, bad ? BAD : GOOD);
  }
  // panel: tips word-wrapped (not truncated); top or bottom, whichever covers fewer key points
  const pw = Math.min(W - 40 * u, 680 * u), lh = 34 * u, px = (W - pw) / 2;
  ctx.font = `600 ${17 * u}px "JetBrains Mono"`;
  const wrap = (t: string) => { const out: string[] = []; let cur = ''; for (const w of t.split(' ')) { const nx = cur ? cur + ' ' + w : w; if (ctx.measureText(nx).width > pw - 120 * u && cur) { out.push(cur); cur = w; } else cur = nx; } if (cur) out.push(cur); return out; };
  const tipLines = c.tips.map(wrap), nTip = tipLines.reduce((a2, l) => a2 + l.length, 0);
  const tlh = 26 * u, tipH = c.tips.length ? 24 * u + nTip * tlh + (c.tips.length - 1) * 8 * u : 0, ph = 70 * u + c.cues.length * lh + tipH;
  const keys = [hw, he, kn, ok, h1, h2, c.target ? Tw(c.target.x, c.target.y) : null].filter((q): q is P3 | [number, number] => !!q);
  const cover = (y: number) => keys.filter((q) => q[0] > px - 30 * u && q[0] < px + pw + 30 * u && q[1] > y - 40 * u && q[1] < y + ph + 40 * u).length;
  const topY = 175 * u, botY = H - 150 * u - ph, py = cover(topY) <= cover(botY) ? topY : botY;
  ctx.fillStyle = 'rgba(8,9,11,.86)'; ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 18 * u); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1.5 * u; ctx.stroke();
  ctx.textAlign = 'left'; ctx.fillStyle = st.accent; ctx.font = `700 ${26 * u}px "Space Grotesk"`; ctx.fillText(`NOT SENT · CRUX · ATTEMPT ${c.att}`, px + 22 * u, py + 34 * u);
  ctx.fillStyle = st.mute; ctx.font = `500 ${15 * u}px "JetBrains Mono"`; ctx.textAlign = 'right'; ctx.fillText(`${fmt(D.t0 + c.i / D.fps)} · ${c.end}`, px + pw - 22 * u, py + 34 * u);
  ctx.textAlign = 'left'; ctx.font = `500 ${19 * u}px "JetBrains Mono"`;
  c.cues.forEach((q, k) => { const y = py + 72 * u + k * lh; ctx.fillStyle = q.bad ? BAD : GOOD; ctx.beginPath(); ctx.arc(px + 30 * u, y, 6 * u, 0, 7); ctx.fill(); ctx.fillStyle = st.text; ctx.fillText(q.t, px + 48 * u, y); });
  if (c.tips.length) {
    const y0 = py + 72 * u + c.cues.length * lh + 10 * u; ctx.strokeStyle = 'rgba(255,255,255,.12)'; line(ctx, px + 22 * u, y0 - 14 * u, px + pw - 22 * u, y0 - 14 * u);
    ctx.font = `600 ${17 * u}px "JetBrains Mono"`; let y = y0 + 10 * u;
    tipLines.forEach((lines) => { ctx.fillStyle = st.accent; ctx.fillText('TRY →', px + 22 * u, y); ctx.fillStyle = st.text; lines.forEach((l) => { ctx.fillText(l, px + 96 * u, y); y += tlh; }); y += 8 * u; });
  }
  ctx.restore();
}
