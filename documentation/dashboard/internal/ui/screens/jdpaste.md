# dashboard/internal/ui/screens/jdpaste.go

**Authority:** [dashboard/internal/ui/screens/jdpaste.go](../../../../../dashboard/internal/ui/screens/jdpaste.go).

Implements the four-step pasted-JD form.

## Inputs

Collects posting URL, company, role and verbatim description. Company suggestions derive from existing pipeline entries; input is part of `PipelineModel`.

## Outputs and behavior

Pressing Enter on the URL step emits `PipelineCheckURLMsg` instead of advancing directly; the root command queries PostgreSQL (`data.CheckURLTracked`) and replies with `PipelineURLCheckedMsg`, which `handleURLChecked` applies:

- Not seen anywhere: advances to the company step with a "verified unique" status.
- Already a row in `jobs` (matched on `url_key`): stops on a `blocked` stage naming the existing job number, company, role and status. This is never bypassable — resubmitting would only resync that job's JD (see `createJob` in `src/lib/_database.mjs`).
- Only seen in `scan_history` (a past scan noticed or skipped it, but never created a job): stops on a `confirm` stage asking "Continue adding it anyway? (y/n)". Answering `y`/Enter sets `jdForceDuplicate` and continues to the company step; the eventual `PipelineSubmitJDMsg.Force` carries that choice through to `add-pasted-jd.mjs`, whose own `scan_history`-based dedup check is a fallback only.

Emits `PipelineSubmitJDMsg` on submission; the root workflow runner invokes the Node intake command. Escape/cancel clears form state. This screen does not allocate IDs or write JDs itself.

## Dependencies and callers

Imports Bubble Tea, Lip Gloss and Go URL/string/sort helpers. Called by `pipeline.go`; `pipeline_test.go` covers modifier input and refresh preservation.

