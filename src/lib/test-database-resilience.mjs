import assert from 'node:assert/strict';
import pg from 'pg';

// F29: a PostgreSQL restart or pg_terminate_backend must not crash the process. The offline part
// always runs; the live part needs the disposable test database (TEST_DATABASE_URL).
const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl) {
  if (!/^\/career_ops_test_[a-z0-9_]+$/.test(new URL(testUrl).pathname))
    throw new Error('Test database name must start career_ops_test_; refusing personal database');
  process.env.DATABASE_URL = testUrl;
} else
  process.env.DATABASE_URL =
    'postgres://nobody:secret-password-sentinel@127.0.0.1:1/career_ops_test_x';

process.on('uncaughtException', error => {
  console.error('FAIL: uncaught exception reached the process', error);
  process.exit(1);
});
const { db, query, transaction, close } = await import('./_database.mjs');

const logged = [];
const originalError = console.error;
console.error = (...parts) => logged.push(parts.join(' '));
try {
  // Offline: errors emitted on the pool and on a client never throw, and are logged once.
  const pool = db();
  const secretError = Object.assign(
    new Error('terminating connection postgres://u:secret-password-sentinel@h/db'),
    { code: '57P01' },
  );
  pool.emit('error', secretError);
  pool.emit('error', secretError);
  const client = new pg.Client();
  pool.emit('connect', client);
  client.emit('error', secretError);
  assert.equal(logged.length, 1, 'the loss is logged once per outage');
  assert.match(logged[0], /57P01/);
  assert.doesNotMatch(logged[0], /secret-password-sentinel|postgres:\/\//);

  if (testUrl) {
    const admin = new pg.Client({ connectionString: testUrl });
    await admin.connect();
    try {
      const terminate = pid => admin.query('SELECT pg_terminate_backend($1)', [pid]);
      assert.equal((await query('SELECT 1 AS one'))[0].one, 1);

      // An idle pooled client whose backend is terminated: the process stays up and the next
      // query succeeds on a fresh connection.
      const [{ pid }] = await query('SELECT pg_backend_pid() AS pid');
      await terminate(pid);
      await new Promise(resolve => setTimeout(resolve, 200));
      assert.equal((await query('SELECT 2 AS two'))[0].two, 2);

      // An in-flight query: it fails (mapped to unavailable by callers) and the pool recovers.
      const running = query('SELECT pg_sleep(5)');
      running.catch(() => {});
      let victim;
      for (let i = 0; i < 50 && !victim; i++) {
        victim = (
          await admin.query(
            "SELECT pid FROM pg_stat_activity WHERE query LIKE 'SELECT pg_sleep(5)%' AND pid <> pg_backend_pid() AND datname = current_database()",
          )
        ).rows[0];
        if (!victim) await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.ok(victim, 'found the in-flight backend');
      await terminate(victim.pid);
      await assert.rejects(running);
      assert.equal((await query('SELECT 3 AS three'))[0].three, 3);

      // A transaction whose connection dies keeps the original error and the pool recovers.
      await assert.rejects(
        transaction(async tx => {
          const { rows } = await tx.query('SELECT pg_backend_pid() AS pid');
          await terminate(rows[0].pid);
          await new Promise(resolve => setTimeout(resolve, 200));
          await tx.query('SELECT 1');
        }),
      );
      assert.equal((await query('SELECT 4 AS four'))[0].four, 4);
      console.log(
        'PostgreSQL connection resilience passed: idle, in-flight and transaction terminations',
      );
    } finally {
      await admin.end();
    }
  } else console.log('SKIPPED live PostgreSQL termination checks: TEST_DATABASE_URL is required');
} finally {
  console.error = originalError;
  await close();
}
console.log(
  'Database resilience tests passed: pool and client errors are caught and logged once without secrets.',
);
