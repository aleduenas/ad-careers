import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import * as realFs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { urlKey } from '../lib/_database.mjs';
import { createJobsWrite, MAX_JD_BYTES, writeJdCache } from './jobs-write.mjs';
import { DatabaseUnavailableError, SchemaNotReadyError } from './readiness.mjs';

// Test guard: a test never reaches the configured database (see src/lib/_database.mjs).
process.env.CAREER_OPS_TEST_GUARD = '1';

const sha = text => createHash('sha256').update(text).digest('hex');

function fakeJob(overrides = {}) {
  return {
    id: '7',
    revision: '4',
    company: 'Acme',
    role: 'Engineer',
    status: 'Evaluated',
    ...overrides,
  };
}

function makeWriter({ query, state = {}, root, fs } = {}) {
  const calls = [];
  const detailReader = {
    detail: async id => {
      if (state.missing) {
        const error = new Error('Job or material not found.');
        error.statusCode = 404;
        error.publicCode = 'NOT_FOUND';
        throw error;
      }
      return { job: fakeJob({ id }), jd: null };
    },
  };
  const client = {
    query: async (sql, args) => {
      calls.push(['tx', sql, args]);
      if (/FROM jobs WHERE id/.test(sql))
        return state.job === null ? [] : [state.job ?? { id: '7', jd_path: null }];
      if (/FROM job_descriptions/.test(sql)) return state.jd ? [state.jd] : [];
      if (/sync_job_description/.test(sql)) {
        const [, content, file_path, hash] = args;
        state.jd = {
          content,
          content_hash: hash,
          revision: String(Number(state.jd?.revision ?? 0) + 1),
          file_path,
          synced_at: new Date('2026-11-10T12:00:00Z'),
        };
        return [state.jd];
      }
      throw new Error('unexpected tx SQL');
    },
  };
  const writer = createJobsWrite({
    query:
      query ||
      (async (sql, args) => {
        calls.push(['q', sql, args]);
        return state.rows ?? [{ id: '7' }];
      }),
    transaction: async fn => {
      const snapshot = state.jd ? { ...state.jd } : null;
      try {
        return await fn(client);
      } catch (error) {
        state.jd = snapshot;
        throw error;
      }
    },
    detailReader,
    rootDir: root,
    fs,
  });
  return { writer, calls, state };
}

async function rejects(promise, statusCode, code, field) {
  await assert.rejects(promise, error => {
    assert.equal(error.statusCode, statusCode, error.message);
    assert.equal(error.publicCode, code);
    if (field) assert.deepEqual(Object.keys(error.fields), [field]);
    return true;
  });
}

const status = (overrides = {}) => ({
  expectedRevision: '4',
  status: 'Applied',
  reason: '',
  ...overrides,
});

test('status: validation matrix', async () => {
  const { writer, calls } = makeWriter();
  for (const id of ['0', '01', 'abc', '', '1'.repeat(20), 7, null])
    await rejects(writer.changeStatus(id, status()), 400, 'INVALID_REQUEST', 'id');
  await rejects(writer.changeStatus('9223372036854775808', status()), 404, 'NOT_FOUND');
  for (const expectedRevision of [
    '',
    '-1',
    '01',
    'x',
    4,
    null,
    undefined,
    '1'.repeat(20),
    '9223372036854775808',
  ])
    await rejects(
      writer.changeStatus('7', status({ expectedRevision })),
      400,
      'INVALID_REQUEST',
      'expectedRevision',
    );
  for (const value of ['Ghosted', 'SKIP', 'applied', '', 5, null, undefined])
    await rejects(
      writer.changeStatus('7', status({ status: value })),
      400,
      'INVALID_REQUEST',
      'status',
    );
  await rejects(writer.changeStatus('7', status({ reason: 5 })), 400, 'INVALID_REQUEST', 'reason');
  await rejects(
    writer.changeStatus('7', status({ reason: 'x'.repeat(201) })),
    400,
    'INVALID_REQUEST',
    'reason',
  );
  for (const reason of ['', '   ', '\u0000\u0007 '])
    await rejects(
      writer.changeStatus('7', status({ status: 'Discarded', reason })),
      400,
      'INVALID_REQUEST',
      'reason',
    );
  await rejects(writer.changeStatus('7', status({ extra: 1 })), 400, 'INVALID_REQUEST', 'extra');
  await rejects(writer.changeStatus('7', null), 400, 'INVALID_REQUEST', 'body');
  await rejects(writer.changeStatus('7', []), 400, 'INVALID_REQUEST', 'body');
  assert.equal(calls.length, 0, 'nothing reaches the database for invalid requests');
});

test('status: every allowed status goes through change_job_status with the browser actor', async () => {
  for (const next of ['Applied', 'Rejected', 'Interview', 'Offer', 'Pending', 'Evaluated']) {
    const { writer, calls } = makeWriter();
    const result = await writer.changeStatus(
      '7',
      status({ status: next, reason: '  noted\u0000 ' }),
    );
    assert.equal(result.job.id, '7');
    const [, sql, args] = calls[0];
    assert.match(sql, /change_job_status\(\$1::bigint, \$2::bigint, \$3, \$4, \$5\)/);
    assert.deepEqual(args, ['7', '4', next, 'noted', 'browser']);
  }
  const { writer, calls } = makeWriter();
  await writer.changeStatus('7', status({ status: 'Discarded', reason: 'Seniority mismatch' }));
  assert.deepEqual(calls[0][2], ['7', '4', 'Discarded', 'Seniority mismatch', 'browser']);
  assert.ok(calls.every(call => /^\s*SELECT\b/i.test(call[1]) || call[0] === 'tx'));
});

test('status: stale revision is 409 with the current job; unknown job 404; SQL discard rule 400', async () => {
  const stale = makeWriter({
    query: async () => {
      throw Object.assign(new Error('Revision conflict for job 7; refresh and retry'), {
        code: '40001',
      });
    },
  }).writer;
  await assert.rejects(stale.changeStatus('7', status()), error => {
    assert.equal(error.statusCode, 409);
    assert.equal(error.publicCode, 'REVISION_CONFLICT');
    assert.equal(error.current.job.id, '7');
    assert.equal(error.current.job.revision, '4');
    return true;
  });
  const missing = makeWriter({
    query: async () => {
      throw Object.assign(new Error('Job 7 does not exist'), { code: 'P0001' });
    },
  }).writer;
  await rejects(missing.changeStatus('7', status()), 404, 'NOT_FOUND');
  const rule = makeWriter({
    query: async () => {
      throw Object.assign(new Error('Discard reason is required'), { code: 'P0001' });
    },
  }).writer;
  await rejects(
    rule.changeStatus('7', status({ status: 'Discarded', reason: 'ok' })),
    400,
    'INVALID_REQUEST',
    'reason',
  );
});

test('database failures are safe public errors and never carry driver text', async () => {
  const boom = code =>
    makeWriter({
      query: async () => {
        throw Object.assign(new Error('secret-driver-text'), code ? { code } : {});
      },
    }).writer;
  await assert.rejects(boom().changeStatus('7', status()), DatabaseUnavailableError);
  await assert.rejects(boom('42P01').changeStatus('7', status()), SchemaNotReadyError);
  await assert.rejects(
    boom().updateMetadata('7', { field: 'role', expectedValue: 'a', value: 'b' }),
    DatabaseUnavailableError,
  );
  const jd = makeWriter({ state: {} });
  const failing = createJobsWrite({
    query: async () => [],
    transaction: async () => {
      throw new Error('secret-driver-text');
    },
    detailReader: { detail: async () => ({ job: fakeJob() }) },
  });
  await assert.rejects(
    failing.saveJd('7', { expectedRevision: '0', expectedHash: '', text: 'x' }),
    error => error instanceof DatabaseUnavailableError && !error.message.includes('secret'),
  );
  assert.ok(jd);
});

const meta = (overrides = {}) => ({
  field: 'role',
  expectedValue: 'Engineer',
  value: 'Staff Engineer',
  ...overrides,
});

test('metadata: validation matrix', async () => {
  const { writer, calls } = makeWriter();
  await rejects(
    writer.updateMetadata('7', meta({ field: 'status' })),
    400,
    'INVALID_REQUEST',
    'field',
  );
  await rejects(
    writer.updateMetadata('7', meta({ field: 'notes' })),
    400,
    'INVALID_REQUEST',
    'field',
  );
  await rejects(writer.updateMetadata('7', meta({ extra: 1 })), 400, 'INVALID_REQUEST', 'extra');
  for (const value of ['', '   ', '\u0000\u0001', 5, null, 'x'.repeat(301)])
    for (const field of ['company', 'role'])
      await rejects(
        writer.updateMetadata('7', meta({ field, value })),
        400,
        'INVALID_REQUEST',
        'value',
      );
  await rejects(
    writer.updateMetadata('7', meta({ expectedValue: null })),
    400,
    'INVALID_REQUEST',
    'expectedValue',
  );
  for (const value of [
    'ftp://x.example/a',
    'javascript:alert(1)',
    'not a url',
    'https://user:pw@x.example/a',
    '//x.example',
  ])
    await rejects(
      writer.updateMetadata('7', { field: 'url', expectedValue: null, value }),
      400,
      'INVALID_REQUEST',
      'value',
    );
  await rejects(
    writer.updateMetadata('7', { field: 'url', expectedValue: 5, value: 'https://x.example' }),
    400,
    'INVALID_REQUEST',
    'expectedValue',
  );
  const salary = value =>
    writer.updateMetadata('7', { field: 'salaryBand', expectedValue: null, value });
  for (const value of [
    { min: '100', max: '50' },
    { min: '-1', max: '5' },
    { min: '1e3', max: '5000' },
    { min: 'NaN', max: '5' },
    { min: '1,000', max: '5' },
    { min: '10', max: null },
    { min: '10' },
    { min: '10', max: '20', extra: '1' },
    'x',
    [],
    5,
  ])
    await rejects(salary(value), 400, 'INVALID_REQUEST', 'value');
  await rejects(
    writer.updateMetadata('7', { field: 'salaryBand', expectedValue: 'x', value: null }),
    400,
    'INVALID_REQUEST',
    'expectedValue',
  );
  assert.equal(calls.length, 0);
});

test('metadata: company and role use a field-value guard and bump the revision', async () => {
  for (const field of ['company', 'role']) {
    const { writer, calls } = makeWriter();
    const result = await writer.updateMetadata('7', {
      field,
      expectedValue: 'Old Value',
      value: '  New \u0000Value  ',
    });
    assert.equal(result.job.id, '7');
    const [, sql, args] = calls[0];
    assert.match(sql, new RegExp(`UPDATE jobs SET ${field} = \\$1, revision = revision \\+ 1`));
    assert.match(sql, new RegExp(`${field} IS NOT DISTINCT FROM \\$3`));
    assert.deepEqual(args, ['New Value', '7', 'Old Value']);
    assert.doesNotMatch(sql, /status|notes/);
  }
});

test('metadata: url sets url_key in the same statement and handles uniqueness', async () => {
  const { writer, calls } = makeWriter();
  await writer.updateMetadata('7', {
    field: 'url',
    expectedValue: null,
    value: ' https://www.Example.com/Jobs/42/ ',
  });
  const [, sql, args] = calls.at(-1);
  assert.match(sql, /SET url = \$1, url_key = \$2, revision = revision \+ 1/);
  assert.deepEqual(args, [
    'https://www.Example.com/Jobs/42/',
    urlKey('https://www.Example.com/Jobs/42/'),
    '7',
    null,
    null,
  ]);
  assert.equal(args[1], 'example.com/jobs/42');
  assert.match(sql, /url_key = \$5/);

  const duplicate = makeWriter({
    query: async sql => {
      if (/^SELECT/.test(sql)) return [];
      throw Object.assign(
        new Error('duplicate key value violates unique constraint "jobs_url_key_key"'),
        {
          code: '23505',
        },
      );
    },
  }).writer;
  await assert.rejects(
    duplicate.updateMetadata('7', {
      field: 'url',
      expectedValue: 'https://a.example/1',
      value: 'https://b.example/2',
    }),
    error => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.publicCode, 'URL_IN_USE');
      assert.equal(error.current.job.id, '7');
      assert.equal(JSON.stringify(error).includes('jobs_url_key_key'), false);
      return true;
    },
  );
});

test('metadata: salary band edit, partial expected pair and clear', async () => {
  const { writer, calls } = makeWriter();
  await writer.updateMetadata('7', {
    field: 'salaryBand',
    expectedValue: { min: '90000.50', max: null },
    value: { min: '100000', max: '130000.25' },
  });
  assert.match(calls[0][1], /salary_min = \$1::numeric, salary_max = \$2::numeric/);
  assert.match(calls[0][1], /salary_min IS NOT DISTINCT FROM \$4::numeric/);
  assert.match(calls[0][1], /salary_max IS NOT DISTINCT FROM \$5::numeric/);
  assert.deepEqual(calls[0][2], ['100000', '130000.25', '7', '90000.50', null]);
  await writer.updateMetadata('7', {
    field: 'salaryBand',
    expectedValue: { min: '100000', max: '130000.25' },
    value: null,
  });
  assert.deepEqual(calls[1][2], [null, null, '7', '100000', '130000.25']);
  await writer.updateMetadata('7', {
    field: 'salaryBand',
    expectedValue: null,
    value: { min: '100.5', max: '100.50' },
  });
  assert.deepEqual(
    calls[2][2].slice(0, 2),
    ['100.5', '100.50'],
    'equal decimals with different scale are allowed',
  );
  await writer.updateMetadata('7', {
    field: 'salaryBand',
    expectedValue: null,
    value: { min: '12345678901234567890.12', max: '12345678901234567999.88' },
  });
  assert.equal(calls[3][2][0], '12345678901234567890.12', 'large decimals stay exact strings');
});

test('metadata: zero rows is 404 for an unknown job and FIELD_CONFLICT with the current job otherwise', async () => {
  let known = true;
  const writer = makeWriter({
    query: async sql => (sql.startsWith('UPDATE') ? [] : known ? [{ id: '7' }] : []),
  }).writer;
  await assert.rejects(writer.updateMetadata('7', meta()), error => {
    assert.equal(error.statusCode, 409);
    assert.equal(error.publicCode, 'FIELD_CONFLICT');
    assert.equal(error.current.job.id, '7');
    return true;
  });
  known = false;
  await rejects(writer.updateMetadata('7', meta()), 404, 'NOT_FOUND');
});

test('metadata: a check-constraint failure is a 400 for the value', async () => {
  const writer = makeWriter({
    query: async () => {
      throw Object.assign(new Error('violates check'), { code: '23514' });
    },
  }).writer;
  await rejects(
    writer.updateMetadata('7', {
      field: 'salaryBand',
      expectedValue: null,
      value: { min: '1', max: '2' },
    }),
    400,
    'INVALID_REQUEST',
    'value',
  );
});

const jd = (overrides = {}) => ({
  expectedRevision: '0',
  expectedHash: '',
  text: 'Great role.\r\nApply now.',
  ...overrides,
});

async function withRoot(callback) {
  const root = await mkdtemp(join(tmpdir(), 'career-ops-jdwrite-'));
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  }
}

test('jd: validation matrix', async () => {
  const { writer, calls } = makeWriter();
  await rejects(writer.saveJd('7', jd({ text: '' })), 400, 'INVALID_REQUEST', 'text');
  await rejects(writer.saveJd('7', jd({ text: ' \n\t ' })), 400, 'INVALID_REQUEST', 'text');
  await rejects(writer.saveJd('7', jd({ text: 'a\u0000b' })), 400, 'INVALID_REQUEST', 'text');
  await rejects(writer.saveJd('7', jd({ text: 5 })), 400, 'INVALID_REQUEST', 'text');
  await rejects(
    writer.saveJd('7', jd({ text: 'x'.repeat(MAX_JD_BYTES + 1) })),
    400,
    'INVALID_REQUEST',
    'text',
  );
  await rejects(
    writer.saveJd('7', jd({ text: 'x\n<!-- career-ops-job-id: 99 -->\n' })),
    400,
    'INVALID_REQUEST',
    'text',
  );
  await rejects(
    writer.saveJd('7', jd({ expectedRevision: 0 })),
    400,
    'INVALID_REQUEST',
    'expectedRevision',
  );
  await rejects(
    writer.saveJd('7', jd({ expectedHash: 5 })),
    400,
    'INVALID_REQUEST',
    'expectedHash',
  );
  await rejects(
    writer.saveJd('7', jd({ expectedHash: 'x'.repeat(65) })),
    400,
    'INVALID_REQUEST',
    'expectedHash',
  );
  await rejects(writer.saveJd('7', jd({ extra: 1 })), 400, 'INVALID_REQUEST', 'extra');
  await rejects(writer.saveJd('0', jd()), 400, 'INVALID_REQUEST', 'id');
  assert.equal(calls.length, 0);
});

test('jd: new text is tagged, normalized, saved to the database first and then the cache file', async () => {
  await withRoot(async root => {
    const state = {};
    const { writer, calls } = makeWriter({ state, root });
    const result = await writer.saveJd('7', jd());
    const expected = 'Great role.\nApply now.\n\n<!-- career-ops-job-id: 7 -->\n';
    assert.equal(state.jd.content, expected);
    const sync = calls.find(call => /sync_job_description/.test(call[1]));
    assert.deepEqual(sync[2], ['7', expected, 'data/jds/7.md', sha(expected)]);
    assert.equal(result.cacheSync, 'ok');
    assert.deepEqual(
      [result.jd.text, result.jd.contentHash, result.jd.revision],
      [expected, sha(expected), '1'],
    );
    assert.equal(result.job.id, '7');
    assert.equal(await readFile(join(root, 'data', 'jds', '7.md'), 'utf8'), expected);
    // Database work happened before the cache file existed check: the order is sync, then write.
    assert.ok(calls.findIndex(call => /sync_job_description/.test(call[1])) >= 0);

    // An existing tag for this job is kept as is; an existing path is reused.
    const again = await writer.saveJd('7', {
      expectedRevision: '1',
      expectedHash: sha(expected),
      text: 'Changed.\n<!-- career-ops-job-id: 7 -->\n',
    });
    assert.equal(again.jd.revision, '2');
    assert.equal(state.jd.file_path, 'data/jds/7.md');
  });
});

test('jd: unchanged text returns the current row with no new revision', async () => {
  await withRoot(async root => {
    const tagged = 'Same text.\n\n<!-- career-ops-job-id: 7 -->\n';
    const state = {
      jd: {
        content: tagged,
        content_hash: sha(tagged),
        revision: '3',
        file_path: 'data/jds/7.md',
        synced_at: new Date('2026-11-01T00:00:00Z'),
      },
    };
    const { writer, calls } = makeWriter({ state, root });
    const result = await writer.saveJd('7', {
      expectedRevision: '3',
      expectedHash: sha(tagged),
      text: 'Same text.',
    });
    assert.equal(result.jd.revision, '3');
    assert.equal(result.jd.contentHash, sha(tagged));
    assert.equal(
      calls.some(call => /sync_job_description/.test(call[1])),
      false,
    );
  });
});

test('jd: stale revision or hash is JD_CONFLICT with the current text; missing JD needs 0 and empty hash', async () => {
  await withRoot(async root => {
    const tagged = 'Stored.\n\n<!-- career-ops-job-id: 7 -->\n';
    const state = {
      jd: {
        content: tagged,
        content_hash: sha(tagged),
        revision: '3',
        file_path: 'data/jds/7.md',
        synced_at: new Date(),
      },
    };
    const { writer, calls } = makeWriter({ state, root });
    for (const attempt of [
      { expectedRevision: '2', expectedHash: sha(tagged) },
      { expectedRevision: '3', expectedHash: 'stale' },
      { expectedRevision: '0', expectedHash: '' },
    ])
      await assert.rejects(writer.saveJd('7', { ...attempt, text: 'My edit' }), error => {
        assert.equal(error.statusCode, 409);
        assert.equal(error.publicCode, 'JD_CONFLICT');
        assert.deepEqual(error.current, { text: tagged, contentHash: sha(tagged), revision: '3' });
        return true;
      });
    assert.equal(
      calls.some(call => /sync_job_description/.test(call[1])),
      false,
    );
    assert.equal(state.jd.content, tagged, 'a conflict changes nothing');

    const empty = makeWriter({ state: {}, root });
    await assert.rejects(
      empty.writer.saveJd('7', { expectedRevision: '2', expectedHash: '', text: 'x' }),
      error =>
        error.publicCode === 'JD_CONFLICT' &&
        error.current.text === null &&
        error.current.revision === '0',
    );
    const unknown = makeWriter({ state: { job: null }, root });
    await rejects(unknown.writer.saveJd('7', jd()), 404, 'NOT_FOUND');
  });
});

test('jd: a stored path outside data/jds is replaced by the default path', async () => {
  await withRoot(async root => {
    for (const bad of [
      '../outside.md',
      'C:\\x\\y.md',
      'data/other/7.md',
      '/etc/passwd',
      'data/jds/../x.md',
      null,
    ]) {
      const state = {
        job: { id: '7', jd_path: bad },
        jd: {
          content: 'old',
          content_hash: sha('old'),
          revision: '1',
          file_path: bad,
          synced_at: new Date(),
        },
      };
      if (bad === null) state.jd = null;
      const { writer } = makeWriter({ state, root });
      const result = await writer.saveJd('7', {
        expectedRevision: state.jd ? '1' : '0',
        expectedHash: state.jd ? sha('old') : '',
        text: 'new text',
      });
      assert.equal(state.jd.file_path, 'data/jds/7.md', String(bad));
      assert.equal(result.cacheSync, 'ok');
    }
    await assert.rejects(readFile(join(root, '..', 'outside.md'), 'utf8'));
  });
});

test('jd: a failed cache write is still committed and never reported as a plain save', async () => {
  await withRoot(async root => {
    const state = {};
    const failingFs = {
      ...realFs,
      rename: async () => {
        throw new Error('EPERM rename');
      },
    };
    const { writer } = makeWriter({ state, root, fs: failingFs });
    const result = await writer.saveJd('7', jd());
    assert.equal(result.cacheSync, 'error');
    assert.equal(state.jd.revision, '1', 'the database commit stands');
    assert.equal(result.jd.revision, '1');
    const leftovers = await realFs.readdir(join(root, 'data', 'jds'));
    assert.deepEqual(leftovers, [], 'no temporary file is left behind');
  });
});

test('writeJdCache is contained: symlink targets and escapes are refused', async () => {
  await withRoot(async root => {
    await writeJdCache(root, 'data/jds/ok.md', 'fine');
    assert.equal(await readFile(join(root, 'data', 'jds', 'ok.md'), 'utf8'), 'fine');
    await writeJdCache(root, 'data/jds/sub/deeper.md', 'nested');
    await assert.rejects(writeJdCache(root, 'data/jds/../escape.md', 'no'));
    await assert.rejects(writeJdCache(root, '../escape.md', 'no'));
    await writeFile(join(root, 'secret.txt'), 'original');
    let linked = false;
    try {
      await symlink(join(root, 'secret.txt'), join(root, 'data', 'jds', 'link.md'));
      linked = true;
    } catch {
      // Symlinks can need elevated rights on Windows; the case is then not asserted.
    }
    if (linked) {
      await assert.rejects(writeJdCache(root, 'data/jds/link.md', 'overwritten'));
      assert.equal(await readFile(join(root, 'secret.txt'), 'utf8'), 'original');
    }
    await mkdir(join(root, 'data', 'jds', 'dir.md'));
    await assert.rejects(writeJdCache(root, 'data/jds/dir.md', 'x'));
  });
});

test('factory rejects bad adapters', () => {
  assert.throws(() => createJobsWrite({ query: 'no', detailReader: { detail() {} } }), TypeError);
  assert.throws(() => createJobsWrite({ detailReader: null }), TypeError);
});

test('metadata: url edit is refused when another job holds the URL under an older stored key', async () => {
  const { writer, calls } = makeWriter({
    state: {
      rows: [
        {
          id: '9',
          url: 'https://x.example/jobs/9?utm_source=a',
          url_key: 'x.example/jobs/9?utm_source=a',
        },
        { id: '7', url: 'https://x.example/own', url_key: 'x.example/own' },
      ],
    },
  });
  await assert.rejects(
    writer.updateMetadata('7', {
      field: 'url',
      expectedValue: null,
      value: 'https://x.example/jobs/9',
    }),
    error => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.publicCode, 'URL_IN_USE');
      return true;
    },
  );
  assert.equal(
    calls.some(c => /UPDATE jobs/.test(c[1])),
    false,
    'no update is attempted',
  );
  await writer.updateMetadata('7', {
    field: 'url',
    expectedValue: null,
    value: 'https://x.example/own',
  });
});

test('D114 setFavorite updates only the flag, is idempotent, validates and maps unknown jobs to 404', async () => {
  const calls = [];
  const query = async (sql, args) => {
    calls.push([sql, args]);
    return args[0] === '404' ? [] : [{ id: args[0], favorite: args[1] }];
  };
  const { writer } = makeWriter({ query });
  assert.deepEqual(await writer.setFavorite('7', { favorite: true }), { id: '7', favorite: true });
  assert.deepEqual(await writer.setFavorite('7', { favorite: true }), { id: '7', favorite: true });
  assert.deepEqual(await writer.setFavorite('7', { favorite: false }), {
    id: '7',
    favorite: false,
  });
  for (const [sql] of calls) {
    assert.match(sql, /^UPDATE jobs SET favorite = \$2 WHERE id = \$1::bigint/);
    assert.doesNotMatch(sql, /revision|change_job_status|job_status_events/);
  }
  await assert.rejects(writer.setFavorite('404', { favorite: true }), { statusCode: 404 });
  for (const [id, body] of [
    ['abc', { favorite: true }],
    ['7', {}],
    ['7', { favorite: 'true' }],
    ['7', { favorite: true, status: 'Offer' }],
  ])
    await assert.rejects(writer.setFavorite(id, body), { statusCode: 400 });
});

test('D116 jd save refreshes the years-of-experience estimate after the commit and never fails the edit', async () => {
  await withRoot(async root => {
    const state = { job: { id: '7', jd_path: null, role: 'Senior Engineer' } };
    const stored = [];
    const { writer, calls } = makeWriter({
      state,
      root,
      query: async (sql, args) => {
        calls.push(['q', sql, args]);
        if (/UPDATE job_descriptions SET yoe_min/.test(sql)) stored.push(args);
        return [{ id: '7' }];
      },
    });
    const result = await writer.saveJd('7', jd({ text: 'You need 6+ years of experience.' }));
    assert.deepEqual(stored, [['7', 6, 'high']]);
    // The estimate is written outside the transaction, after the sync.
    const order = calls.map(call => (/sync_job_description/.test(call[1]) ? 'sync' : call[0]));
    assert.ok(order.indexOf('sync') < order.lastIndexOf('q'));
    // Unchanged text does not re-estimate.
    stored.length = 0;
    await writer.saveJd('7', {
      expectedRevision: result.jd.revision,
      expectedHash: result.jd.contentHash,
      text: result.jd.text,
    });
    assert.deepEqual(stored, []);
  });
  // A failing estimate write leaves the edit successful.
  await withRoot(async root => {
    const state = {};
    const { writer } = makeWriter({
      state,
      root,
      query: async () => {
        throw new Error('column does not exist');
      },
    });
    const result = await writer.saveJd('7', jd());
    assert.equal(result.jd.revision, '1');
    assert.equal(result.cacheSync, 'ok');
  });
});
