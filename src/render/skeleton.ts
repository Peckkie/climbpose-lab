// M12 render — glowing skeleton.
import { line } from './draw';
import { BONES_C, BONES_L, BONES_R, JOINTS, type Style } from './style';
import type { PFn } from './types';

export function drawSkeleton(ctx: CanvasRenderingContext2D, P: PFn, u: number, st: Style): void {
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const pass = (bones: [number, number][], col: string) => {
    for (const [a, b] of bones) {
      const p = P(a), q = P(b); if (!p || !q || Math.min(p[2], q[2]) < 0.3) continue;
      ctx.strokeStyle = col; ctx.globalAlpha = 0.25; ctx.lineWidth = 11 * u; ctx.shadowBlur = st.glow * u; ctx.shadowColor = col; line(ctx, p[0], p[1], q[0], q[1]);
      ctx.globalAlpha = 1; ctx.lineWidth = 3.4 * u; ctx.shadowBlur = st.glow * 0.6 * u; line(ctx, p[0], p[1], q[0], q[1]);
    }
  };
  pass(BONES_C, st.C); pass(BONES_L, st.L); pass(BONES_R, st.R);
  // head
  const n = P(0), e1 = P(7), e2 = P(8);
  if (n && e1 && e2 && n[2] > 0.3) {
    const hx = (n[0] + e1[0] + e2[0]) / 3, hy = (n[1] + e1[1] + e2[1]) / 3, r = Math.max(9 * u, Math.hypot(e1[0] - e2[0], e1[1] - e2[1]) * 0.75);
    ctx.strokeStyle = st.C; ctx.lineWidth = 2.6 * u; ctx.shadowBlur = st.glow * u; ctx.shadowColor = st.C; ctx.beginPath(); ctx.arc(hx, hy, r, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.shadowBlur = 0;
  for (const k of JOINTS) {
    const p = P(k); if (!p || p[2] < 0.3) continue;
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(p[0], p[1], 5.2 * u, 0, 7); ctx.fill();
    ctx.fillStyle = st.joint; ctx.beginPath(); ctx.arc(p[0], p[1], 3.4 * u, 0, 7); ctx.fill();
  }
  ctx.restore();
}
