import assert from 'node:assert/strict';
import { assertTestDatabase } from './_database.mjs';

// The guard never connects: it only inspects the resolved configuration.
const on = { CAREER_OPS_TEST_GUARD: '1' };
const off = {};

assertTestDatabase({ connectionString: 'postgres://u:p@127.0.0.1:54329/career_ops' }, off);
assertTestDatabase({ database: 'career_ops' }, off);
for (const config of [
  { connectionString: 'postgres://u:p@127.0.0.1:54329/career_ops' },
  { connectionString: 'postgres://u:p@127.0.0.1:54329/' },
  { connectionString: 'not a url' },
  { database: 'career_ops' },
  { database: 'career_ops_test' },
  {},
])
  assert.throws(() => assertTestDatabase(config, on), /Test guard/, JSON.stringify(config));
assertTestDatabase({ connectionString: 'postgres://u:p@127.0.0.1:54329/career_ops_test_x1' }, on);
assertTestDatabase({ database: 'career_ops_test_integration' }, on);
console.log(
  'Database test guard passed: personal and malformed targets refused, test databases allowed.',
);
