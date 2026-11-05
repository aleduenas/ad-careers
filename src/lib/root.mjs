// Repository root for every backend script. Import this instead of computing the
// root from a file's own depth (documentation/guides/layout.md, rule 5).
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export default root;
