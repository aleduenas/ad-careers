**Authority:** `infra/sql/migrations/009_salary_band.sql`.

Adds nullable `salary_min` and `salary_max` numeric columns to `jobs`, with a check that
the band is non-negative and ordered. The dashboard edits both values together through its
revision-checked update path, and once set they override the evaluation report's compensation
figure everywhere the dashboard displays it (job list row and detail preview).
