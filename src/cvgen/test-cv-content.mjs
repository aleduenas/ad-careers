#!/usr/bin/env node
// Catalog + renderer contract: facts come from config/cv.md and config/profile.yml,
// slot markers tie catalog entries to worksheet keys, and rendering is deterministic.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { loadCatalog, renderHTML } from './_cv-content.mjs';
import { root } from '../lib/root.mjs';
const dir = mkdtempSync(join(tmpdir(), 'career-cv-test-'));
try {
  mkdirSync(join(dir, 'config'));
  writeFileSync(
    join(dir, 'config/cv.md'),
    '## Professional Experience\r\n\r\n### Engineer | Example | 2024 – Present\r\n<!-- slot: engineer -->\r\nBuilt Python pipelines and SQL services for analytics.\r\n\r\n### Retail | Shop | 2020 – 2023\r\n<!-- slot: retail -->\r\nManaged customer service and store operations.\r\n\r\n## Education\r\n\r\n### BSc | University | 2020\r\n**CV description:** Mathematics with a statistics focus.\r\nMath studies.\r\n\r\n## Projects\r\n\r\n### Example Model\r\n<!-- slot: model -->\r\n**GitHub:** github.com/example/model\r\nTrained Python models with evaluation and data validation.\r\n',
  );
  writeFileSync(
    join(dir, 'config/profile.yml'),
    'candidate:\n  full_name: Test Candidate\n  email: test@example.com\n  linkedin: linkedin.com/in/test\n  github: github.com/example\n  spoken_languages: English and Spanish\n',
  );
  writeFileSync(
    join(dir, 'config/cv-content-policy.json'),
    JSON.stringify({ required_role_headings: ['Engineer | Example | 2024 – Present'] }),
  );
  const c = loadCatalog(dir);
  assert.deepEqual(
    c.roles.map(r => r.slot),
    ['engineer', 'retail'],
  );
  assert.deepEqual(
    c.projects.map(p => p.slot),
    ['model'],
  );
  assert.equal(c.roles[0].required, true);
  assert.equal(c.roles[1].required, false);
  assert.ok(!c.roles[0].evidence.includes('slot:'), 'slot markers are stripped from evidence');
  assert.equal(
    c.education[0].cv_description,
    'Mathematics with a statistics focus.',
    'education copy comes from the CV description line',
  );
  assert.equal(c.projects[0].badge, 'github.com/example/model');
  assert.equal(c.contact.full_name, 'Test Candidate');
  assert.equal(c.contact.phone, '');
  assert.equal(c.contact.spoken_languages, 'English and Spanish');
  assert.throws(() => {
    writeFileSync(
      join(dir, 'config/cv-content-policy.json'),
      JSON.stringify({ required_role_headings: ['Renamed | Example | 2024'] }),
    );
    loadCatalog(dir);
  }, /Required role heading changed/);
  writeFileSync(
    join(dir, 'config/cv-content-policy.json'),
    JSON.stringify({ required_role_headings: ['Engineer | Example | 2024 – Present'] }),
  );

  const claim = text => ({ text });
  const a = {
    format: 'letter',
    summary: claim('Built Python pipelines and SQL services for analytics.'),
    competencies: ['Python', 'SQL', 'Pipelines', 'Services', 'Analytics', 'Engineering'].map(claim),
    roles: [
      {
        id: c.roles[0].id,
        include: true,
        bullets: [claim('Built Python pipelines & SQL services.')],
      },
      { id: c.roles[1].id, include: false, bullets: [] },
    ],
    projects: [
      {
        id: c.projects[0].id,
        include: true,
        description: claim('Trained Python models with evaluation.'),
        technologies: [],
      },
    ],
    skills: [{ category: 'Languages', items: [claim('Python'), claim('SQL')] }],
    keywords: [],
  };
  const template = readFileSync(join(root, 'src/cvgen/templates/cv-structured.html'), 'utf8');
  const html = renderHTML(a, c, template);
  assert.ok(!html.includes('Retail'), 'omitted roles are not rendered');
  assert.ok(html.includes('pipelines &amp; SQL'), 'HTML is escaped');
  assert.ok(
    html.includes('Mathematics with a statistics focus.'),
    'education description rendered from cv.md',
  );
  assert.ok(html.includes('<span class="project-badge">github.com/example/model</span>'));
  assert.ok(!html.includes('href="https://github.com/example/model"'), 'badge is display-only');
  assert.ok(!html.includes('{{'));
  assert.ok(!html.includes('<span></span>'), 'empty phone omitted');
  assert.ok(html.includes('<span>English and Spanish</span>'), 'spoken languages in contact row');
  const noProjects = {
    ...a,
    projects: [{ id: c.projects[0].id, include: false, description: claim(''), technologies: [] }],
  };
  assert.ok(
    !renderHTML(noProjects, c, template).includes('>Projects</div>'),
    'empty section omitted',
  );
  if (process.argv.includes('--smoke-html')) {
    mkdirSync(join(root, 'logs/tests/cv-render-smoke'), { recursive: true });
    writeFileSync(join(root, 'logs/tests/cv-render-smoke/cv.html'), html);
  }
  console.log(
    'CV catalog/renderer tests passed: slots, required roles, education copy from cv.md, HTML escaping, badges and empty-section omission.',
  );
} finally {
  if (
    dirname(dir) !== resolve(tmpdir()) ||
    !dir.startsWith(join(resolve(tmpdir()), 'career-cv-test-'))
  )
    throw new Error('Unsafe fixture cleanup');
  rmSync(dir, { recursive: true, force: true });
}
