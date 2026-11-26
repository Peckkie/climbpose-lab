// Small helpers shared by every layer (pure, no DOM).
export { clamp01 } from '../core/signal';

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** mm:ss.s */
export function fmt(t: number): string {
  if (!isFinite(t)) t = 0;
  const m = Math.floor(t / 60), s = t - m * 60;
  return String(m).padStart(2, '0') + ':' + s.toFixed(1).padStart(4, '0');
}
