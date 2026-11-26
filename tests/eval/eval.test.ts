// Accuracy report against hand-checked labels (tests/fixtures/*.labels.json).
// Run: npm run eval. Writes tests/eval/last-report.json so commits can be compared.
// This is a measurement, not a gate: it only fails if the pipeline crashes.

import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listFixtures, readJson, toRawTrack, fixtureSettings, type PoseFixture } from '../helpers/fixtures';
import { runPipeline } from '../../src/core/pipeline';

interface LabelAttempt { start_s: number; end_s: number; sent: boolean; note?: string; }
interface Labels { clip: string; status: string; toleranceS: number; attempts: LabelAttempt[]; }

const iou = (a: [number, number], b: [number, number]) => {
  const inter = Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0])), uni = Math.max(a[1], b[1]) - Math.min(a[0], b[0]);
  return uni > 0 ? inter / uni : 0;
};

describe('eval vs labels', () => {
  const cases = listFixtures().filter((c) => c.labels);
  it('has labelled clips', () => { expect(cases.length).toBeGreaterThan(0); });
  it('report', () => {
    const rows: Record<string, unknown>[] = [];
    let tp = 0, fp = 0, fn = 0, sentOk = 0, sentN = 0, cruxOk = 0, cruxN = 0;
    const startErr: number[] = [], endErr: number[] = [];
    for (const c of cases) {
      const fx = readJson<PoseFixture>(c.pose), lab = readJson<Labels>(c.labels!);
      const D = runPipeline({ raw: toRawTrack(fx), settings: fixtureSettings(fx), env: fx.env });
      const pred = D.attempts.map((a) => ({ s: D.t0 + a.i0 / D.fps, e: D.t0 + a.i1 / D.fps, sent: !!a.sent, n: a.n }));
      const used = new Set<number>();
      for (const g of lab.attempts) {
        let best = -1, bi = 0;
        pred.forEach((p, j) => { if (used.has(j)) return; const v = iou([g.start_s, g.end_s], [p.s, p.e]); if (v > bi) { bi = v; best = j; } });
        if (best >= 0 && bi >= 0.3) {
          used.add(best); tp++;
          const p = pred[best];
          startErr.push(Math.abs(p.s - g.start_s)); endErr.push(Math.abs(p.e - g.end_s));
          sentN++; if (p.sent === g.sent) sentOk++;
          // crux expected for every not-sent attempt that ended inside the clip
          if (!g.sent) { cruxN++; if (D.cruxes.some((x) => x.att === p.n)) cruxOk++; }
          rows.push({ clip: c.name, label: `${g.start_s}-${g.end_s}s ${g.sent ? 'sent' : 'not sent'}`, pred: `${p.s.toFixed(1)}-${p.e.toFixed(1)}s ${p.sent ? 'sent' : 'not sent'}`, startErrS: +(p.s - g.start_s).toFixed(2), endErrS: +(p.e - g.end_s).toFixed(2), iou: +bi.toFixed(2), sentOk: p.sent === g.sent });
        } else { fn++; rows.push({ clip: c.name, label: `${g.start_s}-${g.end_s}s`, pred: 'MISSED' }); }
      }
      pred.forEach((p, j) => { if (!used.has(j)) { fp++; rows.push({ clip: c.name, label: '—', pred: `EXTRA ${p.s.toFixed(1)}-${p.e.toFixed(1)}s` }); } });
    }
    const mean = (a: number[]) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null);
    const within = (a: number[], t: number) => (a.length ? +(a.filter((x) => x <= t).length / a.length).toFixed(2) : null);
    const summary = {
      clips: cases.length, labelledAttempts: tp + fn,
      attemptRecall: +(tp / Math.max(1, tp + fn)).toFixed(2), attemptPrecision: +(tp / Math.max(1, tp + fp)).toFixed(2),
      startErrMeanS: mean(startErr), endErrMeanS: mean(endErr),
      startWithin0_7s: within(startErr, 0.7), endWithin0_7s: within(endErr, 0.7),
      sendAccuracy: sentN ? +(sentOk / sentN).toFixed(2) : null, cruxCoverage: cruxN ? +(cruxOk / cruxN).toFixed(2) : null,
    };
    console.table(rows);
    console.log('SUMMARY', JSON.stringify(summary, null, 2));
    writeFileSync(join(__dirname, 'last-report.json'), JSON.stringify({ date: new Date().toISOString(), summary, rows }, null, 2));
    expect(summary.labelledAttempts).toBeGreaterThan(0);
  });
});
