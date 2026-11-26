// M10 · core/crux — for each attempt that was not sent: the frame of highest reach just before
// coming off, body position measurements there, readable cues and coaching tips.
// Ported 1:1 from v0.2 process(). Measurements and wording are kept together for parity; Phase 5
// moves the wording into an editable rule table.

import { CONFIG } from '../../config';
import type { Attempt, Crux, Cue, F32, Hold } from '../../types';
import { median } from '../signal';
import type { Kinematics } from '../kinematics';

export function findCruxes(k: Kinematics, attempts: Attempt[], holds: Hold[], fps: number, cfg = CONFIG.crux): Crux[] {
  const { XS, YS, XW, YW, XSW, YSW, valid, vy, ang, mpp, torsoPx } = k, N = valid.length;
  const dS = (a: number, b: number, i: number) => Math.hypot(XS[a][i] - XS[b][i], YS[a][i] - YS[b][i]);
  const idxAll: number[] = [];
  for (let i = 0; i < N; i += 2) if (valid[i]) idxAll.push(i);
  const armLen = median(idxAll.flatMap((i) => [dS(11, 13, i) + dS(13, 15, i), dS(12, 14, i) + dS(14, 16, i)]));
  const legLen = median(idxAll.flatMap((i) => [dS(23, 25, i) + dS(25, 27, i), dS(24, 26, i) + dS(26, 28, i)]));
  const cruxes: Crux[] = [];
  for (const a of attempts) {
    if (a.sent || a.end === 'ongoing') continue;
    const w0 = Math.max(a.i0, a.i1 - Math.round(fps * cfg.windowS)), w1 = Math.min(N - 1, a.i1 + Math.round(fps * cfg.afterS));
    let ci = -1, bestY = Infinity, hand: 0 | 1 = 0;
    for (let i = w0; i <= w1; i++) {
      if (!valid[i] || (isFinite(vy[i]) && vy[i] * mpp > cfg.droppingMs)) continue; // already dropping
      for (const sd of [0, 1] as const) { const y = YW[15 + sd][i]; if (y < bestY) { bestY = y; ci = i; hand = sd; } }
    }
    if (ci < 0) continue;
    const i = ci, wk = 15 + hand;
    // push leg = the planted foot (moving least around this frame)
    const fsp = (sd: number) => { const j0 = Math.max(0, i - 3), j1 = Math.min(N - 1, i + 3); return Math.hypot(XSW[27 + sd][j1] - XSW[27 + sd][j0], YSW[27 + sd][j1] - YSW[27 + sd][j0]); };
    const leg: 0 | 1 = fsp(0) <= fsp(1) || !isFinite(fsp(1)) ? 0 : 1;
    const knee = ang[2 + leg][i], elbow = ang[hand][i], otherElbow = ang[1 - hand][i];
    const footY = YW[27 + leg][i], handY = YW[wk][i], hipY = (YW[23][i] + YW[24][i]) / 2;
    const hipPct = (footY - hipY) / (footY - handY);
    const ext = Math.hypot(XW[wk][i] - XW[27 + leg][i], YW[wk][i] - YW[27 + leg][i]) / (legLen + torsoPx + armLen);
    const comUp = isFinite(vy[i]) ? -vy[i] * mpp : NaN;
    // target: nearest hand hold above / level with the hand, not being held right now
    const hx = (XW[wk][i] + XW[17 + hand][i] + XW[19 + hand][i]) / 3, hy = (YW[wk][i] + YW[17 + hand][i] + YW[19 + hand][i]) / 3;
    let target: Crux['target'] = null;
    for (const h of holds) {
      if (h.kind !== 'hand' || (h.i0 <= i && h.i1 >= i)) continue;
      const dx = h.x - hx, dy = h.y - hy, dm = Math.hypot(dx, dy) * mpp;
      if (dy * mpp > cfg.targetAboveM || dm < cfg.targetMinM || dm > cfg.targetMaxM) continue;
      if (!target || dm < target.distM) target = { x: h.x, y: h.y, distM: dm };
    }
    const cues: Cue[] = [];
    const LR = leg ? 'R' : 'L', oKnee = ang[3 - leg][i], oTxt = isFinite(oKnee) ? ` · other leg ${Math.round(oKnee)}°` : '';
    if (isFinite(knee)) cues.push(knee < cfg.kneeBentDeg ? { bad: 1, t: `Push leg (${LR}) bent ${Math.round(knee)}°${oTxt}` } : { bad: 0, t: `Push leg (${LR}) straight ${Math.round(knee)}°${oTxt}` });
    if (isFinite(hipPct)) cues.push(hipPct < cfg.hipsLowPct ? { bad: 1, t: `Hips low — ${Math.round(hipPct * 100)}% of foot→hand` } : { bad: 0, t: `Hips up — ${Math.round(hipPct * 100)}% of foot→hand` });
    if (isFinite(elbow)) cues.push(elbow < cfg.elbowBentDeg ? { bad: 1, t: `Reach arm bent ${Math.round(elbow)}°` } : { bad: 0, t: `Reach arm long ${Math.round(elbow)}°` });
    if (isFinite(ext)) cues.push(ext < cfg.reachLowPct ? { bad: 1, t: `Body at ${Math.round(ext * 100)}% of full reach` } : { bad: 0, t: `Body at ${Math.round(ext * 100)}% of full reach` });
    if (target) cues.push({ bad: 1, t: `Next hold ~${Math.round(target.distM * 100)} cm away` });
    if (isFinite(comUp)) cues.push({ bad: 0, t: comUp > cfg.dynamicMs ? `Moving up ${comUp.toFixed(2)} m/s (dynamic)` : `Static at max reach (${comUp.toFixed(2)} m/s)` });
    const tips: string[] = [], gapCm = target ? Math.round(target.distM * 100) : null;
    if (isFinite(knee) && knee < cfg.kneeBentDeg) tips.push('Straighten the push leg fully before you let go — drive through the foot.');
    if (isFinite(hipPct) && hipPct < cfg.hipsLowPct) tips.push('Get the hips up first: step the feet higher or rock over before the move.');
    if (isFinite(elbow) && elbow < cfg.elbowBentDeg) tips.push('Reach from a straight arm — turn the hip into the wall to add length.');
    if (isFinite(ext) && ext < cfg.reachLowPct && tips.length < 2) tips.push('Use your full length: flag a leg, rise on the toes, twist the hip in.');
    if (gapCm && !tips.length) tips.push(isFinite(comUp) && comUp > cfg.dynamicMs ? `Moving but still ${gapCm} cm short — generate more: sink lower, then drive with the legs.` : `Static reach maxed out, ${gapCm} cm short — go dynamic (deadpoint) or find a higher foot first.`);
    else if (gapCm && tips.length) tips.push(`Fixing this should help close the ~${gapCm} cm gap.`);
    if (a.lastHold) cues.unshift({ bad: 0, t: `High point: hand hold #${a.lastHold.n}${isFinite(a.lastHoldM!) ? ` · ${a.lastHoldM!.toFixed(1)} m up` : ''}` });
    cruxes.push({ lastHold: a.lastHold, lastHoldM: a.lastHoldM, att: a.n, i, hand, leg, knee, elbow, otherElbow, hipPct, ext, comUp, target, cues, tips: tips.slice(0, 3), end: a.end });
  }
  return cruxes;
}

/** Add the load reading at each crux (share of weight on the hands) as a cue and maybe a tip. */
export function addLoadCues(cruxes: Crux[], handShare: F32, cfg = CONFIG.crux): void {
  for (const c of cruxes) {
    const hsC = handShare[c.i];
    c.handShare = hsC;
    if (isFinite(hsC)) {
      c.cues.splice(c.cues.length - 1, 0, hsC > cfg.handsHeavyShare ? { bad: 1, t: `Hands carrying ${Math.round(hsC * 100)}% of body weight` } : { bad: 0, t: `Feet carrying ${Math.round((1 - hsC) * 100)}% of body weight` });
      if (hsC > cfg.handsHeavyShare && c.tips.length < 3) c.tips.push('Weight is on the arms — set the feet so they take more load before the reach.');
    }
  }
}
