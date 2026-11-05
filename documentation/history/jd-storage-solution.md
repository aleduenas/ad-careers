# Job Description Storage Solution

## Implemented adaptation (2026-09-18)

The proposal below is preserved as design context. The implementation uses the
existing Node/PostgreSQL stack, not a separate Python service:

- `job_descriptions.job_id` references `jobs.id` and is the primary key. Company
  and title come from jobs; they are not a unique posting identity.
- Exact Markdown is stored in `content`, with `file_path`, SHA-256 content hash,
  revision, and sync timestamp. Heterogeneous headers remain untouched.
- Ingestion writes the readable file, then creates the job and stores its JD
  in the same database transaction. An interrupted sync is retryable.
- `node scripts/sync-jds.mjs` audits linked files; add `--apply` to backfill or
  synchronize intentional edits. Unknown/unlinked files are not guessed into jobs.
- Evaluation, CV/letter drafting by ID, and the dashboard JD viewer query the
  database. Database outages never trigger silent file fallback.
- Existing `jds/` files remain private and readable; do not commit personal JDs.

See `database/migrations/003_job_descriptions.sql` and `database/README.md` for
the authoritative schema and operating instructions.

---

## Problem
Currently storing JDs as markdown files in folder hierarchy (`/jd/{company}/{role-title.md}`). Need better integration with postgres role tracking and resume bot script.

## Solution: Hybrid Approach (Files + Postgres)

**Keep the file hierarchy for backup and readability.** Also sync JDs into postgres for database queries and resume bot integration.

### Why This Works
- LLM output goes to markdown files as before (no change to automation)
- Database stores raw markdown content (no parsing or normalization needed)
- Resume bot queries DB instead of filesystem
- One-way sync script runs after automation finishes
- No character limit concerns (postgres TEXT can handle 1GB+)
- Heterogeneous JD headers stay as-is (no formatting burden on LLM)

---

## Database Schema

```sql
CREATE TABLE job_descriptions (
  id SERIAL PRIMARY KEY,
  role_id INT NOT NULL REFERENCES roles(id),
  company VARCHAR(255) NOT NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,  -- Raw markdown, as-is
  file_path VARCHAR(500),  -- /jd/company/role.md
  synced_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(company, title)
);
```

---

## Sync Script

Run this after your web scraper + LLM formatter finishes:

```python
import os
import psycopg2

conn = psycopg2.connect("dbname=yourdb user=youruser password=yourpass")
cur = conn.cursor()

# Walk your /jd folder structure
for company_folder in os.listdir("jd/"):
    for jd_file in os.listdir(f"jd/{company_folder}/"):
        if jd_file.endswith(".md"):
            role_title = jd_file.replace(".md", "")
            file_path = f"jd/{company_folder}/{jd_file}"
            content = open(file_path).read()
            
            # Upsert: insert if new, update if already exists
            cur.execute(
                """INSERT INTO job_descriptions (company, title, content, file_path)
                   VALUES (%s, %s, %s, %s)
                   ON CONFLICT (company, title) DO UPDATE
                   SET content = %s, synced_at = NOW()""",
                (company_folder, role_title, content, file_path, content)
            )

conn.commit()
conn.close()
```

---

## Resume Bot Integration

Instead of reading from filesystem:

```python
# Old way (file I/O)
# jd = open(f"jd/{company}/{role_title}.md").read()

# New way (database query)
cur.execute(
    "SELECT content FROM job_descriptions WHERE id = %s",
    (role_id,)
)
jd = cur.fetchone()[0]

# Pass to Claude
prompt = f"{system_context}\n\nJD:\n{jd}\n\n..."
```

---

## Benefits

✅ Files stay human-readable and version-controllable  
✅ No parsing or normalization needed (markdown stays as-is)  
✅ Resume bot queries DB instead of filesystem I/O  
✅ Enable future queries: "show me all JDs from companies where I've interviewed"  
✅ Full-text search capability if needed later  
✅ Dashboard can read files directly or query DB  
✅ Sync script is one-way, runs once after automation finishes  
✅ No character limit issues  

---

## Migration

1. Create the `job_descriptions` table (see schema above)
2. Run the sync script once to backfill existing JDs
3. Add sync script to your automation pipeline (run after LLM formatter)
4. Update resume bot to query DB instead of reading files
5. Keep `/jd` folder as backup

---

## Notes

- Don't try to normalize heterogeneous JD headers into columns. Store raw markdown.
- `synced_at` tracks when each JD was last imported.
- `UNIQUE(company, title)` prevents duplicate entries.
- Use `ON CONFLICT ... DO UPDATE` for idempotent syncs (safe to run multiple times).
