#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { childOf } from '../lib/cli-runtime.mjs';

import { root } from '../lib/root.mjs';
const source = process.argv[2] && resolve(process.argv[2]);
const outputRoot = join(root, 'output');
if (!source || basename(source).toLowerCase() !== 'cover-letter.md' || !childOf(outputRoot, source))
  throw new Error('Supply an output/.../cover-letter.md file to publish');
if (!existsSync(source)) throw new Error('Cover letter not found: ' + source);
const body = readFileSync(source, 'utf8').trim();
if (!body) throw new Error('Cover letter is empty');
const escapeHTML = value =>
  value.replace(
    /[&<>"']/g,
    char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
const paragraphs = body
  .split(/\r?\n\s*\r?\n/)
  .map(paragraph => `<p>${escapeHTML(paragraph.trim()).replace(/\r?\n/g, '<br>')}</p>`)
  .join('\n');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Cover Letter</title><style>@page{size:letter;margin:.75in}body{font-family:Arial,sans-serif;font-size:11pt;line-height:1.45;color:#111;margin:0}p{margin:0 0 1em}p:last-child{margin-bottom:0}</style></head><body>${paragraphs}</body></html>`;
const run = join(
  root,
  'logs',
  'publishing',
  new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8),
);
mkdirSync(run, { recursive: true });
writeFileSync(join(run, 'cover-letter.md'), body + '\n');
const htmlPath = join(run, 'cover-letter.html'),
  stagedPDF = join(run, 'cover-letter.pdf'),
  outputPDF = join(dirname(source), 'cover-letter.pdf');
writeFileSync(htmlPath, html);
const rendered = spawnSync(
  process.execPath,
  [join(root, 'src', 'cvgen', 'generate-pdf.mjs'), htmlPath, stagedPDF, '--format=letter'],
  { encoding: 'utf8', windowsHide: true },
);
writeFileSync(join(run, 'render.log'), (rendered.stdout || '') + (rendered.stderr || ''));
if (rendered.status !== 0) throw new Error('PDF render failed; inspect ' + join(run, 'render.log'));
copyFileSync(stagedPDF, outputPDF);
console.log(JSON.stringify({ status: 'published', pdf: outputPDF, run_directory: run }, null, 2));
