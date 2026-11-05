import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { databaseConfig, root } from '../lib/_database.mjs';
const config = databaseConfig();
// Provision only this explicitly named disposable test database.
const name = 'career_ops_test_integration';
const client = new pg.Client(config);
await client.connect();
try {
  if (!(await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount)
    await client.query('CREATE DATABASE ' + name);
} finally {
  await client.end();
}
const u = config.connectionString
  ? new URL(config.connectionString)
  : new URL('postgres://127.0.0.1');
if (!config.connectionString) {
  u.username = config.user;
  u.password = config.password;
  u.hostname = config.host;
  u.port = String(config.port);
}
u.pathname = '/' + name;
for (const file of [
  'src/helpers/test-legacy-import.mjs',
  'src/helpers/test-database.mjs',
  'src/eval/test-evaluation-cli.mjs',
  'src/cvgen/test-drafting-integration.mjs',
  'src/helpers/test-backup-restore.mjs',
]) {
  const result = spawnSync(process.execPath, [file], {
    cwd: root,
    env: { ...process.env, TEST_DATABASE_URL: u.toString() },
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
const go = spawnSync('go', ['test', './...'], {
  cwd: root + '/dashboard',
  env: { ...process.env, TEST_DATABASE_URL: u.toString() },
  stdio: 'inherit',
  windowsHide: true,
});
if (go.error) throw go.error;
if (go.status !== 0) process.exit(go.status || 1);
