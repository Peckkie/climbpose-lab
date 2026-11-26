// Phase 1 acceptance: the modular core must reproduce v0.2 exactly on every recorded clip.
// Golden files were produced by running v0.2 (index.html) in the browser on the same rounded pose data.

import { describe, it, expect } from 'vitest';
import { listFixtures, readJson, toRawTrack, fixtureSettings, type PoseFixture } from '../helpers/fixtures';
import { runPipeline } from '../../src/core/pipeline';
import type { Analysis } from '../../src/types';

const rn = (v: number, d = 4) => (isFinite(v) ? +(+v).toFixed(d) : null);
const every10 = (a: ArrayLike<number>) => { const o: (number | null)[] = []; for (let i = 0; i < a.length; i += 10) o.push(rn(a[i])); return o; };

/** Same summary shape as the browser-side golden() dump. */
function summarize(D: Analysis) {
  const metrics: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(D.M)) {
    if (typeof v === 'number') metrics[k] = rn(v, 6);
    else if (v && typeof v === 'object') metrics[k] = JSON.parse(JSON.stringify(v));
  }
  return {
    env: D.env, mpp: rn(D.mpp, 8), torsoPx: rn(D.torsoPx, 4), y0: rn(D.y0, 4), metrics,
    scores: Object.fromEntries(Object.entries(D.sc).map(([k, v]) => [k, rn(v, 6)])),
    holds: D.holds.map((h) => ({ n: h.n, kind: h.kind, limb: h.limb, x: rn(h.x, 3), y: rn(h.y, 3), i0: h.i0, i1: h.i1 })),
    attempts: D.attempts.map((a) => ({ n: a.n, i0: a.i0, i1: a.i1, end: a.end, highFootM: rn(a.highFootM), highComM: rn(a.highComM), sent: a.sent, sentAuto: a.sentAuto, sendI: a.sendI, lastHold: a.lastHold ? a.lastHold.n : null, lastHoldM: rn(a.lastHoldM!) })),
    sends: D.sends.map((x) => ({ att: x.att, i: x.i, how: x.how, hold: x.hold ? x.hold.n : null })),
    cruxes: D.cruxes.map((c) => ({ att: c.att, i: c.i, hand: c.hand, leg: c.leg, knee: rn(c.knee), elbow: rn(c.elbow), hipPct: rn(c.hipPct), ext: rn(c.ext), comUp: rn(c.comUp), handShare: rn(c.handShare!), target: c.target ? rn(c.target.distM) : null, lastHold: c.lastHold ? c.lastHold.n : null, cues: c.cues.map((q) => q.t), tips: c.tips })),
    series: { comX: every10(D.comX), cys: every10(D.cys), speed: every10(D.speed), handShare: every10(D.handShare), LH: every10(D.load.LH), RF: every10(D.load.RF), shL: every10(D.tq.shL), footH: every10(D.footH), onWall: Array.from(D.onWall).join(''), moving: Array.from(D.moving).join('') },
  };
}

/** Deep compare with a tiny tolerance for floats (rounding of the dumps). */
function diff(a: unknown, b: unknown, path = ''): string[] {
  if (typeof a === 'number' && typeof b === 'number') {
    const tol = Math.max(1e-6, 1e-5 * Math.max(Math.abs(a), Math.abs(b)));
    return Math.abs(a - b) <= tol + 1.5e-4 ? [] : [`${path}: ${a} ≠ ${b}`];
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return [`${path}: length ${a.length} ≠ ${b.length}`];
    return a.flatMap((v, i) => diff(v, b[i], `${path}[${i}]`)).slice(0, 20);
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    return [...keys].flatMap((k) => diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`)).slice(0, 20);
  }
  return a === b ? [] : [`${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`];
}

const cases = listFixtures().filter((f) => f.golden);

describe('core parity with v0.2', () => {
  it('has fixtures to test', () => { expect(cases.length).toBeGreaterThan(0); });
  it('negative control: a changed setting is detected', () => {
    const c = cases[0], fx = readJson<PoseFixture>(c.pose);
    const D = runPipeline({ raw: toRawTrack(fx), settings: { ...fixtureSettings(fx), heightCm: fx.settings.heightCm + 10 }, env: fx.env });
    expect(diff(summarize(D), readJson<object>(c.golden!)).length).toBeGreaterThan(0);
  });
  for (const c of cases) {
    it(c.name, () => {
      const fx = readJson<PoseFixture>(c.pose);
      const D = runPipeline({ raw: toRawTrack(fx), settings: fixtureSettings(fx), env: fx.env });
      const got = summarize(D), want = readJson<object>(c.golden!);
      const d = diff(got, want);
      expect(d, d.join('\n')).toEqual([]);
    });
  }
});
