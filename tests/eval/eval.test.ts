// Accuracy report against hand-checked labels (tests/fixtures/*.labels.json).
// Run: npm run eval. Writes tests/eval/last-report.json so commits can be compared.
// This is a measurement, not a gate: it only fails if the pipeline crashes.
// Matching and metrics live in src/labeling/compare.ts (the app's LABEL card uses the same code).

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listFixtures, readJson, toRawTrack, fixtureSettings, type PoseFixture } from '../helpers/fixtures';
import { runPipeline } from '../../src/core/pipeline';
import { parseLabels } from '../../src/labeling';
import { compareLabels, mergeSummaries, metrics, predictedAttempts, type CompareSummary } from '../../src/labeling/compare';

describe('eval vs labels', () => {
  const cases = listFixtures().filter((c) => c.labels);
  it('has labelled clips', () => { expect(cases.length).toBeGreaterThan(0); });
  it('report', () => {
    const rows: Record<string, unknown>[] = [], sums: CompareSummary[] = [];
    for (const c of cases) {
      const fx = readJson<PoseFixture>(c.pose), lab = parseLabels(readFileSync(c.labels!, 'utf8'));
      const D = runPipeline({ raw: toRawTrack(fx), settings: fixtureSettings(fx), env: fx.env });
      const { rows: r, sum } = compareLabels(lab, predictedAttempts(D));
      sums.push(sum);
      for (const x of r) rows.push({
        clip: c.name, label: x.labelText, pred: x.predText,
        ...(x.iou != null ? { startErrS: x.startErrS, endErrS: x.endErrS, iou: x.iou, sentOk: x.sentOk } : {}),
        ...(x.cruxErrS !== undefined ? { cruxErrS: x.cruxErrS == null ? null : +x.cruxErrS.toFixed(2) } : {}),
      });
    }
    const summary = { clips: cases.length, ...metrics(mergeSummaries(sums)) };
    console.table(rows);
    console.log('SUMMARY', JSON.stringify(summary, null, 2));
    writeFileSync(join(__dirname, 'last-report.json'), JSON.stringify({ date: new Date().toISOString(), summary, rows }, null, 2));
    expect(summary.labelledAttempts).toBeGreaterThan(0);
  });
});
