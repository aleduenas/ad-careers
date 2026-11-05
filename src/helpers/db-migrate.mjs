import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { root, transaction, close } from '../lib/_database.mjs';
try {
  await transaction(async c => {
    await c.query('SELECT pg_advisory_xact_lock(71938201)');
    await c.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const name of readdirSync(join(root, 'infra/sql/migrations'))
      .filter(n => n.endsWith('.sql'))
      .sort()) {
      const sql = readFileSync(join(root, 'infra/sql/migrations', name), 'utf8'),
        checksum = createHash('sha256').update(sql).digest('hex');
      const old = (await c.query('SELECT checksum FROM schema_migrations WHERE name=$1', [name]))
        .rows[0];
      if (old) {
        if (old.checksum !== checksum) throw new Error('Applied migration changed: ' + name);
        continue;
      }
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [name, checksum]);
      console.log('Applied ' + name);
    }
  });
} finally {
  await close();
}
