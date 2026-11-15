-- llm_calls.source gains 'estimate' for drafting runs that kept no usage (D093). Estimated rows are
-- always labelled so readers can include or exclude them. 011 is immutable, so the CHECK that
-- 011 created without a name (llm_calls_source_check) is replaced here. No data changes.
ALTER TABLE llm_calls DROP CONSTRAINT llm_calls_source_check;
ALTER TABLE llm_calls ADD CONSTRAINT llm_calls_source_check CHECK (source IN ('live','backfill','estimate'));
