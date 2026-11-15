#!/usr/bin/env node

/**
 * test-all.mjs — Comprehensive test suite for career-ops
 *
 * Run before merging any PR or pushing changes.
 * Tests: syntax, scripts, web toolchain, data contract, paths.
 *
 * All script-execution checks run in --dry-run mode — this suite NEVER
 * modifies user data (the personal database or private artifacts).
 *
 * Usage:
 *   node src/test-all.mjs           # Run all tests
 *   node src/test-all.mjs --quick   # Skip the web production build (faster)
 */

import { execFileSync } from 'child_process';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(SRC_DIR);
const WEB_DIR = join(ROOT, 'web');
const WEB_IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'generated',
  '.vite',
  '.cache',
  '.tmp',
  'coverage',
  'playwright-report',
  'test-results',
]);
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
function walkWebFiles(dir, rel = 'web') {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!WEB_IGNORED_DIRS.has(entry.name))
        out.push(...walkWebFiles(join(dir, entry.name), rel + '/' + entry.name));
    } else if (
      /\.(css|html|json|jsx|mjs|ts|tsx)$/.test(entry.name) &&
      !entry.name.endsWith('.d.ts')
    ) {
      out.push(rel + '/' + entry.name);
    }
  }
  return out;
}
const ALL_WEB_FILES = walkWebFiles(WEB_DIR);
const WEB_MJS = ALL_WEB_FILES.filter(path => path.endsWith('.mjs'));
const QUICK = process.argv.includes('--quick');
const NPM_SCRIPTS = Object.freeze({
  webTypecheck: 'web:typecheck',
  webBuild: 'web:build',
});

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
      // Every spawned check refuses to connect to a database not named career_ops_test_*
      // (src/lib/_database.mjs assertTestDatabase), so no test can reach the personal database.
      env: { ...process.env, ...(execOptions.env ?? {}), CAREER_OPS_TEST_GUARD: '1' },
    }).trim();
  } catch (e) {
    if (diagnostics) console.error(String(e.stderr || e.stdout || e.message).trim());
    return null;
  }
}

// Invoke fixed, trusted npm scripts; Windows needs cmd.exe for npm's .cmd shim.
function runNpmScript(script, opts = {}) {
  if (!Object.values(NPM_SCRIPTS).includes(script))
    throw new Error(`Unsupported npm script in test harness: ${script}`);
  const command = `npm run ${script}`;
  return process.platform === 'win32'
    ? run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], opts)
    : run('npm', ['run', script], opts);
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

const mjsFiles = [...ALL_MJS, ...WEB_MJS];
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
const scripts = [...ALL_MJS, ...WEB_MJS]
  .filter(f => /\/test-[^/]+\.mjs$/.test(f) && !f.endsWith('test-all.mjs'))
  .map(name => ({ name, args: [] }));

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

// ── 3. WEB TOOLCHAIN ───────────────────────────────────────────

console.log('\n3. Web toolchain');
if (QUICK) {
  const typecheck = runNpmScript(NPM_SCRIPTS.webTypecheck, { diagnostics: true });
  if (typecheck !== null) pass('Web API type generation and strict typecheck');
  else fail('Web typecheck failed');
} else {
  if (!fileExists('web/index.html')) fail('Web production entrypoint web/index.html is missing');
  const webBuild = runNpmScript(NPM_SCRIPTS.webBuild, { diagnostics: true, timeout: 180000 });
  if (webBuild !== null) pass('Web production build (includes API type generation and typecheck)');
  else fail('Web production build failed');
}

// ── 4. DATA CONTRACT ────────────────────────────────────────────

console.log('\n4. Data contract validation');

// Check system files exist
const systemFiles = [
  'CLAUDE.md',
  'AGENTS.md',
  'README.md',
  'src/README.md',
  'infra/README.md',
  'llm/README.md',
  'config/README.md',
  'web/README.md',
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
  'web/index.html',
  'web/vite.config.mjs',
  'web/tsconfig.json',
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
    '*.js',
    '*.jsx',
    '*.ts',
    '*.tsx',
    '*.css',
    '*.html',
    '*.md',
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

// ── 6. DOCUMENTATION ───────────────────────────────────────────

console.log('\n6. Documentation');
// D112: the documentation is one concise README per root folder; there are no per-file pages.
for (const folder of ['src', 'infra', 'llm', 'config', 'web']) {
  if (fileExists(folder + '/README.md')) pass(folder + '/README.md exists');
  else fail('Missing ' + folder + '/README.md (every root folder is documented by one README)');
}
const trackedDocumentation = run('git', ['ls-files', 'documentation']);
if (trackedDocumentation === null) warn('Could not list tracked files (git unavailable)');
else if (trackedDocumentation)
  fail(
    'Tracked files under documentation/ (the folder was retired): ' +
      trackedDocumentation.split('\n')[0],
  );
else pass('No tracked files under documentation/');

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
  'Documentation is one concise README',
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
