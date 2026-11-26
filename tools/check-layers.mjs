// Enforce the import layering in docs/ARCHITECTURE.md §6 (dependency-free, run in CI).
// - src/core/** must not touch the DOM and may only import types/config/core.
// - Lower layers must not import higher layers.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname, resolve, sep } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const SRC = join(ROOT, 'src');
const LAYER = [
  [/^(types|config)\.ts$|^util\//, 0], [/^core\/signal\//, 0],
  [/^core\/(cleanup|kinematics)\//, 1],
  [/^core\/(segmentation|load|metrics)\//, 2],
  [/^core\/(results|crux)\/|^core\/pipeline\.ts$/, 3],
  [/^(media|pose|camera|environment|route|history)\//, 4],
  [/^(render|export)\//, 5],
  [/^(ui|app)\/|^main\.ts$/, 6],
];
const layerOf = (rel) => { for (const [re, l] of LAYER) if (re.test(rel)) return l; return null; };
const DOM = /\b(document|window|HTMLElement|HTMLVideoElement|HTMLCanvasElement|localStorage|navigator)\b/;

const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) && files.push(p); } };
walk(SRC);

const errors = [];
for (const f of files) {
  const rel = relative(SRC, f).split(sep).join('/'), L = layerOf(rel), src = readFileSync(f, 'utf8');
  if (L === null) { errors.push(`${rel}: not assigned to a layer`); continue; }
  const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  if (rel.startsWith('core/') && DOM.test(code)) errors.push(`${rel}: core must not use the DOM (${code.match(DOM)[0]})`);
  for (const m of code.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const target = relative(SRC, resolve(dirname(f), m[1])).split(sep).join('/');
    const t = layerOf(target.endsWith('.ts') ? target : target + '.ts') ?? layerOf(target + '/');
    const tl = t ?? layerOf(target + '/index.ts');
    if (tl !== null && tl > L) errors.push(`${rel} (layer ${L}) imports ${target} (layer ${tl})`);
  }
}
if (errors.length) { console.error('Layer check failed:\n  ' + errors.join('\n  ')); process.exit(1); }
console.log(`Layer check OK (${files.length} files)`);
