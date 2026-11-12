import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createJobsDetail, jobDetailSql } from './jobs-detail.mjs';
import { DatabaseUnavailableError, SchemaNotReadyError } from './readiness.mjs';

const STATUSES = ['Pending', 'Evaluated', 'Applied', 'Interview', 'Offer', 'Rejected', 'Discarded'];

function jobRow(overrides = {}) {
  return {
    id: '1',
    revision: '3',
    company: 'Fixture Co',
    role: 'Data Engineer',
    url: 'https://example.invalid/jobs/1',
    status: 'Evaluated',
    score: '4.2',
    source_date: '2026-10-01',
    notes: 'Private note text',
    report_path: null,
    salary_min: null,
    salary_max: null,
    evaluation_error: false,
    first_seen: null,
    status_date: '2026-10-02',
    discard_reason: null,
    ...overrides,
  };
}

function makeQuery(data = {}) {
  const calls = [];
  const query = async (sql, args) => {
    assert.match(sql, /^\s*SELECT\b/i, 'detail SQL must be SELECT-only');
    calls.push([sql, args]);
    const id = args[0];
    if (data.fail) throw data.fail;
    if (sql === jobDetailSql.job) return (data.jobs || []).filter(row => row.id === id);
    if (sql === jobDetailSql.jd) return (data.jd || {})[id] ? [data.jd[id]] : [];
    if (sql === jobDetailSql.evaluations) return (data.evaluations || {})[id] || [];
    if (sql === jobDetailSql.events) return (data.events || {})[id] || [];
    if (sql === jobDetailSql.activeRuns) {
      if (data.activeFail) throw new Error('relation "browser_runs" does not exist');
      return (data.activeRuns || {})[id] || [];
    }
    throw new Error('unexpected SQL');
  };
  return { query, calls };
}

async function tempRoot() {
  const dir = await mkdtemp(join(tmpdir(), 'career-ops-detail-'));
  await mkdir(join(dir, 'data', 'evaluations'), { recursive: true });
  await mkdir(join(dir, 'data', 'interview-prep'), { recursive: true });
  await mkdir(join(dir, 'output'), { recursive: true });
  return dir;
}

async function putFile(root, relative, content = 'x') {
  const path = join(root, relative);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content);
}

async function withDetail(data, callback, seed = async () => {}) {
  const root = await tempRoot();
  try {
    await seed(root);
    const { query, calls } = makeQuery(data);
    const reader = createJobsDetail({ query, rootDir: root });
    await callback(reader, { root, calls });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function rejects(promise, statusCode, code, field) {
  await assert.rejects(promise, error => {
    assert.equal(error.statusCode, statusCode);
    assert.equal(error.publicCode, code);
    if (field) assert.deepEqual(Object.keys(error.fields), [field]);
    return true;
  });
}

test('id and key validation, unknown job and bigint overflow', async () => {
  await withDetail({ jobs: [jobRow()] }, async reader => {
    for (const bad of ['0', '01', 'abc', '', '-1', '1.5', '1'.repeat(20), ' 1'])
      await rejects(reader.detail(bad), 400, 'INVALID_REQUEST', 'id');
    await rejects(reader.detail(5), 400, 'INVALID_REQUEST', 'id');
    await rejects(reader.detail('2'), 404, 'NOT_FOUND');
    await rejects(reader.detail('9223372036854775808'), 404, 'NOT_FOUND');
    await rejects(reader.material('0', 'cv'), 400, 'INVALID_REQUEST', 'id');
    for (const key of ['', 'CV', 'resume', 'cv/../x', 'prep '])
      await rejects(reader.material('1', key), 400, 'INVALID_REQUEST', 'key');
    await rejects(reader.material('2', 'cv'), 404, 'NOT_FOUND');
  });
});

test('detail returns notes, a boolean evaluation error and no private paths for every status', async () => {
  const jobs = STATUSES.map((status, index) =>
    jobRow({
      id: String(index + 1),
      status,
      report_path: 'data/evaluations/secret-report-path.md',
      evaluation_error: index === 1,
      discard_reason: status === 'Discarded' ? 'Not a fit' : null,
    }),
  );
  await withDetail({ jobs }, async reader => {
    for (const row of jobs) {
      const result = await reader.detail(row.id);
      assert.equal(result.job.status, row.status);
      assert.equal(result.job.notes, 'Private note text');
      assert.equal(result.job.evaluationError, row.id === '2');
      assert.equal(result.job.id, row.id);
      assert.equal(typeof result.job.evaluationError, 'boolean');
      const wire = JSON.stringify(result);
      assert.equal(wire.includes('secret-report-path'), false);
      assert.equal(wire.includes('report_path'), false);
      assert.equal(result.interviewPrep, null);
    }
    assert.equal((await reader.detail('7')).job.discardReason, 'Not a fit');
  });
});

test('null dates, null score and inferred history are never substituted', async () => {
  const jobs = [jobRow({ score: null, source_date: null, status_date: null })];
  const events = {
    1: [
      {
        id: '10',
        old_status: null,
        new_status: 'Evaluated',
        reason: '',
        actor: 'import',
        occurred_at: null,
        created_at: new Date('2026-11-01T10:00:00Z'),
      },
      {
        id: '11',
        old_status: 'Evaluated',
        new_status: 'Applied',
        reason: 'Sent',
        actor: 'user',
        occurred_at: new Date('2026-11-02T15:00:00Z'),
        created_at: new Date('2026-11-03T10:00:00Z'),
      },
    ],
  };
  const evaluations = {
    1: [
      {
        id: '5',
        score: null,
        result_status: 'SKIP',
        created_at: new Date('2026-11-01T09:00:00Z'),
      },
      {
        id: '4',
        score: '3.5',
        result_status: 'Evaluated',
        created_at: new Date('2026-10-30T09:00:00Z'),
      },
    ],
  };
  await withDetail({ jobs, events, evaluations }, async reader => {
    const result = await reader.detail('1');
    assert.equal(result.job.score, null);
    assert.equal(result.job.addedDate, null);
    assert.equal(result.job.statusDate, null);
    assert.equal(result.history[0].occurredAt, null);
    assert.equal(result.history[0].createdAt, '2026-11-01T10:00:00.000Z');
    assert.equal(result.history[0].oldStatus, null);
    assert.equal(result.history[1].occurredAt, '2026-11-02T15:00:00.000Z');
    assert.deepEqual(
      result.history.map(item => item.id),
      ['10', '11'],
    );
    assert.deepEqual(
      result.evaluation.history.map(item => [item.id, item.score, item.resultStatus]),
      [
        ['5', null, 'SKIP'],
        ['4', 3.5, 'Evaluated'],
      ],
    );
  });
});

test('job description comes from job_descriptions without its file path', async () => {
  const jd = {
    1: {
      content: 'Synthetic JD text',
      content_hash: 'abc123',
      revision: '2',
      synced_at: new Date('2026-11-05T12:00:00Z'),
      file_path: 'data/jds/private.md',
    },
  };
  await withDetail({ jobs: [jobRow(), jobRow({ id: '2' })], jd }, async reader => {
    const one = await reader.detail('1');
    assert.deepEqual(one.jd, {
      text: 'Synthetic JD text',
      contentHash: 'abc123',
      revision: '2',
      syncedAt: '2026-11-05T12:00:00.000Z',
    });
    assert.equal(JSON.stringify(one).includes('private.md'), false);
    assert.equal((await reader.detail('2')).jd, null);
  });
});

test('report states: ok, missing, invalid and unsafe', async () => {
  const jobs = [
    jobRow({ id: '1', report_path: 'data/evaluations/ok.md' }),
    jobRow({ id: '2', report_path: null }),
    jobRow({ id: '3', report_path: 'data/evaluations/absent.md' }),
    jobRow({ id: '4', report_path: 'data/evaluations/huge.md' }),
    jobRow({ id: '5', report_path: 'data/evaluations/bad-utf8.md' }),
    jobRow({ id: '6', report_path: '../outside.md' }),
    jobRow({ id: '7', report_path: 'config/profile.yml' }),
    jobRow({ id: '8', report_path: 'C:\\Windows\\win.ini' }),
    jobRow({ id: '9', report_path: 'data/evaluations/link.md' }),
    jobRow({ id: '10', report_path: 'output/co/role/report.md' }),
  ];
  let linked = false;
  await withDetail(
    { jobs },
    async reader => {
      assert.deepEqual((await reader.detail('1')).evaluation.report, {
        text: '# Report\nBody',
        state: 'ok',
      });
      const states = {};
      for (const id of ['2', '3', '4', '5', '6', '7', '8', '9', '10'])
        states[id] = (await reader.detail(id)).evaluation.report;
      assert.deepEqual(states['2'], { text: null, state: 'missing' });
      assert.deepEqual(states['3'], { text: null, state: 'missing' });
      assert.deepEqual(states['4'], { text: null, state: 'invalid' });
      assert.deepEqual(states['5'], { text: null, state: 'invalid' });
      for (const id of ['6', '7', '8'])
        assert.deepEqual(states[id], { text: null, state: 'unsafe' }, `job ${id}`);
      assert.equal(states['10'].state, 'ok', 'output/ is an allowed report root');
      assert.deepEqual(
        states['9'],
        { text: null, state: linked ? 'unsafe' : 'missing' },
        'symlinked report is unsafe when the link could be created',
      );
    },
    async root => {
      await putFile(root, 'data/evaluations/ok.md', '# Report\nBody');
      await putFile(root, 'data/evaluations/huge.md', 'a'.repeat(1024 * 1024 + 1));
      await writeFile(join(root, 'data/evaluations/bad-utf8.md'), Buffer.from([0xff, 0xfe, 0xfd]));
      await putFile(root, 'outside.md');
      await putFile(root, 'output/co/role/report.md', 'In output');
      try {
        await symlink(join(root, 'data/evaluations/ok.md'), join(root, 'data/evaluations/link.md'));
        linked = true;
      } catch {
        // Symlink creation can need elevated rights on Windows; the case is then not asserted.
      }
    },
  );
});

async function seedMaterials(root, folder, names) {
  for (const name of names)
    await putFile(root, `output/fixture-co/${folder}/${name}`, `body ${name}`);
}

test('materials: ID match with every preferred kind order', async () => {
  const jobs = [jobRow({ id: '12' })];
  const cases = [
    [['cv-a.html', 'cv-a.pdf'], 'cv', 'cv-a.pdf', 'pdf'],
    [['cv-a.html'], 'cv', 'cv-a.html', 'html'],
    [['cv-b.pdf', 'cv-a.pdf'], 'cv', 'cv-a.pdf', 'pdf'],
    [
      ['cover-letter.html', 'cover-letter.pdf', 'cover-letter.md', 'cover-letter-draft.md'],
      'letter',
      'cover-letter.md',
      'md',
    ],
    [
      ['cover-letter.html', 'cover-letter.pdf', 'cover-letter-draft.md'],
      'letter',
      'cover-letter.pdf',
      'pdf',
    ],
    [['cover-letter.html', 'cover-letter-draft.md'], 'letter', 'cover-letter.html', 'html'],
    [['cover-letter-draft.md', 'cv-x.pdf'], 'letter', 'cover-letter-draft.md', 'md'],
    [
      ['cover-letter-brief-2.md', 'cover-letter-brief-1.md', 'cv-x.pdf'],
      'brief',
      'cover-letter-brief-1.md',
      'md',
    ],
  ];
  for (const [names, key, name, kind] of cases) {
    await withDetail(
      { jobs },
      async reader => {
        const result = await reader.detail('12');
        assert.equal(result.materials.match, 'id');
        assert.equal(result.materials.ambiguous, false);
        const item = result.materials.items.find(entry => entry.key === key);
        assert.ok(item, `${key} listed for ${names}`);
        assert.equal(item.name, name);
        assert.equal(item.kind, kind);
        assert.equal(item.size, `body ${name}`.length);
        assert.match(item.modifiedAt, /^\d{4}-\d\d-\d\dT/);
        assert.deepEqual(Object.keys(item).sort(), ['key', 'kind', 'modifiedAt', 'name', 'size']);
        assert.equal(JSON.stringify(result).includes('fixture-co'), false);
      },
      root => seedMaterials(root, 'data-engineer--12', names),
    );
  }
});

test('materials: legacy match, none, ambiguous and another job id is never used', async () => {
  const jobs = [
    jobRow({ id: '20', company: 'Legacy Co', role: 'Data Engineer' }),
    jobRow({ id: '21', company: 'Nobody Inc', role: 'Whatever' }),
    jobRow({ id: '22', company: 'Dup Co', role: 'Role' }),
    jobRow({ id: '23', company: 'Other Co', role: 'Role' }),
  ];
  await withDetail(
    { jobs },
    async reader => {
      const legacy = await reader.detail('20');
      assert.equal(legacy.materials.match, 'legacy');
      assert.deepEqual(
        legacy.materials.items.map(item => item.key),
        ['cv'],
      );
      const none = await reader.detail('21');
      assert.deepEqual(none.materials, { match: 'none', ambiguous: false, items: [] });
      assert.equal(none.job.materials.cv, false);
      const dup = await reader.detail('22');
      assert.deepEqual(dup.materials, { match: 'id', ambiguous: true, items: [] });
      assert.deepEqual(dup.job.materials, { cv: false, letter: false });
      const other = await reader.detail('23');
      assert.equal(other.materials.match, 'none', 'folder with a different job id is not used');
      await rejects(reader.material('22', 'cv'), 404, 'NOT_FOUND');
    },
    async root => {
      await putFile(root, 'output/legacy-co/data-engineer/cv-legacy.pdf');
      await putFile(root, 'output/dup-co/role--22/cv-a.pdf');
      await putFile(root, 'output/dup-co-two/role--22/cv-b.pdf');
      await putFile(root, 'output/other-co/role--99/cv-c.pdf');
    },
  );
});

test('the list flags on the detail job follow the listed items', async () => {
  await withDetail(
    { jobs: [jobRow({ id: '12' })] },
    async reader => {
      const result = await reader.detail('12');
      assert.deepEqual(result.job.materials, { cv: false, letter: true });
    },
    root => seedMaterials(root, 'role--12', ['cover-letter-brief.md']),
  );
});

test('interview prep: exact, fuzzy, none, and only for Interview status', async () => {
  const jobs = [
    jobRow({ id: '30', status: 'Interview', company: 'Exact Co', role: 'Data Engineer' }),
    jobRow({
      id: '31',
      status: 'Interview',
      company: 'Fuzzy Corp',
      role: 'Machine Learning Engineer',
    }),
    jobRow({ id: '32', status: 'Interview', company: 'Nothing Ltd', role: 'Role' }),
    jobRow({ id: '33', status: 'Applied', company: 'Exact Co', role: 'Data Engineer' }),
    jobRow({ id: '34', status: 'Interview', company: 'Exact Co', role: 'Data Engineer' }),
  ];
  await withDetail(
    { jobs },
    async reader => {
      assert.deepEqual((await reader.detail('30')).interviewPrep, {
        name: 'exact-co-data-engineer.md',
        size: 'exact prep'.length,
      });
      const fuzzy = await reader.detail('31');
      assert.equal(fuzzy.interviewPrep.name, 'fuzzycorp-machine-learning-intel.md');
      assert.equal((await reader.detail('32')).interviewPrep, null);
      assert.equal((await reader.detail('33')).interviewPrep, null);
      const text = await reader.material('30', 'prep');
      assert.equal(text.kind, 'text');
      assert.equal(text.text, 'exact prep');
      await rejects(reader.material('33', 'prep'), 404, 'NOT_FOUND');
      await rejects(reader.material('32', 'prep'), 404, 'NOT_FOUND');
    },
    async root => {
      await putFile(root, 'data/interview-prep/exact-co-data-engineer.md', 'exact prep');
      await putFile(root, 'data/interview-prep/fuzzycorp-machine-learning-intel.md', 'fuzzy prep');
      await putFile(root, 'data/interview-prep/fuzzycorp-other.md', 'weak prep');
      await putFile(root, 'data/interview-prep/story-bank.md', 'shared');
      await putFile(root, 'data/interview-prep/README.md', 'shared');
    },
  );
});

test('material route: text and PDF kinds, bounds and unlisted keys', async () => {
  const jobs = [jobRow({ id: '40' })];
  await withDetail(
    { jobs },
    async (reader, { root }) => {
      const html = await reader.material('40', 'letter');
      assert.deepEqual([html.kind, html.name], ['text', 'cover-letter.html']);
      assert.equal(html.text, '<script>alert(1)</script>');
      const pdf = await reader.material('40', 'cv');
      assert.deepEqual([pdf.kind, pdf.name, pdf.size], ['pdf', 'cv-a.pdf', '%PDF-fixture'.length]);
      const chunks = [];
      for await (const chunk of pdf.stream()) chunks.push(chunk);
      assert.equal(Buffer.concat(chunks).toString(), '%PDF-fixture');
      await rejects(reader.material('40', 'brief'), 404, 'NOT_FOUND');
      await rejects(reader.material('40', 'prep'), 404, 'NOT_FOUND');
      await putFile(
        root,
        'output/fixture-co/role--40/cover-letter.html',
        'a'.repeat(1024 * 1024 + 1),
      );
      await assert.rejects(reader.material('40', 'letter'), error => {
        assert.equal(error.publicCode, 'NOT_FOUND');
        assert.equal(error.message, 'Material unavailable');
        return true;
      });
      await assert.rejects(
        reader.material('40', 'brief'),
        error => error.message !== 'Material unavailable',
      );
    },
    async root => {
      await putFile(root, 'output/fixture-co/role--40/cv-a.pdf', '%PDF-fixture');
      await putFile(
        root,
        'output/fixture-co/role--40/cover-letter.html',
        '<script>alert(1)</script>',
      );
    },
  );
});

test('a material that is a symlink or escapes output is not listed or served', async () => {
  await withDetail(
    { jobs: [jobRow({ id: '50' })] },
    async reader => {
      const result = await reader.detail('50');
      assert.deepEqual(
        result.materials.items.map(item => item.name),
        result.materials.items.length ? ['cv-real.pdf'] : [],
      );
      assert.equal(JSON.stringify(result).includes('outside-secret'), false);
    },
    async root => {
      await putFile(root, 'output/fixture-co/role--50/cv-real.pdf', 'real');
      await putFile(root, 'secret/outside-secret.pdf', 'secret');
      try {
        await symlink(
          join(root, 'secret/outside-secret.pdf'),
          join(root, 'output/fixture-co/role--50/cover-letter.pdf'),
        );
      } catch {
        // Not creatable here; the symlink is then simply absent.
      }
    },
  );
});

test('database failures map to safe public errors and leak no driver text', async () => {
  const run = fail =>
    withDetail({ jobs: [jobRow()], fail }, async reader => {
      await assert.rejects(reader.detail('1'), error => {
        assert.equal(JSON.stringify(error).includes('secret-driver-text'), false);
        throw error;
      });
    });
  await assert.rejects(run(new Error('secret-driver-text')), DatabaseUnavailableError);
  await assert.rejects(
    run(Object.assign(new Error('secret-driver-text'), { code: '42P01' })),
    SchemaNotReadyError,
  );
  await assert.rejects(run(new DatabaseUnavailableError()), DatabaseUnavailableError);
});

test('detail issues only SELECT statements with the id as a bound parameter', async () => {
  await withDetail({ jobs: [jobRow()] }, async (reader, { calls }) => {
    await reader.detail('1');
    assert.equal(calls.length, 5);
    for (const [sql, args] of calls) {
      assert.match(sql, /^\s*SELECT\b/i);
      assert.deepEqual(args, ['1']);
      assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
    }
  });
});

test('factory rejects non-function adapters', () => {
  assert.throws(() => createJobsDetail({ query: 'nope' }), TypeError);
  assert.throws(() => createJobsDetail({ findPrep: null }), TypeError);
});

const activeRow = (id, action) => ({ id, action });
const REPORT = 'data/evaluations/r.md';
const withReport = root => putFile(root, REPORT, '# Report');
const JD_ROW = { content: 'JD', content_hash: 'h', revision: '1', synced_at: new Date() };

test('actions: evaluate and draft prerequisites from status, JD, report and active runs', async () => {
  const cases = [
    [
      'Pending with JD, no report',
      { status: 'Pending' },
      true,
      false,
      [true, false, false, false],
      'Evaluate the job first.',
    ],
    [
      'Pending without JD',
      { status: 'Pending' },
      false,
      false,
      [false, false, false, false],
      'No job description stored.',
    ],
    [
      'Evaluated with JD and report',
      { status: 'Evaluated' },
      true,
      true,
      [true, true, true, true],
      null,
    ],
    [
      'Evaluated without JD',
      { status: 'Evaluated' },
      false,
      true,
      [false, false, false, false],
      'No job description stored.',
    ],
    [
      'Evaluated, report path set but file missing',
      { status: 'Evaluated', report_path: 'data/evaluations/gone.md' },
      true,
      false,
      [true, false, false, false],
      'Evaluate the job first.',
    ],
    [
      'Applied with JD and report',
      { status: 'Applied' },
      true,
      true,
      [false, true, true, true],
      null,
    ],
  ];
  for (const [label, overrides, hasJd, reportFile, enabled, drafting] of cases) {
    await withDetail(
      {
        jobs: [jobRow({ id: '1', report_path: reportFile ? REPORT : null, ...overrides })],
        jd: hasJd ? { 1: JD_ROW } : {},
      },
      async reader => {
        const { actions } = await reader.detail('1');
        assert.deepEqual(
          ['evaluate', 'cv', 'letter', 'both'].map(name => actions[name].enabled),
          enabled,
          label,
        );
        for (const name of ['evaluate', 'cv', 'letter', 'both'])
          assert.equal(actions[name].enabled, actions[name].reason === null, label);
        if (!actions.cv.enabled) assert.equal(actions.cv.reason, drafting, label);
        assert.deepEqual(actions.letter, actions.cv, label);
        const facts = await reader.actionsFor('1');
        assert.deepEqual(facts.actions, actions, 'detail and the dispatch re-check agree');
      },
      reportFile ? withReport : undefined,
    );
  }
});

test('actions: only Pending and Evaluated enable evaluate; the score never matters', async () => {
  const outcomes = new Set();
  for (const status of [
    'Pending',
    'Evaluated',
    'Applied',
    'Interview',
    'Offer',
    'Rejected',
    'Discarded',
    'Ghosted',
  ])
    for (const score of [null, '0', '0.1', '2.5', '4.9', '5.0'])
      await withDetail(
        { jobs: [jobRow({ id: '1', status, score, report_path: REPORT })], jd: { 1: JD_ROW } },
        async reader => {
          const { actions } = await reader.detail('1');
          assert.equal(
            actions.evaluate.enabled,
            status === 'Pending' || status === 'Evaluated',
            status + ' ' + score,
          );
          assert.deepEqual(
            [actions.cv.enabled, actions.letter.enabled, actions.both.enabled],
            [true, true, true],
          );
          outcomes.add(JSON.stringify(actions.cv));
        },
        withReport,
      );
  assert.equal(outcomes.size, 1, 'the same draft rule for every status and score');
});

test('actions: an active run of the same action disables it with a fixed reason; prerequisites win', async () => {
  const run = async (jobOverrides, active, hasJd = true) => {
    let actions;
    await withDetail(
      {
        jobs: [jobRow({ id: '1', report_path: REPORT, ...jobOverrides })],
        jd: hasJd ? { 1: JD_ROW } : {},
        activeRuns: { 1: active.map((action, index) => activeRow(String(index + 1), action)) },
      },
      async reader => {
        actions = (await reader.detail('1')).actions;
      },
      withReport,
    );
    return actions;
  };
  const pending = await run({ status: 'Pending' }, ['evaluate']);
  assert.deepEqual(pending.evaluate, {
    enabled: false,
    reason: 'A evaluate run is already active.',
  });
  const cv = await run({ status: 'Evaluated' }, ['cv']);
  assert.deepEqual(cv.cv, { enabled: false, reason: 'A cv run is already active.' });
  assert.deepEqual(cv.both, { enabled: false, reason: 'A cv run is already active.' });
  assert.equal(cv.letter.enabled, true, 'another action is unaffected');
  const letter = await run({ status: 'Evaluated' }, ['letter']);
  assert.deepEqual(letter.letter, { enabled: false, reason: 'A letter run is already active.' });
  assert.deepEqual(letter.both, { enabled: false, reason: 'A letter run is already active.' });
  assert.equal(letter.cv.enabled, true);
  const both = await run({ status: 'Evaluated' }, ['cv', 'letter']);
  assert.equal(both.both.reason, 'A cv run is already active.');
  const missingJd = await run({ status: 'Pending' }, ['evaluate'], false);
  assert.equal(
    missingJd.evaluate.reason,
    'No job description stored.',
    'a prerequisite beats the active-run reason',
  );
  await withDetail(
    {
      jobs: [jobRow({ id: '1', report_path: REPORT })],
      jd: { 1: JD_ROW },
      activeRuns: { 1: [activeRow('1', 'cv')] },
    },
    async reader => {
      const facts = await reader.actionsFor('1');
      assert.equal(facts.actions.cv.enabled, false);
      assert.equal(facts.base.cv.enabled, true, 'the base block ignores active runs');
    },
    withReport,
  );
});

test('actions: an unavailable browser_runs table or an unknown job never breaks the detail read', async () => {
  await withDetail(
    { jobs: [jobRow({ id: '1', status: 'Pending' })], jd: { 1: JD_ROW }, activeFail: true },
    async reader => {
      const { actions } = await reader.detail('1');
      assert.equal(actions.evaluate.enabled, true);
      await rejects(reader.actionsFor('2'), 404, 'NOT_FOUND');
      await rejects(reader.actionsFor('0'), 400, 'INVALID_REQUEST', 'id');
    },
  );
  const { buildActions } = await import('./jobs-detail.mjs');
  assert.deepEqual(
    buildActions({ status: 'Pending', hasJd: true, reportExists: false }).actions.evaluate,
    {
      enabled: true,
      reason: null,
    },
  );
});

test('actions.publish: needs an editable cover-letter.md; an active publish or letter run blocks it', async () => {
  const scenario = async (files, { active = [], extra = {}, bytes } = {}) => {
    let result;
    await withDetail(
      {
        jobs: [jobRow({ id: '1', report_path: REPORT, ...extra })],
        jd: { 1: JD_ROW },
        activeRuns: { 1: active.map((action, index) => activeRow(String(index + 1), action)) },
      },
      async reader => {
        const { actions } = await reader.detail('1');
        const facts = await reader.actionsFor('1');
        assert.deepEqual(facts.actions, actions, 'detail and the dispatch re-check agree');
        result = { actions, base: facts.base };
      },
      async root => {
        await withReport(root);
        for (const name of files)
          await putFile(
            root,
            `output/fixture-co/data-engineer--1/${name}`,
            bytes && name === 'cover-letter.md' ? 'x'.repeat(bytes) : `body ${name}`,
          );
      },
    );
    return result;
  };
  const noLetter = { enabled: false, reason: 'No cover letter to publish.' };
  assert.deepEqual((await scenario([])).actions.publish, noLetter);
  // Only the exact editable file counts: a draft, a PDF or a brief alone does not.
  for (const name of ['cover-letter-draft.md', 'cover-letter.pdf', 'cover-letter-brief.md'])
    assert.deepEqual((await scenario([name])).actions.publish, noLetter, name);
  const ready = await scenario(['cover-letter.md']);
  assert.deepEqual(ready.actions.publish, { enabled: true, reason: null });
  assert.deepEqual(ready.base.publish, { enabled: true, reason: null });
  assert.deepEqual(
    (await scenario(['cover-letter.md', 'cover-letter.pdf'])).actions.publish,
    { enabled: true, reason: null },
    'republishing over an existing PDF is allowed',
  );
  assert.deepEqual(
    (await scenario(['cover-letter.md'], { bytes: 256 * 1024 + 1 })).actions.publish,
    noLetter,
  );
  assert.equal(
    (await scenario(['cover-letter.md'], { bytes: 256 * 1024 })).actions.publish.enabled,
    true,
  );
  // Publish never depends on the status, the JD or the report, and never on the score.
  const scored = await scenario(['cover-letter.md'], { extra: { status: 'Applied', score: '0' } });
  assert.equal(scored.actions.publish.enabled, true);
  // Active runs: a publish or a letter run blocks it; other actions do not; the base block ignores them.
  const publishing = await scenario(['cover-letter.md'], { active: ['publish'] });
  assert.deepEqual(publishing.actions.publish, {
    enabled: false,
    reason: 'A publish run is already active.',
  });
  assert.deepEqual(publishing.base.publish, { enabled: true, reason: null });
  assert.deepEqual((await scenario(['cover-letter.md'], { active: ['letter'] })).actions.publish, {
    enabled: false,
    reason: 'A letter run is already active.',
  });
  assert.equal(
    (await scenario(['cover-letter.md'], { active: ['cv', 'evaluate'] })).actions.publish.enabled,
    true,
  );
  // A publish run never disables the drafting actions.
  assert.equal(publishing.actions.letter.enabled, true);
  assert.equal(
    (await scenario([], { active: ['publish'] })).actions.publish.reason,
    'No cover letter to publish.',
    'a missing letter beats the active-run reason',
  );
});
