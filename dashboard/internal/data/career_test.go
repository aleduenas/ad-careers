package data

import (
	"os"
	"path/filepath"
	"testing"

	"career-ops/dashboard/internal/model"
)

func TestJobIDArtifactIsolation(t *testing.T) {
	index := map[string]outputArtifacts{
		"example\x00engineer--101": {cvPath: "first.pdf"},
		"example\x00engineer--102": {cvPath: "second.pdf"},
		"example\x00engineer":      {cvPath: "legacy.pdf"},
	}
	for id, want := range map[int]string{101: "first.pdf", 102: "second.pdf", 103: "legacy.pdf"} {
		got, ok := matchJobOutputArtifacts(index, model.CareerApplication{Number: id, Company: "Example", Role: "Engineer"})
		if !ok || got.cvPath != want {
			t.Fatalf("job %d: %#v, %v", id, got, ok)
		}
	}
	delete(index, "example\x00engineer")
	if _, ok := matchJobOutputArtifacts(index, model.CareerApplication{Number: 103, Company: "Example", Role: "Engineer"}); ok {
		t.Fatal("must not reuse another posting's artifacts")
	}
	index["example\x00renamed-role--101"] = outputArtifacts{cvPath: "ambiguous.pdf"}
	if _, ok := matchJobOutputArtifacts(index, model.CareerApplication{Number: 101, Company: "Example", Role: "Engineer"}); ok {
		t.Fatal("ambiguous job folders must not be guessed")
	}
}

func TestFindInterviewPrepPath(t *testing.T) {
	tempDir := t.TempDir()
	prepDir := filepath.Join(tempDir, "data", "interview-prep")
	if err := os.MkdirAll(prepDir, 0o755); err != nil {
		t.Fatalf("failed to create interview-prep dir: %v", err)
	}

	files := []string{
		"jobber-data-scientist.md",
		"datatonic-senior-mle.md",
		"story-bank.md",
		"README.md",
	}
	for _, f := range files {
		if err := os.WriteFile(filepath.Join(prepDir, f), []byte("prep"), 0o644); err != nil {
			t.Fatalf("failed to write %s: %v", f, err)
		}
	}

	cases := []struct {
		company string
		role    string
		want    string
	}{
		{"Jobber", "Data Scientist", filepath.Join("data", "interview-prep", "jobber-data-scientist.md")},
		{"Datatonic", "Senior MLE", filepath.Join("data", "interview-prep", "datatonic-senior-mle.md")},
		{"Acme", "Data Scientist", ""}, // no matching company
	}
	for _, c := range cases {
		got := findInterviewPrepPath(tempDir, c.company, c.role)
		if got != c.want {
			t.Errorf("findInterviewPrepPath(%q, %q) = %q, want %q", c.company, c.role, got, c.want)
		}
	}
}

func TestEnrichInterviewPrepOnlyForInterviewStatus(t *testing.T) {
	tempDir := t.TempDir()
	prepDir := filepath.Join(tempDir, "data", "interview-prep")
	if err := os.MkdirAll(prepDir, 0o755); err != nil {
		t.Fatalf("failed to create interview-prep dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(prepDir, "jobber-data-scientist.md"), []byte("prep"), 0o644); err != nil {
		t.Fatalf("failed to write prep: %v", err)
	}

	apps := []model.CareerApplication{{Company: "Jobber", Role: "Data Scientist", Status: "Interview"}, {Company: "Jobber", Role: "Data Scientist", Status: "Evaluated"}}
	enrichInterviewPrepPaths(tempDir, apps)
	if len(apps) != 2 {
		t.Fatalf("expected 2 apps, got %d", len(apps))
	}
	if apps[0].PrepPath == "" {
		t.Errorf("expected interview-status app to have a PrepPath, got empty")
	}
	if apps[1].PrepPath != "" {
		t.Errorf("expected evaluated-status app to have no PrepPath, got %q", apps[1].PrepPath)
	}
}

func TestMatchOutputArtifactsRejectsUnrelatedCompany(t *testing.T) {
	index := map[string]outputArtifacts{
		"league\x00security-engineer": {cvPath: filepath.Join("output", "league", "security-engineer", "cv-user.html")},
	}

	if artifacts, ok := matchOutputArtifacts(index, "LCBO", "Security Engineer"); ok {
		t.Fatalf("expected unrelated company to have no artifact match, got %+v", artifacts)
	}
}

func TestMatchOutputArtifactsRejectsAmbiguousRole(t *testing.T) {
	index := map[string]outputArtifacts{
		"acme\x00senior-security-engineer-product": {cvPath: "product.html"},
		"acme\x00senior-security-engineer-growth":  {cvPath: "growth.html"},
	}

	if artifacts, ok := matchOutputArtifacts(index, "Acme", "Senior Security Engineer"); ok {
		t.Fatalf("expected tied fuzzy roles to have no artifact match, got %+v", artifacts)
	}
}

func TestMatchOutputArtifactsRejectsDifferentLeagueRole(t *testing.T) {
	index := map[string]outputArtifacts{
		"league\x00security-engineer": {cvPath: "current-security-engineer.html"},
	}

	if artifacts, ok := matchOutputArtifacts(index, "League Inc.", "Senior Software Security Engineer"); ok {
		t.Fatalf("expected a different League role to have no CV match, got %+v", artifacts)
	}
}

func TestEnrichOutputArtifactsFindsExactRoleFiles(t *testing.T) {
	tempDir := t.TempDir()
	roleDir := filepath.Join(tempDir, "output", "lcbo", "senior-manager-cybersecurity-operations")
	if err := os.MkdirAll(roleDir, 0o755); err != nil {
		t.Fatalf("failed to create output directory: %v", err)
	}
	for _, name := range []string{"cv-user.html", "cover-letter.html", "cover-letter-brief.md"} {
		if err := os.WriteFile(filepath.Join(roleDir, name), []byte(name), 0o644); err != nil {
			t.Fatalf("failed to create %s: %v", name, err)
		}
	}

	apps := []model.CareerApplication{{Company: "LCBO", Role: "Senior Manager, Cybersecurity Operations"}}
	enrichOutputArtifacts(tempDir, apps)

	wants := map[string]string{
		"CV":     filepath.Join("output", "lcbo", "senior-manager-cybersecurity-operations", "cv-user.html"),
		"letter": filepath.Join("output", "lcbo", "senior-manager-cybersecurity-operations", "cover-letter.html"),
		"brief":  filepath.Join("output", "lcbo", "senior-manager-cybersecurity-operations", "cover-letter-brief.md"),
	}
	if apps[0].CVPath != wants["CV"] {
		t.Errorf("CVPath = %q, want %q", apps[0].CVPath, wants["CV"])
	}
	if apps[0].LetterPath != wants["letter"] {
		t.Errorf("LetterPath = %q, want %q", apps[0].LetterPath, wants["letter"])
	}
	if apps[0].BriefPath != wants["brief"] {
		t.Errorf("BriefPath = %q, want %q", apps[0].BriefPath, wants["brief"])
	}
}
