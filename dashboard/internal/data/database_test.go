package data

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPostgresDashboardLifecycle(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL required; personal database is never used")
	}
	u, err := url.Parse(dsn)
	if err != nil || !strings.HasPrefix(u.Path, "/career_ops_test_") {
		t.Fatal("Refusing non-test database")
	}
	admin, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("dashboard_test_%d", time.Now().UnixNano())
	if _, err = admin.Exec("CREATE SCHEMA " + schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec("DROP SCHEMA " + schema + " CASCADE")
	params := u.Query()
	params.Set("search_path", schema)
	u.RawQuery = params.Encode()
	t.Setenv("DATABASE_URL", u.String())
	db, err := openDatabase(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	files, err := filepath.Glob("../../../infra/sql/migrations/*.sql")
	if err != nil || len(files) == 0 {
		t.Fatal("Migration files missing", err)
	}
	for _, file := range files {
		body, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec(string(body)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = db.Exec("SELECT create_job('Acme','Engineer','https://example.test/1','example.test/1',NULL)"); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	if _, err = db.Exec("SELECT sync_job_description(1,'# JD from PostgreSQL','jds/missing-on-disk.md','test')"); err != nil {
		t.Fatal(err)
	}
	content, err := LoadJobDescription(root, 1)
	if err != nil || content != "# JD from PostgreSQL" {
		t.Fatalf("database JD: %q %v", content, err)
	}
	apps, err := LoadApplications(root)
	if err != nil || len(apps) != 1 {
		t.Fatalf("load: %v %+v", err, apps)
	}
	if !apps[0].IsPending || apps[0].ScoreRaw != "" {
		t.Fatal("Pending state or nullable score lost")
	}
	stale := apps[0]
	if err = UpdateApplicationStatus(root, apps[0], "Applied"); err != nil {
		t.Fatal(err)
	}
	if err = UpdateApplicationStatus(root, stale, "Ghosted"); err == nil {
		t.Fatal("Stale update succeeded")
	}
	apps, err = LoadApplications(root)
	if err != nil || apps[0].Status != "Applied" {
		t.Fatal("Applied transition lost", err)
	}
	if apps[0].StatusDate == "" {
		t.Fatal("Applied status date was not exposed")
	}
	if _, err = db.Exec("UPDATE job_status_events SET occurred_at='2026-09-21T01:00:00Z' WHERE job_id=1 AND new_status='Applied'"); err != nil {
		t.Fatal(err)
	}
	apps, err = LoadApplications(root)
	if err != nil || apps[0].StatusDate != "2026-09-20" {
		t.Fatalf("status date was not converted to Toronto time: %+v %v", apps[0], err)
	}
	if _, err = db.Exec("UPDATE jobs SET applied_at=now()-interval '41 days' WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	apps, err = LoadApplications(root)
	if err != nil || apps[0].Status != "Ghosted" {
		t.Fatal("Stale applied job was not ghosted", err)
	}
	if apps[0].StatusDate == "" {
		t.Fatal("Ghosted status date was not exposed")
	}
	if err = DiscardApplication(root, apps[0], "User decision"); err != nil {
		t.Fatal(err)
	}
	apps, err = LoadApplications(root)
	if err != nil || apps[0].Status != "Discarded" || apps[0].DiscardReason != "User decision" || !strings.Contains(apps[0].Notes, "User decision") {
		t.Fatal("Discard reason lost", err)
	}
	if apps[0].StatusDate == "" {
		t.Fatal("Discarded status date was not exposed")
	}
	var count int
	if err = db.QueryRowContext(context.Background(), "SELECT count(*) FROM job_status_events").Scan(&count); err != nil || count != 3 {
		t.Fatal("Status history mismatch", err, count)
	}
	t.Setenv("DATABASE_URL", "postgres://invalid:invalid@127.0.0.1:1/career_ops_test_unavailable?connect_timeout=1")
	if _, err = LoadApplications(root); err == nil {
		t.Fatal("Database outage returned an empty success")
	}
}
