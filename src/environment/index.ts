// M14 environment — gym wall vs real rock: auto-detection from video frames + wording.
import type { Env } from '../types';
import { seekTo } from '../media';

export interface EnvFeatures { smooth: number; vivid: number; veg: number; }
export interface EnvScores extends EnvFeatures { score: number; }

/** Colour/texture features of the current video frame (128 px wide copy). */
export function envFeatures(video: HTMLVideoElement): EnvFeatures {
  const c = document.createElement('canvas'); c.width = 128; c.height = Math.round(128 * video.videoHeight / video.videoWidth) || 128;
  const x = c.getContext('2d', { willReadFrequently: true })!; x.drawImage(video, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height).data, W = c.width, H = c.height, L = new Float32Array(W * H), n = W * H;
  let vivid = 0, veg = 0;
  for (let p = 0, q = 0; p < n; p++, q += 4) {
    const r = d[q] / 255, g = d[q + 1] / 255, b = d[q + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
    L[p] = 0.299 * r + 0.587 * g + 0.114 * b;
    let h = 0;
    if (mx !== mn) { h = mx === r ? ((g - b) / (mx - mn)) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4; h *= 60; if (h < 0) h += 360; }
    if (sat > 0.55 && mx > 0.35) vivid++;
    if (h > 55 && h < 165 && sat > 0.12 && sat < 0.55 && mx < 0.8) veg++;
  }
  let smooth = 0, m = 0;
  for (let y = 1; y < H - 1; y++) for (let xx = 1; xx < W - 1; xx++) { const p = y * W + xx; m++; if (Math.abs(L[p + 1] - L[p - 1]) + Math.abs(L[p + W] - L[p - W]) < 0.04) smooth++; }
  return { smooth: smooth / m, vivid: vivid / n, veg: veg / n };
}

/** Gym walls: large SMOOTH panels + VIVID plastic holds. Real rock: textured, muted, vegetation.
 *  Tested: gyms 0.49–0.69, outdoor boulder ≈ 0. Sky-heavy outdoor shots can look smooth. */
export function classifyEnv(fs: EnvFeatures[]): { env: Env; scores: EnvScores } {
  const avg = (k: keyof EnvFeatures) => fs.reduce((a, f) => a + f[k], 0) / fs.length;
  const sm = avg('smooth'), vi = avg('vivid'), ve = avg('veg'), score = sm + 2 * vi - 1.5 * ve;
  return { env: score > 0.3 ? 'gym' : 'rock', scores: { smooth: +sm.toFixed(2), vivid: +vi.toFixed(2), veg: +ve.toFixed(2), score: +score.toFixed(2) } };
}

/** Sample 3 frames of the loaded clip, then go back to the start. */
export async function detectEnv(video: HTMLVideoElement): Promise<{ env: Env; scores: EnvScores }> {
  const fs: EnvFeatures[] = [];
  for (const fr of [0.1, 0.35, 0.6]) { await seekTo(video, video.duration * fr); fs.push(envFeatures(video)); }
  const out = classifyEnv(fs);
  await seekTo(video, 0.001);
  return out;
}

export interface EnvText {
  rock: boolean; badge: string; sent: string; floor: string; map: [string, string]; place: string; top: string;
}
export function envText(env: Env): EnvText {
  const rock = env === 'rock';
  return {
    rock, badge: rock ? 'ROCK' : 'GYM', sent: rock ? 'TOPPED OUT ✓' : 'SENT ✓', floor: rock ? 'FEET ABOVE GROUND' : 'FEET ABOVE FLOOR',
    map: rock ? ['LINE', 'MAP'] : ['ROUTE', 'MAP'], place: rock ? 'Crag / area' : 'Gym', top: rock ? 'TOP-OUT' : 'TOP · LAST HOLD',
  };
}
