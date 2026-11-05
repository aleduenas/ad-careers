-- 2026-09-19 repository layout change (documentation/guides/layout.md):
-- jds/ moved to data/jds/ and reports/ moved to data/evaluations/.
-- Stored paths are relative to the repository root, so rewrite the prefixes.
UPDATE jobs SET report_path = 'data/evaluations/' || substr(report_path, 9) WHERE report_path LIKE 'reports/%';
UPDATE evaluations SET report_path = 'data/evaluations/' || substr(report_path, 9) WHERE report_path LIKE 'reports/%';
UPDATE jobs SET jd_path = 'data/jds/' || substr(jd_path, 5) WHERE jd_path LIKE 'jds/%';
UPDATE job_descriptions SET file_path = 'data/jds/' || substr(file_path, 5) WHERE file_path LIKE 'jds/%';
