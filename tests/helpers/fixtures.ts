// Load pose fixtures (tests/fixtures/*.pose.json.gz) into a RawTrack, exactly as the browser
// replayed them when the v0.2 golden outputs were made (ints / scale, null → NaN or 0).

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import type { Env, RawTrack, Settings } from '../../src/types';

export const FIXTURE_DIR = join(__dirname, '..', 'fixtures');
export const LOCAL_DIR = join(FIXTURE_DIR, 'local'); // not committed (other people's clips)

export interface PoseFixture {
  format: string; clip: string; createdWith: string;
  settings: { heightCm: number; fps: number; model: string; wallDeg: number; weightKg: number | null; cameraCompensation: boolean; lrFix: boolean };
  env: Env; N: number; fps: number; t0: number; t1: number; width: number; height: number;
  scale: { xy: number; vis: number };
  x: (number | null)[]; y: (number | null)[]; vis: (number | null)[]; ox: (number | null)[]; oy: (number | null)[];
}

export function readJson<T>(path: string): T {
  const buf = readFileSync(path);
  return JSON.parse((path.endsWith('.gz') ? gunzipSync(buf) : buf).toString('utf8')) as T;
}

export function toRawTrack(f: PoseFixture): RawTrack {
  const s = f.scale.xy, sv = f.scale.vis;
  const dec = (a: (number | null)[]) => Float32Array.from(a, (q) => (q === null ? NaN : q / s));
  return {
    N: f.N, fps: f.fps, t0: f.t0, t1: f.t1, vw: f.width, vh: f.height,
    X: dec(f.x), Y: dec(f.y), V: Float32Array.from(f.vis, (q) => (q === null ? 0 : q / sv)),
    OX: dec(f.ox), OY: dec(f.oy),
  };
}

export function fixtureSettings(f: PoseFixture): Settings {
  return { heightCm: f.settings.heightCm, weightKg: f.settings.weightKg, wallDeg: f.settings.wallDeg, lrFix: f.settings.lrFix };
}

/** All clips that have a pose fixture (committed + local). */
export function listFixtures(): { name: string; pose: string; golden: string | null; labels: string | null }[] {
  const out: { name: string; pose: string; golden: string | null; labels: string | null }[] = [];
  for (const dir of [FIXTURE_DIR, LOCAL_DIR]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      // .pose.json.gz (committed, compact) or .pose.json (straight from the app's "Pose fixture" button)
      if (!/\.pose\.json(\.gz)?$/.test(f)) continue;
      const name = f.replace(/\.pose\.json(\.gz)?$/, '');
      if (f.endsWith('.pose.json') && existsSync(join(dir, `${name}.pose.json.gz`))) continue;
      const g = join(dir, `${name}.v02.golden.json`), l = join(dir, `${name}.labels.json`);
      out.push({ name, pose: join(dir, f), golden: existsSync(g) ? g : null, labels: existsSync(l) ? l : null });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
