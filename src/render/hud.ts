// M12 render — HUD: wordmark, state, route chip, height gauge, file name, speed timeline.
import { runs } from '../core/signal';
import { clamp01, fmt } from '../util';
import { pill } from './draw';
import type { FrameCtx } from './types';

export function drawHUD({ r, ctx, D, st, u, W, H, t, i }: FrameCtx): void {
  const s = r.s, E = r.env(), RL = r.route(), pad = 28 * u;
  ctx.save(); ctx.textBaseline = 'alphabetic';
  // wordmark + environment badge + timecode
  ctx.fillStyle = st.text; ctx.font = `700 ${30 * u}px "Space Grotesk"`; ctx.fillText('CLIMB', pad, pad + 26 * u);
  const w1 = ctx.measureText('CLIMB').width; ctx.fillStyle = st.accent; ctx.fillText('/', pad + w1, pad + 26 * u);
  const w2 = ctx.measureText('/').width; ctx.fillStyle = st.text; ctx.fillText('POSE', pad + w1 + w2, pad + 26 * u);
  {
    const w3 = ctx.measureText('POSE').width, bx0 = pad + w1 + w2 + w3 + 12 * u;
    ctx.save(); ctx.font = `700 ${12 * u}px "JetBrains Mono"`; const bwid = ctx.measureText(E.badge).width + 14 * u;
    ctx.fillStyle = E.rock ? '#B07A4A' : 'rgba(255,255,255,.18)'; ctx.beginPath(); ctx.roundRect(bx0, pad + 8 * u, bwid, 22 * u, 11 * u); ctx.fill();
    ctx.fillStyle = '#FFFFFF'; ctx.textBaseline = 'middle'; ctx.fillText(E.badge, bx0 + 7 * u, pad + 19 * u); ctx.restore();
  }
  ctx.font = `500 ${15 * u}px "JetBrains Mono"`; ctx.fillStyle = st.mute; ctx.fillText(fmt(Math.max(0, t - D.t0)) + '  /  ' + fmt(D.N / D.fps), pad, pad + 52 * u);
  // state pill
  const mv = D.moving[i], sp = D.speed[i];
  const pw = pill(ctx, pad, pad + 66 * u, mv ? '● MOVING' : '■ REST', mv ? st.accent : 'rgba(255,255,255,.14)', mv ? '#000' : st.text, u);
  ctx.textBaseline = 'middle'; ctx.font = `500 ${15 * u}px "JetBrains Mono"`; ctx.fillStyle = st.text; ctx.fillText(isFinite(sp) ? sp.toFixed(2) + ' m/s' : '–', pad + pw + 10 * u, pad + 80 * u);
  const att = D.attempts.find((a) => i >= a.i0 && i < a.i1), done = D.attempts.filter((a) => a.i0 <= i).length;
  ctx.textBaseline = 'alphabetic';
  // route chip
  const touched = (kind: 'hand' | 'foot') => new Set(D.holds.filter((h) => h.kind === kind && h.i0 <= i).map((h) => h.n)).size;
  const nhR = touched('hand');
  const place = /^any (gym|crag)|^example/i.test(RL.gym) ? '' : RL.gym;
  const rl = [RL.label || 'Route: grade not set', place, `${nhR} hand holds`].filter(Boolean).join(' · ');
  {
    ctx.save(); ctx.font = `700 ${15 * u}px "Space Grotesk"`; const tw = ctx.measureText(rl).width; const x = pad, y = pad + 138 * u;
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.beginPath(); ctx.roundRect(x, y, tw + 46 * u, 28 * u, 14 * u); ctx.fill();
    ctx.fillStyle = RL.tagHex || st.accent; ctx.beginPath(); ctx.arc(x + 15 * u, y + 14 * u, 7 * u, 0, 7); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1.2 * u; ctx.stroke();
    ctx.fillStyle = st.text; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(rl, x + 30 * u, y + 15 * u); ctx.restore();
  }
  ctx.textBaseline = 'alphabetic';
  // attempt pill
  const prevA = !att && done ? D.attempts.filter((a) => a.i1 <= i).slice(-1)[0] : null;
  const sentNow = !!att && !!att.sent && att.sendI != null && i >= att.sendI;
  pill(ctx, pad, pad + 102 * u,
    att ? (sentNow ? `ATTEMPT ${att.n} · ${E.sent}` : `ATTEMPT ${att.n} / ${D.attempts.length}`) : (prevA ? `A${prevA.n} ${prevA.sent ? E.sent : 'NOT SENT'} · OFF ${E.rock ? 'ROCK' : 'WALL'}` : 'OFF WALL'),
    sentNow || (prevA && prevA.sent) ? '#FFD23F' : att ? 'rgba(255,255,255,.92)' : prevA ? 'rgba(255,77,94,.85)' : 'rgba(255,255,255,.14)', att || prevA ? '#000' : st.text, u);
  // height gauge (right)
  const gy = D.footH[i];
  ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
  ctx.font = `500 ${13 * u}px "JetBrains Mono"`; ctx.fillStyle = st.mute; ctx.fillText(E.floor, W - pad, pad + 12 * u);
  ctx.font = `700 ${44 * u}px "Space Grotesk"`; ctx.fillStyle = st.text; ctx.fillText(isFinite(gy) ? Math.max(0, gy).toFixed(1) + ' m' : '–', W - pad, pad + 56 * u);
  ctx.font = `500 ${13 * u}px "JetBrains Mono"`; ctx.fillStyle = st.mute;
  ctx.fillText(`HOLDS ✋${nhR}  🦶${touched('foot')}`, W - pad, pad + 80 * u);
  if (s.show.load && D.M.bodyKg) { ctx.fillStyle = D.M.bodyKgAssumed ? '#FFB020' : st.mute; ctx.fillText(D.M.bodyKgAssumed ? `LOAD @ ${D.M.bodyKg} kg (ASSUMED)` : `LOAD @ ${D.M.bodyKg} kg`, W - pad, pad + 102 * u); }
  // source file name, small, above the timeline
  if (s.srcFile) {
    ctx.save(); ctx.textAlign = 'left'; ctx.font = `600 ${14 * u}px "JetBrains Mono"`; const tw = ctx.measureText(s.srcFile).width + 20 * u, fy = H - pad - 54 * u - 62 * u;
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.beginPath(); ctx.roundRect(pad - 10 * u, fy - 14 * u, tw, 26 * u, 8 * u); ctx.fill(); ctx.fillStyle = st.text; ctx.textBaseline = 'middle'; ctx.fillText(s.srcFile, pad, fy - 1 * u); ctx.restore();
  }
  // speed timeline (bottom)
  const bh = 54 * u, bx = pad, by = H - pad - bh, bw = W - 2 * pad;
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.beginPath(); ctx.roundRect(bx - 10 * u, by - 26 * u, bw + 20 * u, bh + 36 * u, 12 * u); ctx.fill();
  ctx.textAlign = 'left'; ctx.font = `600 ${11 * u}px "JetBrains Mono"`; ctx.fillStyle = st.mute; ctx.fillText('CoM SPEED', bx, by - 10 * u);
  ctx.textAlign = 'right'; ctx.fillText(`FLOW ${D.M.flow}`, bx + bw, by - 10 * u);
  const N = D.N, xs = (k: number) => bx + bw * k / (N - 1), ys = (v: number) => by + bh - bh * clamp01(v / D.vmax);
  ctx.fillStyle = 'rgba(255,255,255,.06)';
  for (const [p, q] of runs(D.moving)) ctx.fillRect(xs(p), by, xs(q) - xs(p), bh);
  ctx.lineWidth = 1.6 * u; ctx.strokeStyle = st.mute; ctx.beginPath(); let started = false;
  for (let k = 0; k < N; k++) { const v = D.speed[k]; if (!isFinite(v)) { started = false; continue; } if (!started) { ctx.moveTo(xs(k), ys(v)); started = true; } else ctx.lineTo(xs(k), ys(v)); }
  ctx.stroke();
  if (s.show.load && D.handShare) {
    ctx.strokeStyle = 'rgba(255,122,0,.85)'; ctx.lineWidth = 1.6 * u; ctx.setLineDash([4 * u, 3 * u]); ctx.beginPath(); started = false;
    for (let k = 0; k < N; k++) { const v = D.handShare[k]; if (!isFinite(v)) { started = false; continue; } const yy = by + bh - bh * v; if (!started) { ctx.moveTo(xs(k), yy); started = true; } else ctx.lineTo(xs(k), yy); }
    ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = 'rgba(255,122,0,.95)'; ctx.textAlign = 'left'; ctx.font = `600 ${11 * u}px "JetBrains Mono"`; ctx.fillText('- - % WEIGHT ON HANDS', bx + 90 * u, by - 10 * u);
  }
  ctx.strokeStyle = st.accent; ctx.lineWidth = 2.4 * u; ctx.beginPath(); started = false;
  for (let k = 0; k <= i; k++) { const v = D.speed[k]; if (!isFinite(v)) { started = false; continue; } if (!started) { ctx.moveTo(xs(k), ys(v)); started = true; } else ctx.lineTo(xs(k), ys(v)); }
  ctx.stroke();
  ctx.font = `700 ${10 * u}px "JetBrains Mono"`; ctx.textAlign = 'left';
  for (const at of D.attempts) { ctx.fillStyle = at.i0 <= i ? st.accent : 'rgba(255,255,255,.35)'; ctx.fillRect(xs(at.i0), by + bh + 3 * u, Math.max(2 * u, xs(at.i1) - xs(at.i0)), 3 * u); ctx.fillText('A' + at.n, xs(at.i0), by + bh + 16 * u); }
  ctx.fillStyle = st.accent; ctx.fillRect(xs(i) - 1 * u, by - 4 * u, 2 * u, bh + 8 * u);
  ctx.restore();
}
