// Unit tests for the pure parts of the app modules (route, environment, export timeline).
import { describe, it, expect } from 'vitest';
import { parseMapsLink, parseColors, routeKey, routeLabel, type RouteInfo } from '../../src/route';
import { classifyEnv, envText } from '../../src/environment';
import { buildTimeline, segmentFrames, OUT_FPS } from '../../src/export/video';
import { runPipeline } from '../../src/core/pipeline';
import { listFixtures, readJson, toRawTrack, fixtureSettings, type PoseFixture } from '../helpers/fixtures';

describe('M15 route', () => {
  it('reads name + coordinates from a full Google Maps link', () => {
    const r = parseMapsLink('https://www.google.com/maps/place/Rock+Gym+Bangkok/@13.7563,100.5018,17z/data=!3d13.75631!4d100.50182')!;
    expect(r.name).toBe('Rock Gym Bangkok'); expect(r.lat).toBeCloseTo(13.75631); expect(r.lng).toBeCloseTo(100.50182); expect(r.short).toBe(false);
  });
  it('keeps short links without a name', () => {
    const r = parseMapsLink('https://maps.app.goo.gl/abc123')!;
    expect(r.short).toBe(true); expect(r.name).toBeUndefined();
    expect(parseMapsLink('  ')).toBeNull();
  });
  it('colour circuits, labels and keys', () => {
    expect(parseColors('Yellow=V0-V1, Green=V2')).toEqual([{ color: 'Yellow', grade: 'V0-V1' }, { color: 'Green', grade: 'V2' }]);
    const r: RouteInfo = { environment: 'gym', gym: 'G', gym_map: null, system: 'V', grade: 'V3', tag: 'Blue', tagHex: '#3E63DD', name: ' Arete ' };
    expect(routeLabel({ ...r, name: 'Arete' })).toBe('V3 · Blue · Arete');
    expect(routeKey(r)).toBe('gym|g|v3|blue|arete');
  });
});

describe('M14 environment', () => {
  it('smooth panels + vivid holds = gym; texture + plants = rock', () => {
    expect(classifyEnv([{ smooth: 0.5, vivid: 0.05, veg: 0 }]).env).toBe('gym');
    expect(classifyEnv([{ smooth: 0.1, vivid: 0.01, veg: 0.2 }]).env).toBe('rock');
    expect(envText('rock').sent).toBe('TOPPED OUT ✓'); expect(envText('gym').map).toEqual(['ROUTE', 'MAP']);
  });
});

describe('M13 export timeline', () => {
  const fx = listFixtures().find((f) => f.name === 'IMG_4497')!;
  const f = readJson<PoseFixture>(fx.pose);
  const D = runPipeline({ raw: toRawTrack(f), settings: fixtureSettings(f), env: f.env });
  it('covers every clip frame once, with a freeze after each crux / send frame', () => {
    const tl = buildTimeline(D, { freezes: true });
    const clip = tl.filter((s) => s.kind === 'clip') as { k0: number; k1: number }[];
    expect(clip[0].k0).toBe(0);
    for (let n = 1; n < clip.length; n++) expect(clip[n].k0).toBe(clip[n - 1].k1);
    expect(clip[clip.length - 1].k1).toBe(Math.round((D.t1 - D.t0) * OUT_FPS));
    expect(tl.filter((s) => s.kind === 'crux').length).toBe(D.cruxes.length);
    expect(tl.filter((s) => s.kind === 'send').length).toBe(D.sends.length);
    expect(tl[tl.length - 1].kind).toBe('end');
    expect(tl.some((s) => s.kind === 'route')).toBe(D.holds.length > 0);
  });
  it('without freezes it is clip + route + end', () => {
    const tl = buildTimeline(D, { freezes: false });
    expect(tl.map((s) => s.kind)).toEqual(['clip', 'route', 'end']);
    expect(tl.reduce((n, s) => n + segmentFrames(s), 0)).toBe(Math.round((D.t1 - D.t0) * OUT_FPS) + Math.round(4.5 * OUT_FPS) + Math.round(3.5 * OUT_FPS));
  });
});

describe('clip quality', () => {
  const issues = (name: string) => {
    const fx = listFixtures().find((f) => f.name === name)!, f = readJson<PoseFixture>(fx.pose);
    return runPipeline({ raw: toRawTrack(f), settings: fixtureSettings(f), env: f.env }).quality.map((q) => q.id).sort();
  };
  it('a steady, clear gym clip only gets the body-weight note', () => { expect(issues('IMG_4034')).toEqual(['weight']); });
  it('a hand-held clip that pans and zooms gets camera / scale / edge warnings', () => { expect(issues('IMG_4497')).toEqual(['camera', 'edge', 'scale', 'weight']); });
});

describe('crux sequence frames', () => {
  it('6 frames over 2.5 s ending at the crux, never before the attempt starts', async () => {
    const { sequenceFrames } = await import('../../src/export/sequence');
    expect(sequenceFrames(300, 0, 30)).toEqual([225, 240, 255, 270, 285, 300]);
    const short = sequenceFrames(40, 20, 30);
    expect(short[0]).toBe(20); expect(short[5]).toBe(40);
  });
});

describe('coaching rule table', () => {
  it('every cue and tip has English and Thai text; English matches what core writes', async () => {
    const { CUES, TIPS, sayCue, sayTip } = await import('../../src/coaching');
    const p = { lr: 'R', deg: 126, o: 174, pct: 34, cm: 34, ms: '0.15', n: 2, m: '1.7' };
    for (const id of Object.keys(CUES) as (keyof typeof CUES)[]) { expect(sayCue(id, p, 'en').length).toBeGreaterThan(5); expect(sayCue(id, p, 'th')).toMatch(/[฀-๿]/); }
    for (const id of Object.keys(TIPS) as (keyof typeof TIPS)[]) { expect(sayTip(id, p, 'en').length).toBeGreaterThan(5); expect(sayTip(id, p, 'th')).toMatch(/[฀-๿]/); }
    const fx = listFixtures().find((f) => f.name === 'IMG_4497')!, f = readJson<PoseFixture>(fx.pose);
    const D = runPipeline({ raw: toRawTrack(f), settings: fixtureSettings(f), env: f.env });
    for (const c of D.cruxes) {
      for (const q of c.cues) expect(sayCue(q.id, q.p)).toBe(q.t);
      expect(c.tipKeys.map((k) => sayTip(k.id, k.p))).toEqual(c.tips);
    }
  });
});

describe('compare attempts', () => {
  it('aligns by height reached, not by time', async () => {
    const { alignByHeight } = await import('../../src/core/compare');
    // attempt a: frames 0–4 climbs 0.1 → 0.5; attempt b: frames 5–14 climbs slower 0.1 → 1.0
    const h = Float32Array.from([0.1, 0.2, 0.3, 0.4, 0.5, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 1.0]);
    expect(Array.from(alignByHeight(h, { i0: 0, i1: 5 }, { i0: 5, i1: 15 }))).toEqual([5, 7, 9, 11, 13]);
    // b never gets as high as a's top → -1
    expect(Array.from(alignByHeight(h, { i0: 5, i1: 15 }, { i0: 0, i1: 5 })).slice(-2)).toEqual([4, -1]);
  });
  it('picks a sent attempt, else the highest', async () => {
    const { pickGhost } = await import('../../src/core/compare');
    const A = (n: number, sent: boolean, highComM: number) => ({ n, sent, highComM, i0: 0, i1: 1, dur: 1, highFootM: 0, end: 'fall / jump-off' as const });
    const list = [A(1, false, 1.2), A(2, false, 1.6), A(3, true, 1.4)];
    expect(pickGhost(list, list[0])!.n).toBe(3);
    expect(pickGhost(list, list[2])!.n).toBe(2);
    expect(pickGhost([list[0]], list[0])).toBeNull();
  });
});

describe('saved sessions', () => {
  const fx = listFixtures().find((f) => f.name === 'IMG_4497')!;
  const f = readJson<PoseFixture>(fx.pose), raw = toRawTrack(f), settings = fixtureSettings(f);
  const D = runPipeline({ raw, settings, env: f.env });
  const route = { environment: 'gym' as const, gym: 'Test gym', gym_map: null, system: 'V' as const, grade: 'V3', tag: 'Blue', tagHex: null, name: '' };
  it('raw pose survives encode → decode (fixture precision)', async () => {
    const { encodeRaw, decodeRaw } = await import('../../src/history/raw');
    const back = decodeRaw(JSON.parse(JSON.stringify(encodeRaw(raw))));
    expect(Array.from(back.X.slice(0, 500))).toEqual(Array.from(raw.X.slice(0, 500)));
    expect(Array.from(back.CA!.slice(0, 50))).toEqual(Array.from(raw.CA!.slice(0, 50)));
  });
  it('records sends and the attempt of the first send', async () => {
    const { sessionSummary } = await import('../../src/history');
    const s = sessionSummary(D, route, 'IMG_4497');
    expect(s.sends).toBe(1); expect(s.attemptsToSend).toBe(2);
  });
  it('saves, finds the same clip, re-analyses and round-trips a session file', async () => {
    const h = await import('../../src/history');
    const saved = h.makeSaved(D, raw, { route, srcName: 'IMG_4497', settings, env: f.env, edits: { add: [], remove: [], attemptResult: {} }, clip: { file: 'IMG_4497.MOV', duration: 51.7 }, app: 'test' });
    await h.saveSession(saved);
    expect((await h.findSavedForClip('IMG_4497.MOV', 51.72))!.id).toBe(saved.id);
    expect(await h.findSavedForClip('IMG_4497.MOV', 40)).toBeNull();
    const again = h.reanalyse({ ...saved, flow: -1 }, 'test2');
    expect(again.flow).toBe(D.M.flow); expect(again.date).toBe(saved.date); expect(again.analysedWith).toBe('test2');
    const back = h.parseSessionFile(h.sessionFile(saved));
    expect(back.id).toBe(saved.id); expect(back.raw!.N).toBe(raw.N);
    expect(() => h.parseSessionFile('{"format":"x"}')).toThrow();
    await h.deleteSession(saved.id);
    expect(await h.findSavedForClip('IMG_4497.MOV', 51.7)).toBeNull();
  });
});

describe('progress series', () => {
  const S = (date: string, grade: string, name: string, flow: number, extra: object = {}) => ({
    id: date + name, date, src: 'clip', key: `gym|g|${grade.toLowerCase()}||${name}`, flow, scores: {}, attempts: 2, tops: 0,
    highFootM: 1, handShare: 50, cruxGapCm: 20, cruxes: 1,
    route: { environment: 'gym' as const, gym: 'G', gym_map: null, system: 'V' as const, grade, tag: '', tagHex: null, name }, ...extra,
  });
  it('groups by route (most sessions first) and by grade across 2+ routes; sorts by date', async () => {
    const { progressGroups, progressSeries } = await import('../../src/history/progress');
    const list = [S('2026-11-20', 'V3', 'arete', 60), S('2026-11-10', 'V3', 'arete', 55), S('2026-11-25', 'V3', 'roof', 70, { sends: 1, attemptsToSend: 1 }), S('2026-11-01', '', '', 40)];
    const g = progressGroups(list);
    expect(g.map((x) => [x.kind, x.label, x.count])).toEqual([['route', 'V3 · arete · G', 2], ['route', 'V3 · roof · G', 1], ['grade', 'V3', 3]]);
    expect(progressSeries(list, g[0].id).map((p) => p.flow)).toEqual([55, 60]);
    const grade = progressSeries(list, g[2].id);
    expect(grade.map((p) => p.date.slice(5))).toEqual(['11-10', '11-20', '11-25']);
    expect(grade[2]).toMatchObject({ sent: true, flash: true });
  });
});
