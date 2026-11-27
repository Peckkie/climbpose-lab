// M10 · core/crux — for each attempt that was not sent: the frame of highest reach just before
// coming off, body position measurements there, readable cues and coaching tips.
// Ported 1:1 from v0.2 process(). Measurements and wording are kept together for parity; Phase 5
// moves the wording into an editable rule table.

import { CONFIG } from '../../config';
import type { Attempt, Crux, Cue, F32, Hold, TipKey } from '../../types';
import { sayCue, sayTip, type CueId, type Params, type TipId } from '../../coaching';
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
    // target: nearest hand hold above / level with the hand, not being held right now (by either hand)
    const hx = (XW[wk][i] + XW[17 + hand][i] + XW[19 + hand][i]) / 3, hy = (YW[wk][i] + YW[17 + hand][i] + YW[19 + hand][i]) / 3;
    let target: Crux['target'] = null;
    const heldNow = new Set(holds.filter((h) => h.kind === 'hand' && h.i0 <= i && h.i1 >= i).map((h) => h.n));
    for (const h of holds) {
      if (h.kind !== 'hand' || heldNow.has(h.n)) continue;
      const dx = h.x - hx, dy = h.y - hy, dm = Math.hypot(dx, dy) * mpp;
      if (dy * mpp > cfg.targetAboveM || dm < cfg.targetMinM || dm > cfg.targetMaxM) continue;
      if (!target || dm < target.distM) target = { x: h.x, y: h.y, distM: dm };
    }
    const cues: Cue[] = [];
    const cue = (id: CueId, bad: 0 | 1, p: Params) => cues.push({ id, bad, p, t: sayCue(id, p) });
    const LR = leg ? 'R' : 'L', oKnee = ang[3 - leg][i], o = isFinite(oKnee) ? Math.round(oKnee) : undefined;
    if (isFinite(knee)) cue(knee < cfg.kneeBentDeg ? 'legBent' : 'legStraight', knee < cfg.kneeBentDeg ? 1 : 0, { lr: LR, deg: Math.round(knee), o });
    if (isFinite(hipPct)) cue(hipPct < cfg.hipsLowPct ? 'hipsLow' : 'hipsUp', hipPct < cfg.hipsLowPct ? 1 : 0, { pct: Math.round(hipPct * 100) });
    if (isFinite(elbow)) cue(elbow < cfg.elbowBentDeg ? 'armBent' : 'armLong', elbow < cfg.elbowBentDeg ? 1 : 0, { deg: Math.round(elbow) });
    if (isFinite(ext)) cue('reach', ext < cfg.reachLowPct ? 1 : 0, { pct: Math.round(ext * 100) });
    if (target) cue('nextHold', 1, { cm: Math.round(target.distM * 100) });
    if (isFinite(comUp)) cue(comUp > cfg.dynamicMs ? 'dynamic' : 'static', 0, { ms: comUp.toFixed(2) });
    const tipKeys: TipKey[] = [], gapCm = target ? Math.round(target.distM * 100) : null;
    const tip = (id: TipId, p: Params = {}) => tipKeys.push({ id, p });
    if (isFinite(knee) && knee < cfg.kneeBentDeg) tip('straightenLeg');
    if (isFinite(hipPct) && hipPct < cfg.hipsLowPct) tip('hipsUp');
    if (isFinite(elbow) && elbow < cfg.elbowBentDeg) tip('straightArm');
    if (isFinite(ext) && ext < cfg.reachLowPct && tipKeys.length < 2) tip('fullLength');
    if (gapCm && !tipKeys.length) tip(isFinite(comUp) && comUp > cfg.dynamicMs ? 'dynamicMore' : 'goDynamic', { cm: gapCm });
    else if (gapCm && tipKeys.length) tip('closeGap', { cm: gapCm });
    if (a.lastHold) {
      const p: Params = { n: a.lastHold.n, m: isFinite(a.lastHoldM!) ? a.lastHoldM!.toFixed(1) : undefined };
      cues.unshift({ id: 'highPoint', bad: 0, p, t: sayCue('highPoint', p) });
    }
    const tk = tipKeys.slice(0, 3);
    cruxes.push({ lastHold: a.lastHold, lastHoldM: a.lastHoldM, att: a.n, i, hand, leg, knee, elbow, otherElbow, hipPct, ext, comUp, target, cues, tips: tk.map((k) => sayTip(k.id, k.p)), tipKeys: tk, end: a.end });
  }
  return cruxes;
}

/** Add the load reading at each crux (share of weight on the hands) as a cue and maybe a tip. */
export function addLoadCues(cruxes: Crux[], handShare: F32, cfg = CONFIG.crux): void {
  for (const c of cruxes) {
    const hsC = handShare[c.i];
    c.handShare = hsC;
    if (isFinite(hsC)) {
      const heavy = hsC > cfg.handsHeavyShare, id: CueId = heavy ? 'handsHeavy' : 'feetCarry', p: Params = { pct: Math.round((heavy ? hsC : 1 - hsC) * 100) };
      c.cues.splice(c.cues.length - 1, 0, { id, bad: heavy ? 1 : 0, p, t: sayCue(id, p) });
      if (heavy && c.tips.length < 3) { c.tipKeys.push({ id: 'weightOnArms', p: {} }); c.tips.push(sayTip('weightOnArms', {})); }
    }
  }
}
