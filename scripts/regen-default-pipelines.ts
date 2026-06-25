/**
 * Regenerate the committed `pipelines/*.pipeline.json` defaults from their
 * source modules. The runtime bootstrap NEVER overwrites existing files
 * (materialization trap), so when a default module changes — e.g. a new
 * `description` field — the committed copies must be re-rendered explicitly.
 *
 * Usage:  npx tsx scripts/regen-default-pipelines.ts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PIPELINES } from '../src/lib/default-pipelines/registry.js';

const dir = join(process.cwd(), 'pipelines');
for (const mod of DEFAULT_PIPELINES) {
  const path = join(dir, mod.DEFAULT_PIPELINE_FILENAME);
  writeFileSync(path, mod.getDefaultPipelineFileContent());
  // eslint-disable-next-line no-console
  console.log('wrote', mod.DEFAULT_PIPELINE_FILENAME);
}
