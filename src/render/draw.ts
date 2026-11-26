// M12 render — canvas layout, view transform (follow cam), background and primitives.
import { lerp } from '../util';
import { STYLES } from './style';
import type { FrameMode, Renderer, View } from './types';

export function layoutCanvas(cv: HTMLCanvasElement, video: HTMLVideoElement, frame: FrameMode): void {
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
  if (frame === 'reel') { cv.width = 1080; cv.height = 1920; }
  else { const k = Math.min(1920 / Math.max(vw, vh), Math.max(1, 1080 / Math.min(vw, vh))); cv.width = Math.round(vw * k / 2) * 2; cv.height = Math.round(vh * k / 2) * 2; }
}

/** Video → canvas transform at frame i + a (follows the climber when zoomed). */
export function viewAt(r: Renderer, i: number, a: number): View {
  const { cv, video, s: S } = r;
  const W = cv.width, H = cv.height, vw = video.videoWidth, vh = video.videoHeight;
  const base = S.frame === 'reel' ? Math.max(W / vw, H / vh) : W / vw;
  const D = S.D, follow = S.zoom > 0 && D;
  const s = base * (follow ? S.zoom : 1);
  let cx = vw / 2, cy = vh / 2;
  if (follow && D) { cx = lerp(D.camX[i], D.camX[Math.min(i + 1, D.N - 1)], a); cy = lerp(D.camY[i], D.camY[Math.min(i + 1, D.N - 1)], a); }
  let ox = W / 2 - cx * s, oy = H / 2 - cy * s;
  ox = vw * s >= W ? Math.min(0, Math.max(W - vw * s, ox)) : (W - vw * s) / 2;
  oy = vh * s >= H ? Math.min(0, Math.max(H - vh * s, oy)) : (H - vh * s) / 2;
  return { s, ox, oy };
}

/** Dimmed, desaturated video frame (or route photo) as the backdrop. */
export function drawBackground(r: Renderer, v: View, src?: CanvasImageSource, sw = 0, sh = 0): void {
  const { cv, ctx, video } = r, W = cv.width, H = cv.height, st = STYLES[r.s.style];
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  if (src && src !== video) ctx.drawImage(src, v.ox, v.oy, sw * v.s, sh * v.s);
  else if (video.readyState >= 2) ctx.drawImage(video, v.ox, v.oy, video.videoWidth * v.s, video.videoHeight * v.s);
  ctx.save();
  ctx.globalCompositeOperation = 'saturation'; ctx.fillStyle = `hsla(0,0%,50%,${st.desat})`; ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = `rgba(0,0,0,${st.dim})`; ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

export function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

/** Rounded label; returns its width. */
export function pill(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, bg: string, fg: string, u: number): number {
  ctx.font = `700 ${15 * u}px "Space Grotesk"`;
  const w = ctx.measureText(text).width + 24 * u;
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(x, y, w, 28 * u, 14 * u); ctx.fill();
  ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.fillText(text, x + 12 * u, y + 14 * u);
  return w;
}
