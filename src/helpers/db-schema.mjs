import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../lib/_database.mjs';
const content =
  '-- Generated from numbered migrations. Do not edit directly.\n' +
  readdirSync(join(root, 'infra/sql/migrations'))
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(
      f =>
        '\n-- ' +
        f +
        '\n' +
        readFileSync(join(root, 'infra/sql/migrations', f), 'utf8')
          .replace(/\r\n/g, '\n')
          .trimEnd() +
        '\n',
    )
    .join('');
const path = join(root, 'infra/sql/schema.sql');
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8').replace(/\r\n/g, '\n') !== content)
    throw new Error('Schema snapshot differs; run npm run db:schema');
  console.log('Schema snapshot matches migrations');
} else {
  writeFileSync(path, content);
  console.log('Generated infra/sql/schema.sql');
}
