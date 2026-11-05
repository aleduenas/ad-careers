# infra/sql/migrations/007_repair_imported_application_dates.sql

**Authority:** [infra/sql/migrations/007_repair_imported_application_dates.sql](../../../../infra/sql/migrations/007_repair_imported_application_dates.sql).

Corrects the historical application-date backfill introduced by migration 006. Legacy import events all carry the PostgreSQL cutover timestamp, not the date a job entered Applied. For rows whose `applied_at` exactly matches an Applied event written by actor `migration`, this migration recovers an exact `Applied YYYY-MM-DD` date from the preserved legacy notes. If the notes contain no explicit application date, it sets `applied_at` to null rather than using the import date or guessing from `source_date`.

Corrected rows receive a new revision and `updated_at`, so a running dashboard cannot overwrite the repair with stale state. Applied rows with a known recovered date remain eligible for automatic 40-day ghosting; unknown dates display as an em dash and are not auto-ghosted.
