// Regression: the core must reproduce the accepted results (<clip>.golden.json) on every fixture.
// When behaviour changes ON PURPOSE: run `npm run golden:update`, review the git diff of the
// golden files (and `npm run eval`), then commit them together with the code change.
// History: the first goldens were v0.2's own output (Phase 1 parity, commit 50cb66e).

import { describe, it, expect } from 'vitest';
import { listFixtures, readJson, toRawTrack, fixtureSettings, type PoseFixture } from '../helpers/fixtures';
import { summarize, diff } from '../helpers/summary';
import { runPipeline } from '../../src/core/pipeline';

const cases = listFixtures().filter((f) => f.golden);

describe('core regression vs accepted goldens', () => {
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
      const d = diff(summarize(D), readJson<object>(c.golden!));
      expect(d, d.join('\n')).toEqual([]);
    });
  }
});
