import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as nodeFs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { jobDetailSql } from './jobs-detail.mjs';
import {
  createLetterService,
  LETTER_MAX_BYTES,
  normalizeLetterText,
  sha256,
  validateLetterText,
} from './letter.mjs';
import { DatabaseUnavailableError } from './readiness.mjs';

// Test guard: a test never reaches the configured database (see src/lib/_database.mjs).
process.env.CAREER_OPS_TEST_GUARD = '1';

const sha = text => createHash('sha256').update(text).digest('hex');

// A temporary repository root with output/<company>/<role>--<id>/ and a stub for the two job
// queries the service makes. Nothing here touches output/ of the real repository.
async function withRoot(callback) {
  const rootDir = await nodeFs.mkdtemp(join(tmpdir(), 'career-ops-letter-'));
  const folder = join(rootDir, 'output', 'Acme', 'data-engineer--7');
  await nodeFs.mkdir(folder, { recursive: true });
  const state = {
    active: [],
    jobs: { 7: { id: '7', company: 'Acme', role: 'Data Engineer' } },
  };
  const query = async (sql, args) => {
    if (sql === jobDetailSql.job) return state.jobs[args[0]] ? [state.jobs[args[0]]] : [];
    if (sql === jobDetailSql.activeRuns) return state.active;
    throw new Error('unexpected query');
  };
  try {
    await callback({ rootDir, folder, state, query, file: join(folder, 'cover-letter.md') });
  } finally {
    await nodeFs.rm(rootDir, { recursive: true, force: true });
  }
}

const rejects = async (promise, statusCode, publicCode) =>
  assert.rejects(promise, error => {
    assert.equal(error.statusCode, statusCode);
    assert.equal(error.publicCode, publicCode);
    return true;
  });

test('validateLetterText: blank, size, control characters and line endings', () => {
  assert.equal(validateLetterText('a\r\nb\rc\td\n'), 'a\nb\nc\td\n');
  assert.equal(normalizeLetterText('x\r\ny'), 'x\ny');
  for (const blank of ['', '   ', '\n\n\t \n'])
    assert.throws(() => validateLetterText(blank), { publicCode: 'INVALID_REQUEST' }, blank);
  assert.throws(() => validateLetterText(5), { publicCode: 'INVALID_REQUEST' });
  assert.throws(() => validateLetterText(null), { publicCode: 'INVALID_REQUEST' });
  for (const code of [0, 1, 8, 11, 12, 14, 27, 127, 133])
    assert.throws(
      () => validateLetterText(`bad${String.fromCharCode(code)}text`),
      error => error.publicCode === 'INVALID_REQUEST' && Boolean(error.fields?.text),
      `control character ${code}`,
    );
  assert.doesNotThrow(() => validateLetterText('tab\there\nnew line and unicode \u00e9\u4e2d'));
  assert.doesNotThrow(() => validateLetterText('x'.repeat(LETTER_MAX_BYTES)));
  assert.throws(() => validateLetterText('x'.repeat(LETTER_MAX_BYTES + 1)), {
    publicCode: 'INVALID_REQUEST',
  });
  // The cap is on UTF-8 bytes, not characters.
  assert.throws(() => validateLetterText('\u00e9'.repeat(LETTER_MAX_BYTES / 2 + 1)), {
    publicCode: 'INVALID_REQUEST',
  });
  assert.equal(sha256(Buffer.from('abc')), sha('abc'));
});

test('read: text, sha256 of the bytes, and the PDF when one exists', async () => {
  await withRoot(async ({ rootDir, folder, file, query }) => {
    const service = createLetterService({ query, rootDir });
    await nodeFs.writeFile(file, 'Dear team,\r\nHello.\r\n');
    const first = await service.read('7');
    assert.equal(first.name, 'cover-letter.md');
    assert.equal(first.text, 'Dear team,\r\nHello.\r\n');
    assert.equal(first.contentHash, sha('Dear team,\r\nHello.\r\n'));
    assert.equal(first.editable, true);
    assert.equal(first.pdf, null);
    await nodeFs.writeFile(join(folder, 'cover-letter.pdf'), '%PDF-1.4');
    const second = await service.read('7');
    assert.equal(second.pdf.name, 'cover-letter.pdf');
    assert.match(second.pdf.modifiedAt, /^\d{4}-\d{2}-\d{2}T/);
  });
});

test('read: only the exact cover-letter.md of an id or legacy match is a letter', async () => {
  await withRoot(async ({ rootDir, folder, file, query, state }) => {
    const service = createLetterService({ query, rootDir });
    // No file at all, then a draft, a PDF and a brief: none of them is editable.
    await rejects(service.read('7'), 404, 'NOT_FOUND');
    for (const name of ['cover-letter-draft.md', 'cover-letter.pdf', 'cover-letter-brief.md'])
      await nodeFs.writeFile(join(folder, name), 'x');
    await rejects(service.read('7'), 404, 'NOT_FOUND');
    assert.deepEqual((await nodeFs.readdir(folder)).sort(), [
      'cover-letter-brief.md',
      'cover-letter-draft.md',
      'cover-letter.pdf',
    ]);
    await nodeFs.writeFile(file, 'Letter');
    assert.equal((await service.read('7')).text, 'Letter');
    // Unknown job, bad ids, a job without a folder and two folders for one id.
    await rejects(service.read('8'), 404, 'NOT_FOUND');
    for (const bad of ['0', '01', 'abc', '', '9'.repeat(20)])
      await assert.rejects(
        service.read(bad),
        error => error.statusCode === 400 || error.statusCode === 404,
      );
    state.jobs[9] = { id: '9', company: 'Nobody', role: 'Ghost' };
    await rejects(service.read('9'), 404, 'NOT_FOUND');
    const twin = join(rootDir, 'output', 'Other', 'role--7');
    await nodeFs.mkdir(twin, { recursive: true });
    await nodeFs.writeFile(join(twin, 'cover-letter.md'), 'Twin');
    await rejects(service.read('7'), 404, 'NOT_FOUND');
    await rejects(
      service.save('7', { expectedHash: sha('Letter'), text: 'New' }),
      404,
      'NOT_FOUND',
    );
    assert.equal(
      await nodeFs.readFile(file, 'utf8'),
      'Letter',
      'an ambiguous match is never written',
    );
  });
});

test('read: a legacy folder (no id suffix) matches by company and role', async () => {
  await withRoot(async ({ rootDir, query, state }) => {
    const folder = join(rootDir, 'output', 'Globex', 'platform-engineer');
    await nodeFs.mkdir(folder, { recursive: true });
    await nodeFs.writeFile(join(folder, 'cover-letter.md'), 'Legacy');
    state.jobs[12] = { id: '12', company: 'Globex', role: 'Platform Engineer' };
    const service = createLetterService({ query, rootDir });
    assert.equal((await service.read('12')).text, 'Legacy');
  });
});

test('read: a file over the cap or that is not UTF-8 is listed but not editable', async () => {
  await withRoot(async ({ rootDir, file, query }) => {
    const service = createLetterService({ query, rootDir });
    await nodeFs.writeFile(file, 'x'.repeat(LETTER_MAX_BYTES + 1));
    assert.deepEqual(await service.read('7'), {
      name: 'cover-letter.md',
      text: '',
      contentHash: '',
      pdf: null,
      editable: false,
    });
    await rejects(
      service.save('7', { expectedHash: sha('x'), text: 'New' }),
      409,
      'LETTER_NOT_EDITABLE',
    );
    await nodeFs.writeFile(file, Buffer.from([0xc3, 0x28, 0xff]));
    assert.equal((await service.read('7')).editable, false);
    assert.equal((await service.snapshot('7')).editable, false);
    await nodeFs.writeFile(file, 'x'.repeat(LETTER_MAX_BYTES));
    assert.equal((await service.read('7')).editable, true, 'exactly the cap is editable');
  });
});

test('save: writes the normalized text atomically and returns the new state', async () => {
  await withRoot(async ({ rootDir, folder, file, query }) => {
    const service = createLetterService({ query, rootDir });
    await nodeFs.writeFile(file, 'Old text\n');
    const saved = await service.save('7', {
      expectedHash: sha('Old text\n'),
      text: 'New\r\ntext\r\n',
    });
    assert.equal(await nodeFs.readFile(file, 'utf8'), 'New\ntext\n');
    assert.equal(saved.text, 'New\ntext\n');
    assert.equal(saved.contentHash, sha('New\ntext\n'));
    assert.deepEqual(
      await nodeFs.readdir(folder),
      ['cover-letter.md'],
      'no temporary file is left',
    );
    // The returned hash guards the next save.
    const next = await service.save('7', { expectedHash: saved.contentHash, text: 'Third\n' });
    assert.equal(next.text, 'Third\n');
  });
});

test('save: the hash guard returns 409 LETTER_CONFLICT with the current text and hash', async () => {
  await withRoot(async ({ rootDir, file, query }) => {
    const service = createLetterService({ query, rootDir });
    await nodeFs.writeFile(file, 'Theirs\n');
    await assert.rejects(
      service.save('7', { expectedHash: sha('Mine\n'), text: 'Mine edited\n' }),
      error => {
        assert.equal(error.statusCode, 409);
        assert.equal(error.publicCode, 'LETTER_CONFLICT');
        assert.deepEqual(error.current, { text: 'Theirs\n', contentHash: sha('Theirs\n') });
        return true;
      },
    );
    assert.equal(await nodeFs.readFile(file, 'utf8'), 'Theirs\n');
    // The guard is on bytes: a CRLF file hashes as written, so the loaded hash still matches.
    await nodeFs.writeFile(file, 'A\r\nB\r\n');
    const loaded = await service.read('7');
    const saved = await service.save('7', { expectedHash: loaded.contentHash, text: 'A\nB\nC\n' });
    assert.equal(saved.text, 'A\nB\nC\n');
  });
});

test('save: validation failures are 400 with the field and write nothing', async () => {
  await withRoot(async ({ rootDir, file, query }) => {
    const service = createLetterService({ query, rootDir });
    await nodeFs.writeFile(file, 'Keep\n');
    const expectedHash = sha('Keep\n');
    const attempt = body => service.save('7', body);
    await rejects(attempt({ expectedHash, text: '   \n' }), 400, 'INVALID_REQUEST');
    await rejects(attempt({ expectedHash, text: 'a\u0000b' }), 400, 'INVALID_REQUEST');
    await rejects(
      attempt({ expectedHash, text: 'x'.repeat(LETTER_MAX_BYTES + 1) }),
      400,
      'INVALID_REQUEST',
    );
    await rejects(attempt({ expectedHash: 'nope', text: 'x' }), 400, 'INVALID_REQUEST');
    await rejects(attempt({ text: 'x' }), 400, 'INVALID_REQUEST');
    await rejects(attempt({ expectedHash, text: 'x', extra: 1 }), 400, 'INVALID_REQUEST');
    await rejects(attempt(null), 400, 'INVALID_REQUEST');
    await rejects(attempt([]), 400, 'INVALID_REQUEST');
    assert.equal(await nodeFs.readFile(file, 'utf8'), 'Keep\n');
  });
});

test('save: unchanged text is a no-op, including CRLF that normalizes to the same text', async () => {
  await withRoot(async ({ rootDir, file, query }) => {
    let writes = 0;
    const fs = {
      ...nodeFs,
      writeFile: (...args) => (writes++, nodeFs.writeFile(...args)),
      rename: (...args) => (writes++, nodeFs.rename(...args)),
    };
    const service = createLetterService({ query, rootDir, fs });
    await nodeFs.writeFile(file, 'Same\r\ntext\r\n');
    const before = await nodeFs.stat(file);
    const state = await service.read('7');
    const result = await service.save('7', {
      expectedHash: state.contentHash,
      text: 'Same\ntext\n',
    });
    assert.equal(writes, 0, 'no write happened');
    assert.equal(result.contentHash, state.contentHash);
    assert.equal(result.text, 'Same\r\ntext\r\n');
    assert.equal((await nodeFs.stat(file)).mtimeMs, before.mtimeMs);
    // A stale hash on unchanged text is still a conflict (the guard comes first).
    await rejects(
      service.save('7', { expectedHash: sha('other'), text: 'Same\ntext\n' }),
      409,
      'LETTER_CONFLICT',
    );
  });
});

test('save: a failed swap leaves the original file and no temporary file', async () => {
  await withRoot(async ({ rootDir, folder, file, query }) => {
    const fs = {
      ...nodeFs,
      rename: async () => {
        throw new Error('disk full: C:\\secret\\path');
      },
    };
    const service = createLetterService({ query, rootDir, fs });
    await nodeFs.writeFile(file, 'Original\n');
    await assert.rejects(
      service.save('7', { expectedHash: sha('Original\n'), text: 'Changed\n' }),
      error => {
        assert.equal(error.statusCode, 500);
        assert.equal(error.publicCode, 'INTERNAL_ERROR');
        assert.doesNotMatch(error.message, /secret|disk/);
        return true;
      },
    );
    assert.equal(await nodeFs.readFile(file, 'utf8'), 'Original\n');
    assert.deepEqual(await nodeFs.readdir(folder), ['cover-letter.md']);
  });
});

test('save: a change made outside the server between the guard and the swap is a conflict', async () => {
  await withRoot(async ({ rootDir, file, query }) => {
    const fs = {
      ...nodeFs,
      writeFile: async (path, ...rest) => {
        const result = await nodeFs.writeFile(path, ...rest);
        if (String(path).endsWith('.tmp')) await nodeFs.writeFile(file, 'Edited elsewhere\n');
        return result;
      },
    };
    const service = createLetterService({ query, rootDir, fs });
    await nodeFs.writeFile(file, 'Original\n');
    await assert.rejects(
      service.save('7', { expectedHash: sha('Original\n'), text: 'Mine\n' }),
      error => {
        assert.equal(error.publicCode, 'LETTER_CONFLICT');
        assert.equal(error.current.text, 'Edited elsewhere\n');
        return true;
      },
    );
    assert.equal(await nodeFs.readFile(file, 'utf8'), 'Edited elsewhere\n');
  });
});

test('containment: a folder outside output/ is never read or written', async () => {
  await withRoot(async ({ rootDir, query }) => {
    const outside = await nodeFs.mkdtemp(join(tmpdir(), 'career-ops-outside-'));
    try {
      await nodeFs.writeFile(join(outside, 'cover-letter.md'), 'Outside\n');
      const resolveMaterials = async () => ({
        match: 'id',
        ambiguous: false,
        dir: outside,
        files: { letter: { name: 'cover-letter.md', kind: 'md' } },
      });
      const service = createLetterService({ query, rootDir, resolveMaterials });
      await rejects(service.read('7'), 404, 'NOT_FOUND');
      await rejects(
        service.save('7', { expectedHash: sha('Outside\n'), text: 'Changed\n' }),
        404,
        'NOT_FOUND',
      );
      assert.equal(await service.snapshot('7'), null);
      assert.equal(await nodeFs.readFile(join(outside, 'cover-letter.md'), 'utf8'), 'Outside\n');
      assert.deepEqual(await nodeFs.readdir(outside), ['cover-letter.md']);
    } finally {
      await nodeFs.rm(outside, { recursive: true, force: true });
    }
  });
});

test('containment: a symbolic-link letter is refused', async t => {
  await withRoot(async ({ rootDir, folder, file, query }) => {
    const outside = await nodeFs.mkdtemp(join(tmpdir(), 'career-ops-link-'));
    try {
      await nodeFs.writeFile(join(outside, 'secret.md'), 'Secret\n');
      try {
        await nodeFs.symlink(join(outside, 'secret.md'), file);
      } catch {
        t.skip('symbolic links are not available here');
        return;
      }
      const service = createLetterService({ query, rootDir });
      await rejects(service.read('7'), 404, 'NOT_FOUND');
      assert.deepEqual(await nodeFs.readdir(folder), ['cover-letter.md']);
      assert.equal(await nodeFs.readFile(join(outside, 'secret.md'), 'utf8'), 'Secret\n');
    } finally {
      await nodeFs.rm(outside, { recursive: true, force: true });
    }
  });
});

test('save: a queued or running letter or publish run refuses it with RUN_ACTIVE', async () => {
  await withRoot(async ({ rootDir, file, query, state }) => {
    const service = createLetterService({ query, rootDir });
    await nodeFs.writeFile(file, 'Text\n');
    const body = { expectedHash: sha('Text\n'), text: 'Edited\n' };
    for (const action of ['letter', 'publish']) {
      state.active = [{ id: '55', action }];
      await assert.rejects(service.save('7', body), error => {
        assert.equal(error.statusCode, 409);
        assert.equal(error.publicCode, 'RUN_ACTIVE');
        assert.deepEqual(error.current, { activeRunId: '55' });
        return true;
      });
      assert.equal(await nodeFs.readFile(file, 'utf8'), 'Text\n');
    }
    // Other actions do not block a letter edit; reads are never blocked.
    state.active = [
      { id: '56', action: 'evaluate' },
      { id: '57', action: 'cv' },
    ];
    assert.equal((await service.save('7', body)).text, 'Edited\n');
    state.active = [{ id: '58', action: 'letter' }];
    assert.equal((await service.read('7')).text, 'Edited\n');
  });
});

test('database failures are safe public errors; a missing runs table means no active run', async () => {
  await withRoot(async ({ rootDir, file, query }) => {
    await nodeFs.writeFile(file, 'Text\n');
    const failing = createLetterService({
      rootDir,
      query: async () => {
        throw Object.assign(new Error('password authentication failed'), { code: '28P01' });
      },
    });
    await assert.rejects(failing.read('7'), error => error instanceof DatabaseUnavailableError);
    const noRuns = createLetterService({
      rootDir,
      query: async (sql, args) => {
        if (sql === jobDetailSql.activeRuns) throw Object.assign(new Error('x'), { code: '42P01' });
        return query(sql, args);
      },
    });
    assert.equal(
      (await noRuns.save('7', { expectedHash: sha('Text\n'), text: 'More\n' })).text,
      'More\n',
    );
    const broken = createLetterService({
      rootDir,
      query: async (sql, args) => {
        if (sql === jobDetailSql.activeRuns) throw new Error('connection reset');
        return query(sql, args);
      },
    });
    await assert.rejects(
      broken.save('7', { expectedHash: sha('More\n'), text: 'Again\n' }),
      error => error instanceof DatabaseUnavailableError,
    );
    assert.equal(
      await nodeFs.readFile(file, 'utf8'),
      'More\n',
      'a failed active-run check writes nothing',
    );
  });
});

test('snapshot returns the absolute path, text and hash; exclusive runs one at a time', async () => {
  await withRoot(async ({ rootDir, file, query }) => {
    const service = createLetterService({ query, rootDir });
    assert.equal(await service.snapshot('7'), null, 'no letter, no snapshot');
    await nodeFs.writeFile(file, 'Body\n');
    const snapshot = await service.snapshot('7');
    assert.equal(snapshot.contentHash, sha('Body\n'));
    assert.equal(snapshot.text, 'Body\n');
    assert.equal(snapshot.editable, true);
    assert.equal(await nodeFs.realpath(snapshot.path), await nodeFs.realpath(file));
    const order = [];
    const first = service.exclusive(async () => {
      order.push('a:start');
      await new Promise(resolve => setTimeout(resolve, 20));
      order.push('a:end');
    });
    const second = service.exclusive(async () => order.push('b'));
    const failing = service.exclusive(async () => {
      throw new Error('boom');
    });
    const third = service.exclusive(async () => order.push('c'));
    await Promise.all([first, second, third]);
    await assert.rejects(failing, /boom/);
    assert.deepEqual(order, ['a:start', 'a:end', 'b', 'c']);
  });
});

test('factory rejects non-function adapters', () => {
  assert.throws(() => createLetterService({ query: 5 }), TypeError);
  assert.throws(() => createLetterService({ resolveMaterials: 'x' }), TypeError);
});

test('pdf: the published cover-letter.pdf is served from the matched folder only', async () => {
  await withRoot(async ({ rootDir, folder, file, query }) => {
    const service = createLetterService({ query, rootDir });
    await rejects(service.pdf('7'), 404, 'NOT_FOUND');
    await nodeFs.writeFile(file, 'Letter\n');
    await rejects(service.pdf('7'), 404, 'NOT_FOUND');
    await nodeFs.writeFile(join(folder, 'cover-letter.pdf'), '%PDF-1.4 fake');
    const pdf = await service.pdf('7');
    assert.equal(pdf.name, 'cover-letter.pdf');
    assert.equal(pdf.size, 13);
    const chunks = [];
    for await (const chunk of pdf.stream()) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString(), '%PDF-1.4 fake');
    await rejects(service.pdf('8'), 404, 'NOT_FOUND');
  });
});
