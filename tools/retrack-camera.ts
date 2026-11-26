// Re-run the camera tracker (src/camera/tracker.ts) on a clip's video frames, using the climber's
// position from its pose fixture for masking — no pose model needed. Writes the camera track into
// the fixture (or to --out as {cam:[a,b,tx,ty]*N}).
//   npx vite-node tools/retrack-camera.ts <video> <fixture.pose.json[.gz]> [--out file.json | --write]
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { readJson, type PoseFixture } from '../tests/helpers/fixtures';
import { SimTracker, toFullRes, type Box } from '../src/camera/tracker';

const [video, fixturePath, ...rest] = process.argv.slice(2);
const f = readJson<PoseFixture>(fixturePath);
const { N, fps, t0, width: vw, height: vh } = f;
const ms = Math.min(1, 320 / Math.max(vw, vh)), sw = Math.round(vw * ms), sh = Math.round(vh * ms);
const ff = spawnSync('ffmpeg', ['-loglevel', 'error', '-ss', String(t0), '-i', video, '-vf', `fps=${fps},scale=${sw}:${sh}:flags=bilinear,format=gray`, '-frames:v', String(N), '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 });
if (ff.status !== 0) throw new Error(ff.stderr.toString());
const raw = ff.stdout, nf = Math.min(N, Math.floor(raw.length / (sw * sh)));
const s = f.scale.xy, px = (a: (number | null)[], k: number, i: number) => { const v = a[k * N + i]; return v === null ? NaN : v / s; };
const boxAt = (i: number): Box => {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let k = 0; k < 33; k++) { const x = px(f.x, k, i), y = px(f.y, k, i); if (!isFinite(x)) continue; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (!isFinite(x0)) return null;
  x0 /= vw; x1 /= vw; y0 /= vh; y1 /= vh;
  const mx = (x1 - x0) * 0.35 + 0.03, my = (y1 - y0) * 0.2 + 0.03;
  return [(x0 - mx) * sw, (y0 - my) * sh, (x1 + mx) * sw, (y1 + my) * sh];
};
const tr = new SimTracker(sw, sh), cam: number[] = [];
let lastBox: Box = null;
for (let i = 0; i < N; i++) {
  const k = Math.min(i, nf - 1), g = new Float32Array(sw * sh);
  for (let p = 0; p < sw * sh; p++) g[p] = raw[k * sw * sh + p];
  const b: Box = boxAt(i) ?? lastBox; lastBox = b;
  const m = toFullRes(tr.push(g, b), ms);
  cam.push(m.a, m.b, m.tx, m.ty);
}
console.error(`${video}: ${N} frames, rekeys ${tr.rekeys}, re-anchors ${tr.anchors}, lost ${tr.lost}`);
const outI = rest.indexOf('--out');
if (outI >= 0) writeFileSync(rest[outI + 1], JSON.stringify({ cam }));
if (rest.includes('--write')) {
  const r1 = (v: number) => Math.round(v * 10), r5 = (v: number) => Math.round(v * 1e5);
  f.ox = []; f.oy = []; f.ca = []; f.cb = [];
  for (let i = 0; i < N; i++) { f.ca.push(r5(cam[4 * i])); f.cb.push(r5(cam[4 * i + 1])); f.ox.push(r1(cam[4 * i + 2])); f.oy.push(r1(cam[4 * i + 3])); }
  f.camera = 'similarity/1';
  const json = JSON.stringify(f);
  writeFileSync(fixturePath, fixturePath.endsWith('.gz') ? gzipSync(json) : json);
  console.error('wrote', fixturePath);
}
