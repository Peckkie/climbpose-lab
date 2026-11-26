// M12 render — ground-truth label strip along the top edge while labelling (never in exports).
import type { Renderer } from './types';

export interface LabelMarks {
  attempts: { s: number; e: number; sent: boolean; crux: number | null; last: number | null }[];
  open: number | null;                    // attempt start marked, end not yet
  lr: { s: number; e: number }[]; lrOpen: number | null;
}

export function drawLabelStrip(r: Renderer, m: LabelMarks): void {
  const { cv, ctx, video } = r, dur = video.duration;
  if (!isFinite(dur) || dur <= 0) return;
  const W = cv.width, u = Math.min(W, cv.height) / 1080, x = (t: number) => W * t / dur, y = 6 * u, h = 26 * u, band = y + h + 14 * u;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(0, 0, W, band);
  for (const a of m.attempts) {
    ctx.fillStyle = a.sent ? 'rgba(61,220,151,.85)' : 'rgba(255,77,94,.85)'; ctx.fillRect(x(a.s), y, Math.max(2 * u, x(a.e) - x(a.s)), h);
    ctx.fillStyle = '#FFFFFF';
    if (a.crux != null) { const cx = x(a.crux); ctx.beginPath(); ctx.moveTo(cx - 9 * u, y); ctx.lineTo(cx + 9 * u, y); ctx.lineTo(cx, y + h); ctx.closePath(); ctx.fill(); }
    if (a.last != null) { ctx.fillStyle = '#FFD23F'; ctx.fillRect(x(a.last) - 2.5 * u, y - 3 * u, 5 * u, h + 6 * u); }
  }
  ctx.fillStyle = 'rgba(255,122,0,.95)';
  for (const s of m.lr) ctx.fillRect(x(s.s), y + h + 4 * u, Math.max(3 * u, x(s.e) - x(s.s)), 7 * u);
  ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 3 * u; ctx.setLineDash([6 * u, 4 * u]);
  const now = video.currentTime;
  if (m.open != null) { ctx.strokeRect(Math.min(x(m.open), x(now)), y, Math.abs(x(now) - x(m.open)), h); }
  if (m.lrOpen != null) { ctx.strokeStyle = 'rgba(255,122,0,.95)'; ctx.strokeRect(Math.min(x(m.lrOpen), x(now)), y + h + 4 * u, Math.abs(x(now) - x(m.lrOpen)), 7 * u); }
  ctx.setLineDash([]);
  ctx.fillStyle = '#C6FF00'; ctx.fillRect(x(now) - 2 * u, 0, 4 * u, band);
  ctx.restore();
}
