// Regenerate tests/fixtures/**/<clip>.golden.json from the current core.
// Use only after an intentional behaviour change; review the diff before committing.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { listFixtures, readJson, toRawTrack, fixtureSettings, type PoseFixture } from '../tests/helpers/fixtures';
import { summarize } from '../tests/helpers/summary';
import { runPipeline } from '../src/core/pipeline';

for (const c of listFixtures()) {
  const fx = readJson<PoseFixture>(c.pose);
  const D = runPipeline({ raw: toRawTrack(fx), settings: fixtureSettings(fx), env: fx.env });
  const out = join(dirname(c.pose), `${c.name}.golden.json`);
  writeFileSync(out, JSON.stringify(summarize(D)));
  console.log('wrote', out.replace(process.cwd() + '/', ''));
}
