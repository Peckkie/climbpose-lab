// M13 export — crux sequence: the seconds before a fall as one shareable image (6 frames in a 3×2
// grid, 1080×1350 = Instagram 4:5). Frames are drawn with the current look (skeleton, holds,
// angles; no HUD) and cropped around the climber; the last tile is the crux.
import type { Crux, F32 } from '../types';
import { seekTo, clampTime } from '../media';
import { drawFrame, STYLES, viewAt, type Renderer, type ShowKey } from '../render';

export interface SequenceText { title: string; subtitle: string; footer: string[]; }

const W = 1080, H = 1350, COLS = 3, ROWS = 2, GAP = 10, HEAD = 170, FOOT = 120, PAD = 36;

/** Frame indices: n frames ending at the crux, spaced over spanS (not before the attempt start). */
export function sequenceFrames(cruxI: number, attemptI0: number, fps: number, n = COLS * ROWS, spanS = 2.5): number[] {
  const first = Math.max(attemptI0, cruxI - Math.round(spanS * fps));
  return Array.from({ length: n }, (_, k) => Math.round(first + (cruxI - first) * k / (n - 1)));
}

export async function renderCruxSequence(r: Renderer, c: Crux, text: SequenceText): Promise<Blob> {
  const { cv, video, s } = r, D = s.D!, st = STYLES[s.style];
  const att = D.attempts.find((a) => a.n === c.att);
  const frames = sequenceFrames(c.i, att ? att.i0 : 0, D.fps);
  // draw with a clean look, then put everything back
  const saved = { show: { ...s.show }, zoom: s.zoom, endCard: s.endCard, routeProg: s.routeProg, endCardAlpha: s.endCardAlpha, cruxFreeze: s.cruxFreeze, sendFreeze: s.sendFreeze, labelMarks: s.labelMarks };
  (Object.keys(s.show) as ShowKey[]).forEach((k) => { s.show[k] = ['skel', 'holds', 'angles', 'limbs', 'com'].includes(k) ? 1 : 0; });
  Object.assign(s, { zoom: 0, endCard: 0, routeProg: null, endCardAlpha: null, cruxFreeze: null, sendFreeze: null, labelMarks: null });
  video.pause();
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const g = out.getContext('2d')!;
  g.fillStyle = '#0A0B0D'; g.fillRect(0, 0, W, H);
  const tw = (W - 2 * PAD - (COLS - 1) * GAP) / COLS, th = (H - HEAD - FOOT - (ROWS - 1) * GAP) / ROWS;
  try {
    for (let k = 0; k < frames.length; k++) {
      const i = frames[k], t = D.t0 + (i + 0.25) / D.fps;
      await seekTo(video, clampTime(video, t));
      drawFrame(r, t);
      const [sx, sy, sw, sh] = cropAround(r, i, tw / th);
      const x = PAD + (k % COLS) * (tw + GAP), y = HEAD + Math.floor(k / COLS) * (th + GAP), last = k === frames.length - 1;
      g.save(); g.beginPath(); g.roundRect(x, y, tw, th, 14); g.clip();
      g.drawImage(cv, sx, sy, sw, sh, x, y, tw, th); g.restore();
      g.lineWidth = last ? 5 : 1.5; g.strokeStyle = last ? '#FF4D5E' : 'rgba(255,255,255,.15)';
      g.beginPath(); g.roundRect(x, y, tw, th, 14); g.stroke();
      const label = last ? 'CRUX' : `${((i - c.i) / D.fps).toFixed(1)} s`;
      g.font = '700 22px "JetBrains Mono"'; const lw = g.measureText(label).width + 20;
      g.fillStyle = last ? '#FF4D5E' : 'rgba(0,0,0,.7)'; g.beginPath(); g.roundRect(x + 10, y + 10, lw, 34, 8); g.fill();
      g.fillStyle = last ? '#000' : '#fff'; g.textBaseline = 'middle'; g.fillText(label, x + 20, y + 28);
    }
  } finally {
    Object.assign(s, { show: saved.show, zoom: saved.zoom, endCard: saved.endCard, routeProg: saved.routeProg, endCardAlpha: saved.endCardAlpha, cruxFreeze: saved.cruxFreeze, sendFreeze: saved.sendFreeze, labelMarks: saved.labelMarks });
    await seekTo(video, clampTime(video, D.t0 + (c.i + 0.25) / D.fps));
    drawFrame(r);
  }
  // header + footer
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#fff'; g.font = '700 30px "Space Grotesk"'; g.fillText('CLIMB', PAD, 62);
  let x = PAD + g.measureText('CLIMB').width; g.fillStyle = st.accent; g.fillText('/', x, 62); x += g.measureText('/').width; g.fillStyle = '#fff'; g.fillText('POSE', x, 62);
  g.fillStyle = st.accent; g.font = '700 54px "Space Grotesk"'; g.fillText(text.title, PAD, 126);
  g.fillStyle = 'rgba(255,255,255,.6)'; g.font = '500 22px "JetBrains Mono"'; g.fillText(text.subtitle, PAD, 158);
  g.font = '500 23px "JetBrains Mono"';
  text.footer.slice(0, 3).forEach((line, k) => {
    g.fillStyle = k === 0 ? '#FF4D5E' : 'rgba(255,255,255,.85)';
    g.fillText(fit(g, line, W - 2 * PAD), PAD, H - FOOT + 38 + k * 34);
  });
  return new Promise((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('could not make the image'))), 'image/png'));
}

/** Canvas rectangle around the climber at frame i with the tile's aspect (w/h). */
function cropAround(r: Renderer, i: number, aspect: number): [number, number, number, number] {
  const { cv, s } = r, D = s.D!, v = viewAt(r, i, 0);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const pts = (A: F32[], B: F32[]) => { for (let k = 0; k < 33; k++) { const x = A[k][i], y = B[k][i]; if (!isFinite(x) || !isFinite(y)) continue; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } };
  pts(D.X, D.Y);
  if (!isFinite(x0)) return [0, 0, cv.width, cv.height];
  const cx = v.ox + (x0 + x1) / 2 * v.s, cy = v.oy + (y0 + y1) / 2 * v.s;
  let h = Math.max((y1 - y0) * v.s * 1.35, (x1 - x0) * v.s * 1.35 / aspect, 200), w = h * aspect;
  if (h > cv.height) { h = cv.height; w = h * aspect; }
  if (w > cv.width) { w = cv.width; h = w / aspect; }
  const sx = Math.min(Math.max(0, cx - w / 2), cv.width - w), sy = Math.min(Math.max(0, cy - h / 2), cv.height - h);
  return [sx, sy, w, h];
}

function fit(g: CanvasRenderingContext2D, s: string, max: number): string {
  if (g.measureText(s).width <= max) return s;
  while (s.length > 1 && g.measureText(s + '…').width > max) s = s.slice(0, -1);
  return s + '…';
}
