import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../lib/root.mjs';
import { generatePDF } from './generate-pdf.mjs';
if (!process.argv.includes('--render')) {
  console.log('SKIPPED Chromium PDF integration: run node src/cvgen/test-pdf-render.mjs --render');
  process.exit(0);
}
const dir = join(root, 'logs/tests/pdf-render');
mkdirSync(dir, { recursive: true });
const template = readFileSync(join(root, 'src/cvgen/templates/cv-structured.html'), 'utf8');
const html = template
  .replace('{{TITLE}}', 'Synthetic font test')
  .replace(
    '{{CONTENT}}',
    '<div class="header"><h1>Example Candidate</h1></div><div class="section"><div class="section-title">Rendering verification</div><p>Production systems, reproducible tests and reliable services. Extended Latin: Łódź, İstanbul, Říčany.</p></div>',
  );
writeFileSync(join(dir, 'fixture.html'), html);
const result = await generatePDF([
  join(dir, 'fixture.html'),
  join(dir, 'fixture.pdf'),
  '--format=letter',
]);
assert.ok(result.size > 1000);
assert.equal(result.pageCount, 1);
for (const family of ['DM Sans', 'Space Grotesk'])
  assert.ok(
    result.fonts.some(f => f.family.replaceAll('"', '') === family && f.status === 'loaded'),
    family + ' must actually load',
  );
console.log('PDF integration passed: real Chromium, embedded font families and one-page output');
