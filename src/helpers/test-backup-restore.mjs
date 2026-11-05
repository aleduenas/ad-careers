// Test dump/restore only against a dedicated test database on the Compose server.
import assert from 'node:assert/strict';
import pg from 'pg';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, openSync, closeSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { root } from '../lib/root.mjs';
if (!process.env.TEST_DATABASE_URL) {
  console.log(
    'SKIPPED backup/restore integration: TEST_DATABASE_URL is required (run via node src/helpers/db-test.mjs)',
  );
  process.exit(0);
}
const targetURL = new URL(process.env.TEST_DATABASE_URL);
if (!/^\/career_ops_test_[a-z0-9_]+$/.test(targetURL.pathname))
  throw new Error('Refusing non-test database');
const connection = database => {
  const u = new URL(targetURL);
  u.pathname = '/' + database;
  return { connectionString: u.toString() };
};
const sourceName = targetURL.pathname.slice(1),
  user = decodeURIComponent(targetURL.username),
  suffix = randomUUID().replaceAll('-', ''),
  targetName = 'career_ops_test_restore_' + suffix,
  schema = 'backup_' + suffix;
const source = new pg.Client(connection(sourceName));
await source.connect();
const docker =
  [
    join(process.env.LOCALAPPDATA || '', 'Programs/DockerDesktop/resources/bin/docker.exe'),
    join(process.env.ProgramFiles || '', 'Docker/Docker/resources/bin/docker.exe'),
  ].find(existsSync) || 'docker';
const prefix = [
  'compose',
  '--env-file',
  join(root, '.env'),
  '-f',
  join(root, 'infra/docker/compose.yml'),
  'exec',
  '-T',
  '-e',
  'PGPASSWORD',
  'postgres',
];
const run = (args, opts = {}) => {
  const r = spawnSync(docker, [...prefix, ...args], {
    windowsHide: true,
    stdio: 'inherit',
    timeout: 60000,
    env: { ...process.env, PGPASSWORD: decodeURIComponent(targetURL.password) },
    ...opts,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('Backup/restore command failed');
  return r;
};
const temp = mkdtempSync(join(tmpdir(), 'career-backup-test-')),
  dump = join(temp, 'fixture.dump');
let created = false;
try {
  const identity = (await source.query('SELECT system_identifier::text FROM pg_control_system()'))
    .rows[0].system_identifier;
  const composeIdentity = run(
    [
      'psql',
      '-U',
      user,
      '-d',
      sourceName,
      '-Atc',
      'SELECT system_identifier::text FROM pg_control_system()',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  ).stdout.trim();
  assert.equal(
    composeIdentity,
    identity,
    'TEST_DATABASE_URL must name the Compose server; refusing a different cluster',
  );
  await source.query('CREATE SCHEMA ' + schema);
  await source.query(
    'CREATE TABLE ' + schema + '.proof(id integer PRIMARY KEY,note text NOT NULL)',
  );
  await source.query('INSERT INTO ' + schema + '.proof VALUES(1,$1)', [
    'Preserve Unicode: café — test',
  ]);
  const fd = openSync(dump, 'wx');
  try {
    run(['pg_dump', '-U', user, '-d', sourceName, '-n', schema, '-Fc'], {
      stdio: ['ignore', fd, 'inherit'],
    });
  } finally {
    closeSync(fd);
  }
  await source.query('CREATE DATABASE ' + targetName);
  created = true;
  run(['pg_restore', '-U', user, '-d', targetName, '--exit-on-error'], {
    input: readFileSync(dump),
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  const restored = new pg.Client(connection(targetName));
  await restored.connect();
  try {
    assert.equal(
      (await restored.query('SELECT note FROM ' + schema + '.proof WHERE id=1')).rows[0].note,
      'Preserve Unicode: café — test',
    );
  } finally {
    await restored.end();
  }
  console.log('PostgreSQL custom-format backup/restore passed in isolated test databases');
} finally {
  if (created) await source.query('DROP DATABASE ' + targetName);
  await source.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
  await source.end();
  if (
    dirname(temp) !== resolve(tmpdir()) ||
    !temp.startsWith(join(resolve(tmpdir()), 'career-backup-test-'))
  )
    throw new Error('Unsafe fixture cleanup');
  rmSync(temp, { recursive: true, force: true });
}
