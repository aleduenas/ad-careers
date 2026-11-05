package data

import (
	"career-ops/dashboard/internal/model"
	"context"
	"crypto/sha256"
	"database/sql"
	"fmt"
	_ "github.com/jackc/pgx/v5/stdlib"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
)

func openDatabase(root string) (*sql.DB, error) {
	values := map[string]string{}
	if content, err := os.ReadFile(filepath.Join(root, ".env")); err == nil {
		for _, line := range strings.Split(string(content), "\n") {
			key, value, ok := strings.Cut(strings.TrimSpace(line), "=")
			if ok {
				values[key] = value
			}
		}
	}
	get := func(key string) string {
		if value, ok := os.LookupEnv(key); ok {
			return value
		}
		return values[key]
	}
	dsn := get("DATABASE_URL")
	if dsn == "" {
		password := get("POSTGRES_PASSWORD")
		if password == "" {
			return nil, fmt.Errorf("set POSTGRES_PASSWORD in the repository .env")
		}
		port := get("POSTGRES_PORT")
		if port == "" {
			port = "54329"
		}
		u := url.URL{Scheme: "postgres", User: url.UserPassword("career_ops", password), Host: "127.0.0.1:" + port, Path: "career_ops", RawQuery: "sslmode=disable&connect_timeout=5"}
		dsn = u.String()
	}
	return sql.Open("pgx", dsn)
}

var (
	urlKeySchemeRe = regexp.MustCompile(`(?i)^https?://(www\.)?`)
	urlKeyTrailRe  = regexp.MustCompile(`[)\].,;]+$`)
	urlKeySlashRe  = regexp.MustCompile(`/+$`)
)

// urlKey mirrors src/lib/_database.mjs's urlKey() so the dashboard's
// pre-submit check agrees with what add-pasted-jd.mjs and scan.mjs use for
// dedup, including the jobs.url_key column populated at insert time.
func urlKey(raw string) string {
	s := urlKeySchemeRe.ReplaceAllString(raw, "")
	s = urlKeyTrailRe.ReplaceAllString(s, "")
	s = urlKeySlashRe.ReplaceAllString(s, "")
	return strings.ToLower(s)
}

// URLTrackStatus reports what, if anything, PostgreSQL already knows about a
// job posting URL before a pasted JD is saved under it.
type URLTrackStatus struct {
	// TrackedAsJob means the URL already belongs to a row in jobs — adding it
	// again would collide with jobs.url_key's unique constraint and silently
	// resync the existing job's JD, so this case is never offered a bypass.
	TrackedAsJob bool
	JobNumber    int
	JobCompany   string
	JobRole      string
	JobStatus    string
	// SeenInScan means the URL only appears in scan_history — a scan noticed
	// it (and possibly skipped it, e.g. on location) but never created a job.
	// This is not a real duplicate, so the caller may confirm and continue.
	SeenInScan    bool
	ScanCompany   string
	ScanTitle     string
	ScanStatus    string
	ScanFirstSeen string
}

// CheckURLTracked answers, before a pasted JD is saved, whether the URL is
// already a job in the pipeline or was merely noticed by a past scan.
func CheckURLTracked(root, rawURL string) (URLTrackStatus, error) {
	var result URLTrackStatus
	db, err := openDatabase(root)
	if err != nil {
		return result, err
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	key := urlKey(rawURL)
	err = db.QueryRowContext(ctx, "SELECT id, company, role, status FROM jobs WHERE url_key=$1", key).
		Scan(&result.JobNumber, &result.JobCompany, &result.JobRole, &result.JobStatus)
	if err == nil {
		result.TrackedAsJob = true
		return result, nil
	}
	if err != sql.ErrNoRows {
		return result, err
	}

	var firstSeen sql.NullString
	err = db.QueryRowContext(ctx, `
		SELECT company, title, status, first_seen::text
		FROM scan_history
		WHERE lower(regexp_replace(regexp_replace(regexp_replace(url, '^https?://(www\.)?', '', 'i'), '[)\].,;]+$', ''), '/+$', ''))=$1
		ORDER BY first_seen DESC NULLS LAST
		LIMIT 1`, key).Scan(&result.ScanCompany, &result.ScanTitle, &result.ScanStatus, &firstSeen)
	if err == nil {
		result.SeenInScan = true
		if firstSeen.Valid {
			result.ScanFirstSeen = firstSeen.String
		}
		return result, nil
	}
	if err != sql.ErrNoRows {
		return result, err
	}
	return result, nil
}

func LoadJobDescription(root string, id int) (string, error) {
	db, err := openDatabase(root)
	if err != nil {
		return "", err
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var content string
	err = db.QueryRowContext(ctx, "SELECT content FROM job_descriptions WHERE job_id=$1", id).Scan(&content)
	return content, err
}

func LoadApplications(root string) ([]model.CareerApplication, error) {
	db, err := openDatabase(root)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err = db.ExecContext(ctx, "SELECT ghost_stale_applications()"); err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `
		SELECT job.id,job.revision,coalesce(job.source_date::text,discovery.first_seen::text,''),
			coalesce((status_event.occurred_at AT TIME ZONE 'America/Toronto')::date::text,''),
			job.company,job.role,job.status,job.score,coalesce(job.report_path,''),job.notes,
			coalesce(job.url,''),coalesce(job.jd_path,''),coalesce(discard_event.reason,''),job.salary_min,job.salary_max
		FROM jobs AS job
		LEFT JOIN LATERAL (
			SELECT min(history.first_seen) AS first_seen
			FROM scan_history AS history
			WHERE history.url=job.url
		) AS discovery ON true
		LEFT JOIN LATERAL (
			SELECT event.occurred_at
			FROM job_status_events AS event
			WHERE event.job_id=job.id AND event.new_status=job.status AND event.occurred_at IS NOT NULL
			ORDER BY event.id DESC
			LIMIT 1
		) AS status_event ON true
		LEFT JOIN LATERAL (
			SELECT event.reason
			FROM job_status_events AS event
			WHERE event.job_id=job.id AND event.new_status='Discarded'
			ORDER BY event.id DESC
			LIMIT 1
		) AS discard_event ON true
		ORDER BY job.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	apps := []model.CareerApplication{}
	for rows.Next() {
		var app model.CareerApplication
		var score, salaryMin, salaryMax sql.NullFloat64
		if err = rows.Scan(&app.Number, &app.Revision, &app.Date, &app.StatusDate, &app.Company, &app.Role, &app.Status, &score, &app.ReportPath, &app.Notes, &app.JobURL, &app.JDPath, &app.DiscardReason, &salaryMin, &salaryMax); err != nil {
			return nil, err
		}
		app.ReportNumber = strconv.Itoa(app.Number)
		app.IsPending = app.Status == "Pending"
		if score.Valid {
			app.Score = score.Float64
			app.ScoreRaw = fmt.Sprintf("%.1f/5", score.Float64)
		}
		if salaryMin.Valid {
			app.SalaryMin = &salaryMin.Float64
		}
		if salaryMax.Valid {
			app.SalaryMax = &salaryMax.Float64
		}
		apps = append(apps, app)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	enrichOutputArtifacts(root, apps)
	enrichInterviewPrepPaths(root, apps)
	return apps, nil
}

func changeStatus(root string, app model.CareerApplication, status, reason string) error {
	db, err := openDatabase(root)
	if err != nil {
		return err
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err = db.ExecContext(ctx, "SELECT change_job_status($1,$2,$3,$4,$5)", app.Number, app.Revision, status, reason, "dashboard")
	return err
}
func UpdateApplicationStatus(root string, app model.CareerApplication, status string) error {
	return changeStatus(root, app, status, "")
}
func DiscardApplication(root string, app model.CareerApplication, reason string) error {
	return changeStatus(root, app, "Discarded", reason)
}

// UpdateJobField updates one editable job field. The stale-edit guard compares
// the edited column with the value the dashboard loaded, not the whole-row
// revision: background work (evaluation, drafting, ghosting) bumps the revision
// constantly, and a status change must not reject an unrelated metadata edit.
// The revision is still bumped so other revision-guarded writers see the change.
// JD content is synchronized separately after editor exit.
func UpdateJobField(root string, app model.CareerApplication, field, value string) error {
	db, err := openDatabase(root)
	if err != nil {
		return err
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	// Control characters (notably NUL, which PostgreSQL rejects in text) are
	// never meaningful in these single-line fields.
	value = strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, value))
	if value == "" {
		return fmt.Errorf("%s must not be empty", field)
	}
	var query string
	var args []any
	switch field {
	case "url":
		query = "UPDATE jobs SET url=$1,revision=revision+1,updated_at=now() WHERE id=$2 AND coalesce(url,'')=$3"
		args = []any{value, app.Number, app.JobURL}
	case "role":
		query = "UPDATE jobs SET role=$1,revision=revision+1,updated_at=now() WHERE id=$2 AND role=$3"
		args = []any{value, app.Number, app.Role}
	case "company":
		query = "UPDATE jobs SET company=$1,revision=revision+1,updated_at=now() WHERE id=$2 AND company=$3"
		args = []any{value, app.Number, app.Company}
	case "salary_band":
		parts := strings.Split(value, "|")
		if len(parts) != 2 {
			return fmt.Errorf("salary requires minimum and maximum")
		}
		min, err := strconv.ParseFloat(parts[0], 64)
		if err != nil || min < 0 {
			return fmt.Errorf("salary minimum must be a non-negative number")
		}
		max, err := strconv.ParseFloat(parts[1], 64)
		if err != nil || max < min {
			return fmt.Errorf("salary maximum must be at least the minimum")
		}
		query = "UPDATE jobs SET salary_min=$1,salary_max=$2,revision=revision+1,updated_at=now() WHERE id=$3 AND salary_min IS NOT DISTINCT FROM $4 AND salary_max IS NOT DISTINCT FROM $5"
		args = []any{min, max, app.Number, app.SalaryMin, app.SalaryMax}
	default:
		return fmt.Errorf("unsupported editable field %q", field)
	}
	result, err := db.ExecContext(ctx, query, args...)
	if err != nil {
		return err
	}
	// Zero rows means the field changed elsewhere since it was loaded; reporting
	// it is the difference between a rejected edit and one that silently does nothing.
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return fmt.Errorf("#%d %s was changed elsewhere since it was loaded; edit again", app.Number, field)
	}
	return nil
}

// SyncEditedJD reads the edited JD file and stores its exact content in the
// database, preserving the linked path and content hash.
func SyncEditedJD(root string, app model.CareerApplication) error {
	content, err := os.ReadFile(filepath.Join(root, app.JDPath))
	if err != nil {
		return err
	}
	hash := fmt.Sprintf("%x", sha256.Sum256(content))
	db, err := openDatabase(root)
	if err != nil {
		return err
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err = db.ExecContext(ctx, "SELECT sync_job_description($1,$2,$3,$4)", app.Number, string(content), app.JDPath, hash)
	return err
}
