import { spawnSync } from 'node:child_process';
import { root } from '../lib/_database.mjs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
const needsImport =
  existsSync(join(root, 'data/pipeline.md')) || existsSync(join(root, 'data/applications.md'));
// Safe to resume: migrations and import are idempotent. Archive only verified input.
for (const args of [
  ['src/helpers/db-infra.mjs', 'up'],
  ['src/helpers/db-migrate.mjs'],
  ['src/helpers/db-test.mjs'],
  ['src/helpers/import-legacy.mjs'],
  ['src/helpers/import-legacy.mjs', '--apply'],
  ['src/helpers/sync-jds.mjs', '--apply'],
  ['src/helpers/verify-pipeline.mjs'],
  ['src/helpers/db-infra.mjs', 'backup'],
  ['src/helpers/import-legacy.mjs', '--apply', '--archive'],
]) {
  if (args[0] === 'src/helpers/import-legacy.mjs' && !needsImport) continue;
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      'Cutover stopped at ' + args[0] + '; source backup and database state retained',
    );
}
console.log('Database cutover complete. Launch the dashboard against this repository.');
