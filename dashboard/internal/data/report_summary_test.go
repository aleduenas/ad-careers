package data

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadReportSummaryCurrentAndHistoricalFormats(t *testing.T) {
	root := t.TempDir()
	current := "**Company:** Bell\n**Compensation band:** CAD $100,000-$120,000 base\n\n## A) Role Summary\n\n| Finding | Details |\n| --- | --- |\n| archetype | Security Engineer (network ops) |\n| location | Hybrid 3 days/week; Toronto |\n| summary | Mid-level network security operations analyst. |\n"
	historical := "| **Arquetipo detectado** | Data Engineer |\n| **TL;DR** | Strong pipeline match |\n| **Remote** | Remote (Canada) |\n| **Comp** | CAD 130k |\n"
	for name, body := range map[string]string{"current.md": current, "historical.md": historical} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	a, s, r, c := LoadReportSummary(root, "current.md")
	if a != "Security Engineer (network ops)" || s != "Mid-level network security operations analyst." || r != "Hybrid 3 days/week; Toronto" || c != "CAD $100,000-$120,000 base" {
		t.Fatalf("current format parsed wrong: %q %q %q %q", a, s, r, c)
	}
	a, s, r, c = LoadReportSummary(root, "historical.md")
	if a != "Data Engineer" || s != "Strong pipeline match" || r != "Remote (Canada)" || c != "CAD 130k" {
		t.Fatalf("historical format parsed wrong: %q %q %q %q", a, s, r, c)
	}
}

func TestLoadReportSummaryBlanksPlaceholderComp(t *testing.T) {
	root := t.TempDir()
	for name, band := range map[string]string{"bare.md": "UNKNOWN", "explained.md": "UNKNOWN — the JD contains no salary figures.", "assessed.md": "Not assessed"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("**Compensation band:** "+band+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		if _, _, _, c := LoadReportSummary(root, name); c != "" {
			t.Fatalf("%s: expected placeholder comp %q to be blanked, got %q", name, band, c)
		}
	}
}
