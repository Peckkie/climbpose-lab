// Labels vs the app's result: match attempts (IoU ≥ 0.3) and measure the errors.
// Shared by `npm run eval` (tests/eval) and the app's LABEL card, so both report the same numbers.
import type { Analysis } from '../types';
import type { Labels } from '.';

export const MATCH_IOU = 0.3;
export const CRUX_TOL_S = 0.5;

export interface PredAttempt { s: number; e: number; sent: boolean; n: number; cruxS: number | null; }

export interface CompareRow {
  label: number | null; pred: number | null;       // attempt indices (null = missed / extra)
  labelText: string; predText: string;
  startErrS?: number; endErrS?: number; iou?: number; sentOk?: boolean;
  cruxErrS?: number | null;                         // |pred crux − labelled crux|, null = no predicted crux
}

export interface CompareSummary {
  tp: number; fp: number; fn: number;
  startErr: number[]; endErr: number[]; sentOk: number; sentN: number;
  cruxFound: number; cruxExpected: number;          // not-sent attempts with a predicted crux
  cruxErr: number[];                                // for labelled crux times
}

export const iou = (a: [number, number], b: [number, number]): number => {
  const inter = Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0])), uni = Math.max(a[1], b[1]) - Math.min(a[0], b[0]);
  return uni > 0 ? inter / uni : 0;
};

export function predictedAttempts(D: Analysis): PredAttempt[] {
  return D.attempts.map((a) => {
    const c = D.cruxes.find((x) => x.att === a.n);
    return { s: D.t0 + a.i0 / D.fps, e: D.t0 + a.i1 / D.fps, sent: !!a.sent, n: a.n, cruxS: c ? D.t0 + c.i / D.fps : null };
  });
}

const span = (s: number, e: number) => `${s.toFixed(1)}-${e.toFixed(1)}s`;

export function compareLabels(L: Labels, pred: PredAttempt[]): { rows: CompareRow[]; sum: CompareSummary } {
  const rows: CompareRow[] = [], used = new Set<number>();
  const sum: CompareSummary = { tp: 0, fp: 0, fn: 0, startErr: [], endErr: [], sentOk: 0, sentN: 0, cruxFound: 0, cruxExpected: 0, cruxErr: [] };
  L.attempts.forEach((g, gi) => {
    let best = -1, bi = 0;
    pred.forEach((p, j) => { if (used.has(j)) return; const v = iou([g.start_s, g.end_s], [p.s, p.e]); if (v > bi) { bi = v; best = j; } });
    const labelText = `${span(g.start_s, g.end_s)} ${g.sent ? 'sent' : 'not sent'}`;
    if (best < 0 || bi < MATCH_IOU) { sum.fn++; rows.push({ label: gi, pred: null, labelText, predText: 'MISSED' }); return; }
    used.add(best); sum.tp++;
    const p = pred[best];
    sum.startErr.push(Math.abs(p.s - g.start_s)); sum.endErr.push(Math.abs(p.e - g.end_s));
    sum.sentN++; if (p.sent === g.sent) sum.sentOk++;
    if (!g.sent) { sum.cruxExpected++; if (p.cruxS != null) sum.cruxFound++; }
    let cruxErrS: number | null | undefined;
    if (g.crux_s != null) { cruxErrS = p.cruxS != null ? Math.abs(p.cruxS - g.crux_s) : null; if (cruxErrS != null) sum.cruxErr.push(cruxErrS); }
    rows.push({ label: gi, pred: best, labelText, predText: `${span(p.s, p.e)} ${p.sent ? 'sent' : 'not sent'}`,
      startErrS: +(p.s - g.start_s).toFixed(2), endErrS: +(p.e - g.end_s).toFixed(2), iou: +bi.toFixed(2), sentOk: p.sent === g.sent, cruxErrS });
  });
  pred.forEach((p, j) => { if (!used.has(j)) { sum.fp++; rows.push({ label: null, pred: j, labelText: '—', predText: `EXTRA ${span(p.s, p.e)}` }); } });
  return { rows, sum };
}

/** Merge per-clip summaries (eval over many clips). */
export function mergeSummaries(list: CompareSummary[]): CompareSummary {
  const out: CompareSummary = { tp: 0, fp: 0, fn: 0, startErr: [], endErr: [], sentOk: 0, sentN: 0, cruxFound: 0, cruxExpected: 0, cruxErr: [] };
  for (const s of list) {
    out.tp += s.tp; out.fp += s.fp; out.fn += s.fn; out.sentOk += s.sentOk; out.sentN += s.sentN;
    out.cruxFound += s.cruxFound; out.cruxExpected += s.cruxExpected;
    out.startErr.push(...s.startErr); out.endErr.push(...s.endErr); out.cruxErr.push(...s.cruxErr);
  }
  return out;
}

const mean = (a: number[]) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null);
const within = (a: number[], t: number) => (a.length ? +(a.filter((x) => x <= t).length / a.length).toFixed(2) : null);

/** The numbers in tests/eval/last-report.json (ROADMAP v1.0 targets). */
export function metrics(s: CompareSummary) {
  return {
    labelledAttempts: s.tp + s.fn,
    attemptRecall: +(s.tp / Math.max(1, s.tp + s.fn)).toFixed(2), attemptPrecision: +(s.tp / Math.max(1, s.tp + s.fp)).toFixed(2),
    startErrMeanS: mean(s.startErr), endErrMeanS: mean(s.endErr),
    startWithin0_7s: within(s.startErr, 0.7), endWithin0_7s: within(s.endErr, 0.7),
    sendAccuracy: s.sentN ? +(s.sentOk / s.sentN).toFixed(2) : null,
    cruxCoverage: s.cruxExpected ? +(s.cruxFound / s.cruxExpected).toFixed(2) : null,
    cruxLabelled: s.cruxErr.length, cruxErrMeanS: mean(s.cruxErr), cruxWithin0_5s: within(s.cruxErr, CRUX_TOL_S),
  };
}
