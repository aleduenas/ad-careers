import { spawnSync } from 'node:child_process';
import {
  existsSync,
  writeFileSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { root } from '../lib/_database.mjs';
const action = process.argv[2];
const candidates = [
  join(process.env.LOCALAPPDATA || '', 'Programs/DockerDesktop/resources/bin/docker.exe'),
  join(process.env.ProgramFiles || '', 'Docker/Docker/resources/bin/docker.exe'),
];
const docker = candidates.find(existsSync) || 'docker';
const prefix = [
  'compose',
  '--env-file',
  join(root, '.env'),
  '-f',
  join(root, 'infra/docker/compose.yml'),
];
function run(args, options = {}) {
  const result = spawnSync(docker, [...prefix, ...args], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Docker command failed: ' + result.status);
  return result;
}
if (action === 'init') {
  const file = join(root, '.env');
  if (existsSync(file))
    throw new Error(
      '.env already exists; preserve it and add the settings from infra/docker/.env.example.',
    );
  writeFileSync(
    file,
    'POSTGRES_PASSWORD=' + randomBytes(32).toString('hex') + '\nPOSTGRES_PORT=54329\n',
    { flag: 'wx' },
  );
  console.log('Created private .env');
} else if (action === 'up') run(['up', '-d', '--wait']);
else if (action === 'down') run(['down']);
else if (action === 'status') run(['ps']);
else if (action === 'config') run(['config', '--quiet']);
else if (action === 'backup') {
  const file = resolve(
    root,
    process.argv[3] ||
      'data/backups/career-ops-' + new Date().toISOString().replace(/[:.]/g, '-') + '.dump',
  );
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) throw new Error('Backup already exists: ' + file);
  const partial = file + '.partial';
  let fd = openSync(partial, 'wx');
  try {
    run(['exec', '-T', 'postgres', 'pg_dump', '-U', 'career_ops', '-d', 'career_ops', '-Fc'], {
      stdio: ['ignore', fd, 'inherit'],
    });
    closeSync(fd);
    fd = null;
    renameSync(partial, file);
  } catch (e) {
    if (fd !== null) closeSync(fd);
    try {
      unlinkSync(partial);
    } catch {}
    throw e;
  }
  console.log('Backup: ' + file);
} else if (action === 'restore') {
  const file = process.argv[3],
    database = process.argv[4];
  if (!file || !/^career_ops_restore_[a-z0-9_]+$/.test(database || ''))
    throw new Error('Usage: db-infra restore FILE career_ops_restore_NAME (new database only)');
  run(['exec', '-T', 'postgres', 'createdb', '-U', 'career_ops', database]);
  run(
    ['exec', '-T', 'postgres', 'pg_restore', '-U', 'career_ops', '-d', database, '--exit-on-error'],
    { input: readFileSync(resolve(root, file)), stdio: ['pipe', 'inherit', 'inherit'] },
  );
} else
  throw new Error('Usage: node src/helpers/db-infra.mjs init|up|down|status|config|backup|restore');
