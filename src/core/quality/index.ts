// Clip quality — how far to trust this analysis. Pure: returns codes + numbers; the UI words them.
// Thresholds sit between the clips that analysed well and the ones that didn't (see config).
import { CONFIG } from '../../config';
import type { Analysis, QualityIssue, RawTrack, Settings } from '../../types';
import { pct } from '../signal';

const HANDS_FEET = [15, 16, 27, 28, 31, 32];

export function assessQuality(R: RawTrack, D: Analysis, s: Settings, cfg = CONFIG.quality): QualityIssue[] {
  const { N, vw, vh } = R, out: QualityIssue[] = [];
  const posed: number[] = [];
  for (let i = 0; i < N; i++) if (isFinite(R.X[11 * N + i])) posed.push(i);
  const found = posed.length / N;
  if (found < cfg.minFound) out.push({ id: 'found', level: 'warn', value: Math.round(found * 100) });
  if (!posed.length) return out;
  // climber size in the source video (pose crops from full resolution, so pixels matter)
  const torso = posed.map((i) => Math.hypot((R.X[11 * N + i] + R.X[12 * N + i] - R.X[23 * N + i] - R.X[24 * N + i]) / 2, (R.Y[11 * N + i] + R.Y[12 * N + i] - R.Y[23 * N + i] - R.Y[24 * N + i]) / 2));
  const tMed = pct(torso, 0.5);
  if (tMed < cfg.minTorsoPx) out.push({ id: 'small', level: 'warn', value: Math.round(tMed) });
  // distance to the camera changes (scale from the trunk is less exact)
  const spread = (pct(torso, 0.9) - pct(torso, 0.1)) / tMed;
  if (spread > cfg.maxTorsoSpread) out.push({ id: 'scale', level: 'warn', value: Math.round(spread * 100) });
  // camera zoom / travel
  if (R.CA && R.CB) {
    let lo = Infinity, hi = 0, travel = 0;
    for (let i = 0; i < N; i++) { const sc = Math.hypot(R.CA[i], R.CB[i]); lo = Math.min(lo, sc); hi = Math.max(hi, sc); travel = Math.max(travel, Math.abs(R.OX[i]), Math.abs(R.OY[i])); }
    const zoom = hi / lo, tr = travel / Math.max(vw, vh);
    if (zoom > cfg.maxZoom || tr > cfg.maxTravel) out.push({ id: 'camera', level: 'warn', value: +zoom.toFixed(2), value2: Math.round(tr * 100) });
  }
  // hands / feet at the frame edge while on the wall (cut off → guessed)
  let wall = 0, edge = 0;
  for (const i of posed) {
    if (!D.onWall[i]) continue; wall++;
    if (HANDS_FEET.some((k) => { const x = R.X[k * N + i], y = R.Y[k * N + i]; return isFinite(x) && (x < cfg.edge * vw || x > (1 - cfg.edge) * vw || y < cfg.edge * vh || y > (1 - cfg.edge) * vh); })) edge++;
  }
  if (wall && edge / wall > cfg.maxEdgeShare) out.push({ id: 'edge', level: 'warn', value: Math.round(100 * edge / wall) });
  // false detections dropped by cleanup
  const rej = D.M.rejectedFrames / N;
  if (rej > cfg.maxRejected) out.push({ id: 'rejected', level: 'warn', value: +(rej * 100).toFixed(1) });
  if (!s.weightKg) out.push({ id: 'weight', level: 'info', value: D.M.bodyKg });
  return out;
}
