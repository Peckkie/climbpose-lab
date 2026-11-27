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
