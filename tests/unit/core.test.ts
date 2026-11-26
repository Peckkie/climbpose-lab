// Unit tests for the pure core modules with small synthetic inputs.

import { describe, it, expect } from 'vitest';
import { fillGaps, gsmooth, deriv, pct, hull, angleAt, cleanRuns, runs, clamp01 } from '../../src/core/signal';
import { solveStatics } from '../../src/core/load';
import { rejectOutliers, fixLeftRight } from '../../src/core/cleanup';
import { groupHolds, holdCounts } from '../../src/core/segmentation';
import type { Hold, RawTrack } from '../../src/types';

describe('M05 signal', () => {
  it('fillGaps interpolates short interior gaps only', () => {
    const a = Float32Array.from([0, NaN, NaN, 3, NaN, NaN, NaN, NaN, 8, NaN]);
    fillGaps(a, 2);
    expect(Array.from(a.slice(0, 4))).toEqual([0, 1, 2, 3]);
    expect(isNaN(a[5])).toBe(true);  // gap of 4 > 2 stays
    expect(isNaN(a[9])).toBe(true);  // trailing gap stays
  });
  it('gsmooth keeps NaN and preserves constants', () => {
    const o = gsmooth(Float32Array.from([5, 5, NaN, 5, 5]), 1.2);
    expect(isNaN(o[2])).toBe(true);
    expect(o[0]).toBeCloseTo(5); expect(o[4]).toBeCloseTo(5);
  });
  it('deriv of a line is its slope × fps', () => {
    const o = deriv(Float32Array.from([0, 2, 4, 6]), 30);
    expect(Array.from(o)).toEqual([60, 60, 60, 60]);
  });
  it('pct ignores NaN', () => { expect(pct([NaN, 1, 2, 3, 4], 0.5)).toBe(3); expect(isNaN(pct([NaN], 0.5))).toBe(true); });
  it('hull of a square with a centre point', () => { expect(hull([[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]]).length).toBe(4); });
  it('angleAt right angle', () => { expect(angleAt(1, 0, 0, 0, 0, 1)).toBeCloseTo(90); });
  it('cleanRuns flips short interior runs; runs lists ranges', () => {
    const m = Uint8Array.from([1, 1, 1, 0, 1, 1, 1, 0, 0, 0]);
    cleanRuns(m, 2);
    expect(Array.from(m)).toEqual([1, 1, 1, 1, 1, 1, 1, 0, 0, 0]);
    expect(runs(m)).toEqual([[0, 7]]);
  });
  it('clamp01', () => { expect(clamp01(-1)).toBe(0); expect(clamp01(2)).toBe(1); });
});

describe('M11 load statics', () => {
  const check = (rx: number[], ry: number[], w: number[], W: number) => {
    const { fx, fy } = solveStatics(rx, ry, w, W);
    const sx = fx.reduce((a, b) => a + b, 0), sy = fy.reduce((a, b) => a + b, 0);
    const tau = fx.reduce((a, _, q) => a + rx[q] * fy[q] - ry[q] * fx[q], 0);
    expect(sx).toBeCloseTo(0, 3); expect(sy).toBeCloseTo(W, 3); expect(tau).toBeCloseTo(0, 3);
    return { fx, fy };
  };
  it('balances 2 hands + 2 feet', () => { check([-0.3, 0.3, -0.2, 0.2], [0.6, 0.6, -0.6, -0.6], [0.6, 0.6, 1, 1], 60); });
  it('balances with the CoM outside the supports (side pull)', () => { check([-0.6, -0.5, -0.4], [0.5, -0.6, -0.5], [0.6, 1, 1], 60); });
  it('symmetric stance shares symmetrically, feet take more', () => {
    const { fx, fy } = check([-0.3, 0.3, -0.2, 0.2], [0.6, 0.6, -0.6, -0.6], [0.6, 0.6, 1, 1], 60);
    const mag = fx.map((x, q) => Math.hypot(x, fy[q]));
    expect(mag[0]).toBeCloseTo(mag[1], 3); expect(mag[2]).toBeGreaterThan(mag[0]);
  });
  it('one support carries all', () => { expect(solveStatics([0.1], [0.5], [1], 50).fy[0]).toBe(50); });
});

/** A standing person: 33 landmarks, slow sway, N frames. */
function synthPerson(N: number): RawTrack {
  const base: [number, number][] = Array.from({ length: 33 }, () => [500, 500]);
  const set = (k: number, x: number, y: number) => { base[k] = [x, y]; };
  set(0, 500, 300); set(7, 480, 300); set(8, 520, 300);
  set(11, 450, 380); set(12, 550, 380); set(13, 420, 300); set(14, 580, 300); set(15, 410, 220); set(16, 590, 220);
  set(17, 405, 210); set(18, 595, 210); set(19, 410, 205); set(20, 590, 205); set(21, 415, 210); set(22, 585, 210);
  set(23, 470, 560); set(24, 530, 560); set(25, 460, 680); set(26, 540, 680); set(27, 455, 800); set(28, 545, 800);
  set(29, 450, 810); set(30, 550, 810); set(31, 470, 815); set(32, 530, 815);
  const X = new Float32Array(33 * N), Y = new Float32Array(33 * N), V = new Float32Array(33 * N).fill(0.9);
  for (let i = 0; i < N; i++) for (let k = 0; k < 33; k++) { X[k * N + i] = base[k][0] + 3 * Math.sin(i / 10); Y[k * N + i] = base[k][1]; }
  return { N, fps: 30, t0: 0, t1: N / 30, vw: 1080, vh: 1920, X, Y, V, OX: new Float32Array(N), OY: new Float32Array(N) };
}

describe('M04 cleanup', () => {
  it('rejectOutliers drops a short jump to the wall but keeps the rest', () => {
    const R = synthPerson(90);
    for (let i = 40; i < 43; i++) for (let k = 0; k < 33; k++) { R.X[k * R.N + i] += 400; R.Y[k * R.N + i] -= 300; }
    const c = rejectOutliers(R);
    expect(c.rejected).toBe(3);
    expect(Array.from(c.badMask.slice(40, 43))).toEqual([1, 1, 1]);
  });
  it('fixLeftRight undoes a brief whole-arm swap', () => {
    const R = synthPerson(60), N = R.N, orig = R.X.slice();
    for (let i = 20; i < 25; i++) for (const [a, b] of [[13, 14], [15, 16], [17, 18], [19, 20], [21, 22]]) {
      const t = R.X[a * N + i]; R.X[a * N + i] = R.X[b * N + i]; R.X[b * N + i] = t;
    }
    const out = fixLeftRight(R);
    expect(out.swaps.arms).toBe(5);
    for (let i = 20; i < 25; i++) expect(out.X[15 * N + i]).toBeCloseTo(orig[15 * N + i]);
  });
});

describe('M07 hold grouping', () => {
  const H = (limb: string, kind: 'hand' | 'foot', x: number, y: number, i0: number): Hold => ({ limb, kind, x, y, i0, i1: i0 + 10 });
  it('re-grips and matches on one hold share its number; holds further apart do not', () => {
    // mpp = 0.01 m/px → 12 cm = 12 px
    const hs = [H('LH', 'hand', 100, 100, 0), H('RH', 'hand', 108, 102, 5), H('LH', 'hand', 100, 60, 20), H('LH', 'hand', 104, 98, 40), H('LF', 'foot', 100, 100, 3)];
    groupHolds(hs, 0.01, 0.12);
    expect(hs.map((h) => h.n)).toEqual([1, 1, 2, 1, 1]);
  });
  it('counts distinct holds and moves (a limb back on the hold it last held is not a move)', () => {
    const hs = [H('LH', 'hand', 0, 0, 0), H('LH', 'hand', 2, 0, 20), H('RH', 'hand', 1, 0, 25), H('LH', 'hand', 0, -50, 40), H('LF', 'foot', 0, 90, 5), H('tag', 'hand', 0, -50, 60)];
    groupHolds(hs.sort((a, b) => a.i0 - b.i0), 0.01, 0.12);
    expect(holdCounts(hs)).toEqual({ handHolds: 2, footHolds: 1, handMoves: 4, footMoves: 1 });
  });
});

describe('M03 camera similarity', () => {
  it('compose / invert / fit round-trip', async () => {
    const { compose, invert, apply, fitSimilarity, ransacSimilarity } = await import('../../src/core/signal/similarity');
    const m = { a: 1.1 * Math.cos(0.05), b: 1.1 * Math.sin(0.05), tx: 12, ty: -7 };
    const id = compose(m, invert(m));
    expect(id.a).toBeCloseTo(1); expect(id.b).toBeCloseTo(0); expect(id.tx).toBeCloseTo(0); expect(id.ty).toBeCloseTo(0);
    const P: [number, number][] = [[0, 0], [100, 0], [0, 80], [60, 40], [20, 90]], Q = P.map(([x, y]) => apply(m, x, y));
    const f = fitSimilarity(P, Q)!; expect(f.a).toBeCloseTo(m.a); expect(f.ty).toBeCloseTo(m.ty);
    // one gross outlier is ignored by RANSAC
    const Q2 = Q.slice() as [number, number][]; Q2[2] = [500, 500];
    const r = ransacSimilarity([...P, [30, 30], [80, 70]], [...Q2, apply(m, 30, 30), apply(m, 80, 70)], 1)!;
    expect(r.inliers).not.toContain(2); expect(r.m.tx).toBeCloseTo(m.tx, 3);
  });
  it('tracker recovers a pan + zoom of a textured wall', async () => {
    const { SimTracker } = await import('../../src/camera/tracker');
    const { apply, invert } = await import('../../src/core/signal/similarity');
    const W = 180, H = 320;
    // smooth random texture defined in wall coordinates
    const tex = (x: number, y: number) => 128 + 60 * Math.sin(x * 0.21 + Math.sin(y * 0.07) * 3) * Math.cos(y * 0.17 + Math.cos(x * 0.05) * 2) + 30 * Math.sin((x + y) * 0.09);
    const frame = (m: { a: number; b: number; tx: number; ty: number }) => {
      const inv = invert(m), g = new Float32Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [u, v] = apply(inv, x, y); g[y * W + x] = tex(u, v); }
      return g;
    };
    const tr = new SimTracker(W, H);
    let got = tr.push(frame({ a: 1, b: 0, tx: 0, ty: 0 }), null);
    for (let k = 1; k <= 30; k++) { const s = 1 + 0.004 * k; got = tr.push(frame({ a: s, b: 0, tx: -1.2 * k, ty: 0.8 * k }), null); }
    expect(got.a).toBeCloseTo(1.12, 2); expect(got.tx).toBeCloseTo(-36, 0); expect(got.ty).toBeCloseTo(24, 0);
    expect(tr.lost).toBe(0);
  });
});
