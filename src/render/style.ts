// M12 render — looks (NEON · CHALK · THERMAL), skeleton topology and colour ramps.
import { clamp01, lerp } from '../util';

export const BONES_L: [number, number][] = [[11, 13], [13, 15], [15, 19], [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [11, 23]];
export const BONES_R: [number, number][] = [[12, 14], [14, 16], [16, 20], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32], [12, 24]];
export const BONES_C: [number, number][] = [[11, 12], [23, 24]];
export const JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

export interface Style {
  dim: number; desat: number; L: string; R: string; C: string; joint: string; accent: string;
  text: string; mute: string; glow: number; hand: string; foot: string; trail: 'grad' | 'mono' | 'turbo';
}
export type StyleName = 'neon' | 'chalk' | 'thermal';

export const STYLES: Record<StyleName, Style> = {
  neon: { dim: .45, desat: .55, L: '#00F0FF', R: '#FF2BD6', C: '#FFFFFF', joint: '#FFFFFF', accent: '#C6FF00', text: '#FFFFFF', mute: 'rgba(255,255,255,.55)', glow: 16, hand: '#C6FF00', foot: '#FF2BD6', trail: 'grad' },
  chalk: { dim: .18, desat: 1, L: '#FFFFFF', R: '#FFFFFF', C: '#FFFFFF', joint: '#FF5A1F', accent: '#FF5A1F', text: '#FFFFFF', mute: 'rgba(255,255,255,.6)', glow: 0, hand: '#FF5A1F', foot: '#FFFFFF', trail: 'mono' },
  thermal: { dim: .5, desat: 1, L: '#FFD400', R: '#FF7A00', C: '#FFE680', joint: '#FFFFFF', accent: '#FFD400', text: '#FFFFFF', mute: 'rgba(255,255,255,.55)', glow: 10, hand: '#FFD400', foot: '#00C2FF', trail: 'turbo' },
};

export function turbo(t: number): string {
  t = clamp01(t);
  const r = Math.round(255 * clamp01(1.5 - Math.abs(4 * t - 3))), g = Math.round(255 * clamp01(1.5 - Math.abs(4 * t - 2))), b = Math.round(255 * clamp01(1.5 - Math.abs(4 * t - 1)));
  return `rgb(${r},${g},${b})`;
}

/** Trail colour for a normalised speed sp (0 slow … 1 fast). */
export function trailColor(st: Style, sp: number, alpha: number): string {
  if (st.trail === 'turbo') return turbo(sp).replace('rgb', 'rgba').replace(')', `,${alpha})`);
  if (st.trail === 'mono') return `rgba(255,255,255,${alpha})`;
  const r = Math.round(lerp(0, 255, sp)), g = Math.round(lerp(240, 43, sp)), b = Math.round(lerp(255, 214, sp));
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Load colour: green → yellow → red. */
export function loadColor(t: number): string {
  t = clamp01(t);
  const a = [61, 220, 151], b = [245, 217, 10], c = [255, 77, 94];
  const [p, q, k] = t < 0.5 ? [a, b, t * 2] as const : [b, c, (t - 0.5) * 2] as const;
  return `rgb(${Math.round(lerp(p[0], q[0], k))},${Math.round(lerp(p[1], q[1], k))},${Math.round(lerp(p[2], q[2], k))})`;
}
