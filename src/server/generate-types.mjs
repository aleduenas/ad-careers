import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { compile } from 'json-schema-to-typescript';
import { root } from '../lib/root.mjs';
import { publicSchemas } from './schemas.mjs';

const outputPath = resolve(root, 'web/src/generated/api.d.ts');
const banner = '// Generated from src/server/schemas.mjs. Do not edit by hand.\n';

const declarations = await Promise.all(
  Object.entries(publicSchemas).map(([name, schema]) =>
    compile(schema, name, { bannerComment: '' }),
  ),
);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, banner + declarations.join('\n'), 'utf8');
process.stdout.write(`Generated ${outputPath}\n`);
