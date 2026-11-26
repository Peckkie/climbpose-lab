// Unit tests for src/labeling: marking, validation, file round trip, comparison with results.
import { describe, it, expect } from 'vitest';
import {
  newLabels, newSession, markStart, markEnd, markCrux, markLastHold, toggleSent, markLr, removeAttempt,
  validateLabels, parseLabels, serializeLabels, attemptAt, LabelError,
} from '../../src/labeling';
import { compareLabels, metrics, iou } from '../../src/labeling/compare';

describe('labeling: marking', () => {
  it('start → end makes an attempt; crux / last hold / sent go to the attempt at that time', () => {
    const s = newSession(newLabels('clipA', 'Peggy'));
    markStart(s, 13.04); markEnd(s, 51.4);
    markStart(s, 0.31); markEnd(s, 5.8);
    expect(s.labels.attempts.map((a) => [a.start_s, a.end_s])).toEqual([[0.31, 5.8], [13.04, 51.4]]);
    markCrux(s.labels, 5.2); markLastHold(s.labels, 38.9); toggleSent(s.labels, 40);
    expect(s.labels.attempts[0].crux_s).toBe(5.2);
    expect(s.labels.attempts[1]).toMatchObject({ last_hold_s: 38.9, sent: true });
    expect(attemptAt(s.labels, 9)).toBeNull();
    expect(validateLabels(s.labels)).toEqual([]);
  });
  it('end before start is swapped; overlaps, tiny spans and marks outside attempts are refused', () => {
    const s = newSession(newLabels('c'));
    markStart(s, 10); markEnd(s, 4);
    expect(s.labels.attempts[0]).toMatchObject({ start_s: 4, end_s: 10 });
    expect(() => markStart(s, 6)).toThrow(LabelError);
    markStart(s, 2); expect(() => markEnd(s, 5)).toThrow(/overlaps/);
    s.openStart = 20; expect(() => markEnd(s, 20.1)).toThrow(/shorter/);
    expect(() => markEnd(newSession(newLabels('x')), 3)).toThrow(/start/);
    expect(() => markCrux(s.labels, 30)).toThrow(/no labelled attempt/);
  });
  it('left/right spans open then close', () => {
    const s = newSession(newLabels('c'));
    expect(markLr(s, 3.7, 'legs')).toBeNull();
    expect(markLr(s, 3.2)).toEqual({ start_s: 3.2, end_s: 3.7, part: 'legs' });
    expect(s.labels.lrErrors).toHaveLength(1);
  });
  it('validation catches a sent attempt with a crux', () => {
    const L = newLabels('c'); L.attempts.push({ start_s: 0, end_s: 5, sent: true, crux_s: 4 });
    expect(validateLabels(L)).toEqual(['attempt 1: marked sent but has a crux']);
    removeAttempt(L, 0); expect(L.attempts).toEqual([]);
  });
});

describe('labeling: file', () => {
  it('round trip keeps only set fields; older drafts parse', () => {
    const L = newLabels('IMG_1', 'me'); L.attempts.push({ start_s: 1, end_s: 9, sent: false, crux_s: 8.5, last_hold_s: null, fall_reason: 'hips low' });
    const text = serializeLabels(L, new Date('2026-11-26T00:00:00Z'));
    const back = parseLabels(text);
    expect(back.attempts[0]).toEqual({ start_s: 1, end_s: 9, sent: false, crux_s: 8.5, fall_reason: 'hips low' });
    expect(back.updated).toBe('2026-11-26T00:00:00.000Z');
    expect(JSON.parse(text).lrErrors).toBeUndefined();
    const old = parseLabels(JSON.stringify({ format: 'climbpose.labels/1', clip: 'x', status: 'draft', labeledBy: 'a', toleranceS: 0.7, attempts: [{ start_s: 0, end_s: 2, sent: true }] }));
    expect(old.lrErrors).toEqual([]);
    expect(() => parseLabels('{"format":"other"}')).toThrow(LabelError);
    expect(() => parseLabels('{"format":"climbpose.labels/1","attempts":[{"start_s":1}]}')).toThrow(LabelError);
  });
});

describe('labeling: compare', () => {
  it('matches by IoU, counts missed / extra, crux timing', () => {
    expect(iou([0, 10], [5, 15])).toBeCloseTo(1 / 3);
    const L = newLabels('c');
    L.attempts.push({ start_s: 0, end_s: 6, sent: false, crux_s: 5.5 }, { start_s: 13, end_s: 51, sent: true }, { start_s: 60, end_s: 62, sent: false });
    const pred = [
      { s: 0.2, e: 6.1, sent: false, n: 1, cruxS: 5.8 },
      { s: 12.5, e: 51.5, sent: true, n: 2, cruxS: null },
      { s: 70, e: 75, sent: false, n: 3, cruxS: null },
    ];
    const { rows, sum } = compareLabels(L, pred);
    expect(sum).toMatchObject({ tp: 2, fn: 1, fp: 1, sentOk: 2, cruxExpected: 1, cruxFound: 1 });
    expect(rows.find((r) => r.label === 2)!.predText).toBe('MISSED');
    expect(rows.find((r) => r.pred === 2)!.predText).toMatch(/^EXTRA/);
    const m = metrics(sum);
    expect(m).toMatchObject({ labelledAttempts: 3, attemptRecall: 0.67, attemptPrecision: 0.67, sendAccuracy: 1, cruxLabelled: 1, cruxErrMeanS: 0.3, cruxWithin0_5s: 1 });
  });
});
