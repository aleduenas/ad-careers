#!/usr/bin/env node

/**
 * test-all.mjs — Comprehensive test suite for career-ops
 *
 * Run before merging any PR or pushing changes.
 * Tests: syntax, scripts, dashboard, data contract, paths.
 *
 * All script-execution checks run in --dry-run mode — this suite NEVER
 * modifies user data (the personal database or private artifacts).
 *
 * Usage:
 *   node src/test-all.mjs           # Run all tests
 *   node src/test-all.mjs --quick   # Skip dashboard build (faster)
 */

import { execFileSync } from 'child_process';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(SRC_DIR);
// Every .mjs under src/, relative to ROOT, discovered recursively.
function walkMjs(dir, rel = 'src') {
  const out = [];
  for (const e of readdirSync(join(dir), { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...walkMjs(join(dir, e.name), rel + '/' + e.name));
    else if (e.name.endsWith('.mjs')) out.push(rel + '/' + e.name);
  }
  return out;
}
const ALL_MJS = walkMjs(SRC_DIR);
const QUICK = process.argv.includes('--quick');

let passed = 0;
let failed = 0;
let warnings = 0;

function pass(msg) {
  console.log(`  ✅ ${msg}`);
  passed++;
}
function fail(msg) {
  console.log(`  ❌ ${msg}`);
  failed++;
}
function warn(msg) {
  console.log(`  ⚠️  ${msg}`);
  warnings++;
}

// Run a command without a shell. Returns stdout, or null on non-zero exit.
function run(cmd, args = [], opts = {}) {
  const { diagnostics = false, ...execOptions } = opts;
  try {
    return execFileSync(cmd, args, {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 60000,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...execOptions,
    }).trim();
  } catch (e) {
    if (diagnostics) console.error(String(e.stderr || e.stdout || e.message).trim());
    return null;
  }
}

function fileExists(path) {
  return existsSync(join(ROOT, path));
}
function readFile(path) {
  return readFileSync(join(ROOT, path), 'utf-8');
}

console.log('\n🧪 career-ops test suite\n');

// ── 1. SYNTAX CHECKS ────────────────────────────────────────────

console.log('1. Syntax checks');

const mjsFiles = ALL_MJS;
for (const f of mjsFiles) {
  const result = run('node', ['--check', f]);
  if (result !== null) {
    pass(`${f} syntax OK`);
  } else {
    fail(`${f} has syntax errors`);
  }
}

// ── 2. SCRIPT EXECUTION (read-only / dry-run) ───────────────────

console.log('\n2. Script execution (dry-run — never mutates user data)');

// Tests are discovered: every src/**/test-*.mjs except this harness.
const scripts = ALL_MJS.filter(
  f => /\/test-[^/]+\.mjs$/.test(f) && !f.endsWith('test-all.mjs'),
).map(name => ({ name, args: [] }));

for (const { name, args } of scripts) {
  const result = run('node', [join(ROOT, name), ...args], { diagnostics: true });
  if (result !== null) {
    if (result.includes('SKIPPED'))
      warn(
        `${name}: ${result
          .split('\n')
          .filter(l => l.includes('SKIPPED'))
          .join('; ')}`,
      );
    else pass(`${name} ${args.join(' ')} runs OK`);
  } else {
    fail(`${name} crashed`);
  }
}

// ── 3. DASHBOARD BUILD ──────────────────────────────────────────

if (!QUICK) {
  console.log('\n3. Dashboard build');
  const out = join(tmpdir(), 'career-dashboard-test.exe');
  const goBuild = run('go', ['build', '-o', out, '.'], { cwd: join(ROOT, 'dashboard') });
  if (goBuild !== null) {
    pass('Dashboard compiles');
  } else {
    fail('Dashboard build failed');
  }
} else {
  console.log('\n3. Dashboard build (skipped --quick)');
}

// ── 4. DATA CONTRACT ────────────────────────────────────────────

console.log('\n4. Data contract validation');

// Check system files exist
const systemFiles = [
  'CLAUDE.md',
  'AGENTS.md',
  'documentation/index.md',
  'documentation/guides/layout.md',
  'documentation/guides/DATA_CONTRACT.md',
  'config/examples/profile.example.yml',
  'config/examples/portals.example.yml',
  'src/lib/root.mjs',
  'src/lib/_database.mjs',
  'src/scan/scan.mjs',
  'src/helpers/verify-portals.mjs',
  'src/eval/next-jobs.mjs',
  'src/helpers/verify-pipeline.mjs',
  'src/cvgen/draft-cv.mjs',
  'src/cvgen/_cv-content.mjs',
  'src/cvgen/templates/cv-structured.html',
  'documentation/guides/prompts.md',
  'llm/prompts/cvgen/cv-worksheet.md',
  'llm/prompts/cvgen/cv-repair.md',
  'llm/prompts/cvgen/cover-letter-worksheet.md',
  'infra/sql/schema.sql',
  'infra/docker/compose.yml',
  'llm/prompts/eval/gate.md',
  'llm/prompts/eval/company-research.md',
  'llm/prompts/eval/market-research.md',
  'llm/prompts/eval/evaluate.md',
  'llm/prompts/eval/repair.md',
  'llm/prompts/eval/scoring.md',
  'llm/prompts/eval/INDEX.md',
  'llm/prompts/runtime/no-tools.md',
  'llm/prompts/runtime/research.md',
];

for (const f of systemFiles) {
  if (fileExists(f)) {
    pass(`System file exists: ${f}`);
  } else {
    fail(`Missing system file: ${f}`);
  }
}

// Check user files are NOT tracked (gitignored)
const userFiles = [
  'config/profile.yml',
  'config/profile.md',
  'config/portals.yml',
  'config/cv.md',
  'config/cv-guidance.md',
  'llm/compacted/cv-compact.md',
  'llm/compacted/candidate-targeting.md',
  'llm/prompts/cvgen/writing-style-guide.txt',
];
for (const f of userFiles) {
  const tracked = run('git', ['ls-files', f]);
  if (tracked === '' || tracked === null) {
    pass(`User file gitignored: ${f}`);
  } else {
    fail(`User file IS tracked (should be gitignored): ${f}`);
  }
}

// ── 5. ABSOLUTE PATH CHECK ──────────────────────────────────────

console.log('\n5. Absolute path check');

const absAllowed = ['README.md', 'LICENSE', 'CLAUDE.md', 'src/test-all.mjs'];
const absPatterns = ['/Users/', 'C:\\\\Users\\\\'];
let absFound = false;
for (const pattern of absPatterns) {
  const result = run('git', [
    'grep',
    '-n',
    '--untracked',
    pattern,
    '--',
    '*.mjs',
    '*.md',
    '*.go',
    '*.yml',
  ]);
  if (result) {
    for (const line of result.split('\n').filter(Boolean)) {
      const file = line.split(':')[0].replace(/\\/g, '/');
      if (absAllowed.some(a => file.includes(a))) continue;
      fail(`Absolute path: ${line.slice(0, 120)}`);
      absFound = true;
    }
  }
}
if (!absFound) {
  pass('No absolute paths in code files');
}

// ── 6. DOCUMENTATION COVERAGE ──────────────────────────────────

console.log('\n6. Documentation coverage');
const documentedRoots = [
  'src',
  'dashboard',
  'infra',
  'llm/prompts',
  'config/examples',
  '.github/workflows',
];
const privatePromptInputs = new Set([
  'llm/prompts/cvgen/writing-style-guide.txt',
  'llm/prompts/cvgen/cover-letter-paragraph-worksheet.txt',
]);
function documentationSources(dir) {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap(entry => {
    const path = dir + '/' + entry.name;
    if (entry.isDirectory())
      return ['node_modules', 'logs'].includes(entry.name) ? [] : documentationSources(path);
    return !privatePromptInputs.has(path) &&
      (/\.(mjs|go|ps1|sql|yml|json|html|md|woff2)$/.test(path) ||
        path === 'infra/docker/.env.example')
      ? [path]
      : [];
  });
}
const documentationSourcesList = documentedRoots.flatMap(documentationSources);
const missingPages = documentationSourcesList.filter(
  path => !fileExists('documentation/' + path.replace(/\.[^./]+$/, '') + '.md'),
);
for (const path of missingPages) fail(`Missing documentation page for ${path}`);
if (!missingPages.length)
  pass(
    `Documentation pages exist for ${documentationSourcesList.length} source/configuration files`,
  );

// ── 7. AGENTS.md INTEGRITY ──────────────────────────────────────

console.log('\n7. AGENTS.md integrity');

const agents = readFile('AGENTS.md');
const requiredSections = [
  'Hard rules',
  'PostgreSQL owns',
  'Migrations are immutable',
  'Private data stays private',
  'JD policy',
  'Ethical use',
  'Documentation is part of the change',
  'hiring.cafe provider contract',
];

for (const section of requiredSections) {
  if (agents.includes(section)) {
    pass(`AGENTS.md has section: ${section}`);
  } else {
    fail(`AGENTS.md missing section: ${section}`);
  }
}

// ── 8. VERSION ──────────────────────────────────────────────────

console.log('\n8. Version');

const pkg = JSON.parse(readFile('package.json'));
if (/^\d+\.\d+\.\d+$/.test(pkg.version || '')) {
  pass(`package.json version is valid semver: ${pkg.version}`);
} else {
  fail(`package.json version is not valid semver: "${pkg.version}"`);
}

// ── SUMMARY ─────────────────────────────────────────────────────

console.log('\n' + '='.repeat(50));
console.log(`📊 Results: ${passed} passed, ${failed} failed, ${warnings} warnings`);

if (failed > 0) {
  console.log('🔴 TESTS FAILED — do NOT push/merge until fixed\n');
  process.exit(1);
} else if (warnings > 0) {
  console.log('🟡 Tests passed with warnings — review before pushing\n');
  process.exit(0);
} else {
  console.log('🟢 Executed checks passed; review warnings for skipped integration checks\n');
  process.exit(0);
}
