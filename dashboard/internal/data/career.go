package data

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"career-ops/dashboard/internal/model"
)

var (
	reJobOutputID = regexp.MustCompile(`--[0-9]+$`)
	// Current report format (src/eval/_evaluation-cli.mjs render): Role Summary table rows
	// and a compensation band line in the header.
	reCurArchetype = regexp.MustCompile(`(?im)^\|\s*archetype\s*\|\s*(.+?)\s*\|\s*$`)
	reCurSummary   = regexp.MustCompile(`(?im)^\|\s*summary\s*\|\s*(.+?)\s*\|\s*$`)
	reCurLocation  = regexp.MustCompile(`(?im)^\|\s*location\s*\|\s*(.+?)\s*\|\s*$`)
	reCurComp      = regexp.MustCompile(`(?im)^\*\*Compensation band:\*\*\s*(.+)$`)
	// Historical (agent-era, Spanish-labelled) report format; kept so old reports still summarize.
	reArchetype      = regexp.MustCompile(`(?i)\*\*Arquetipo(?:\s+detectado)?\*\*\s*\|\s*(.+)`)
	reTlDr           = regexp.MustCompile(`(?i)\*\*TL;DR\*\*\s*\|\s*(.+)`)
	reTlDrColon      = regexp.MustCompile(`(?i)\*\*TL;DR:\*\*\s*(.+)`)
	reRemote         = regexp.MustCompile(`(?i)\*\*Remote\*\*\s*\|\s*(.+)`)
	reComp           = regexp.MustCompile(`(?i)\*\*Comp\*\*\s*\|\s*(.+)`)
	reArchetypeColon = regexp.MustCompile(`(?i)\*\*Arquetipo:\*\*\s*(.+)`)
)

// enrichInterviewPrepPaths fills PrepPath for apps currently in the interview
// stage when a matching data/interview-prep/{company}-{role}.md file exists.
func enrichInterviewPrepPaths(careerOpsPath string, apps []model.CareerApplication) {
	for i := range apps {
		if NormalizeStatus(apps[i].Status) != "interview" {
			continue
		}
		apps[i].PrepPath = findInterviewPrepPath(careerOpsPath, apps[i].Company, apps[i].Role)
	}
}

// findInterviewPrepPath returns the relative path to a matching interview-prep
// markdown file (data/interview-prep/{company-slug}-{role-slug}.md), or "". It tries
// an exact slug match first, then falls back to a fuzzy match that requires the
// company slug to appear in the filename and scores on role-word overlap.
func findInterviewPrepPath(careerOpsPath, company, role string) string {
	prepDir := filepath.Join(careerOpsPath, "data", "interview-prep")
	compSlug := cvSlug(company)
	roleSlug := cvSlug(role)
	if compSlug == "" {
		return ""
	}

	// Exact match: {company}-{role}.md
	direct := filepath.Join(prepDir, compSlug+"-"+roleSlug+".md")
	if _, err := os.Stat(direct); err == nil {
		rel, _ := filepath.Rel(careerOpsPath, direct)
		return rel
	}

	entries, err := os.ReadDir(prepDir)
	if err != nil {
		return ""
	}

	compNoHyphen := strings.ReplaceAll(compSlug, "-", "")
	roleWords := strings.Split(roleSlug, "-")
	bestFile := ""
	bestScore := 0
	for _, e := range entries {
		name := strings.ToLower(e.Name())
		if e.IsDir() || !strings.HasSuffix(name, ".md") {
			continue
		}
		// Skip shared files that aren't company-specific intel reports.
		if name == "story-bank.md" || name == "readme.md" {
			continue
		}
		nameSlug := cvSlug(strings.TrimSuffix(name, ".md"))
		nameNoHyphen := strings.ReplaceAll(nameSlug, "-", "")
		// Require the company to appear in the filename to avoid false positives.
		if !strings.Contains(nameNoHyphen, compNoHyphen) {
			continue
		}
		score := 1 // company matched
		for _, w := range roleWords {
			if len(w) > 2 && strings.Contains(nameSlug, w) {
				score++
			}
		}
		if score > bestScore {
			bestScore = score
			bestFile = e.Name()
		}
	}
	if bestFile == "" {
		return ""
	}
	full := filepath.Join(prepDir, bestFile)
	rel, _ := filepath.Rel(careerOpsPath, full)
	return rel
}

func normalizeCompany(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	for _, suffix := range []string{" inc.", " inc", " llc", " ltd", " corp", " corporation", " technologies", " technology", " group", " co."} {
		s = strings.TrimSuffix(s, suffix)
	}
	return strings.TrimSpace(s)
}

// enrichOutputArtifacts scans output/ once and populates the generated files
// for every confidently matched application.
type outputArtifacts struct {
	cvPath     string
	letterPath string
	briefPath  string
}

func enrichOutputArtifacts(careerOpsPath string, apps []model.CareerApplication) {
	index := buildOutputArtifactIndex(careerOpsPath)
	if len(index) == 0 {
		return
	}
	for i := range apps {
		artifacts, ok := matchJobOutputArtifacts(index, apps[i])
		if !ok {
			continue
		}
		apps[i].CVPath = artifacts.cvPath
		apps[i].LetterPath = artifacts.letterPath
		apps[i].BriefPath = artifacts.briefPath
	}
}

// New output folders end in the permanent job ID. Never offer another job's
// ID-specific artifacts through the historical company/title fallback.
func matchJobOutputArtifacts(index map[string]outputArtifacts, app model.CareerApplication) (outputArtifacts, bool) {
	legacy := make(map[string]outputArtifacts)
	var matched outputArtifacts
	matches := 0
	suffix := "--" + fmt.Sprint(app.Number)
	for key, artifacts := range index {
		parts := strings.SplitN(key, "\x00", 2)
		if len(parts) != 2 {
			continue
		}
		if reJobOutputID.MatchString(parts[1]) {
			if strings.HasSuffix(parts[1], suffix) {
				matched = artifacts
				matches++
			}
			continue
		}
		legacy[key] = artifacts
	}
	if matches == 1 {
		return matched, true
	}
	if matches > 1 {
		return outputArtifacts{}, false
	}
	return matchOutputArtifacts(legacy, app.Company, app.Role)
}

// buildOutputArtifactIndex scans output/ and indexes each company/role folder.
func buildOutputArtifactIndex(careerOpsPath string) map[string]outputArtifacts {
	outputDir := filepath.Join(careerOpsPath, "output")
	index := make(map[string]outputArtifacts)

	compDirs, err := os.ReadDir(outputDir)
	if err != nil {
		return index
	}

	for _, cd := range compDirs {
		if !cd.IsDir() {
			continue
		}
		compPath := filepath.Join(outputDir, cd.Name())
		roleDirs, err := os.ReadDir(compPath)
		if err != nil {
			continue
		}
		for _, rd := range roleDirs {
			if !rd.IsDir() {
				continue
			}
			rolePath := filepath.Join(compPath, rd.Name())
			artifacts := outputArtifacts{
				cvPath:     relativeArtifactPath(careerOpsPath, findCVFile(rolePath)),
				letterPath: relativeArtifactPath(careerOpsPath, findCoverLetterFile(rolePath)),
				briefPath:  relativeArtifactPath(careerOpsPath, findCoverLetterBrief(rolePath)),
			}
			if artifacts.cvPath == "" && artifacts.letterPath == "" && artifacts.briefPath == "" {
				continue
			}
			key := cd.Name() + "\x00" + rd.Name()
			index[key] = artifacts
		}
	}
	return index
}

func relativeArtifactPath(careerOpsPath, path string) string {
	if path == "" {
		return ""
	}
	rel, err := filepath.Rel(careerOpsPath, path)
	if err != nil {
		return ""
	}
	return rel
}

// findCVFile returns the preferred cv-* browser document inside dir, or "".
func findCVFile(dir string) string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	for _, ext := range []string{".pdf", ".html"} {
		for _, e := range entries {
			name := strings.ToLower(e.Name())
			if !e.IsDir() && strings.HasPrefix(name, "cv-") && strings.HasSuffix(name, ext) {
				return filepath.Join(dir, e.Name())
			}
		}
	}
	return ""
}

func findCoverLetterFile(dir string) string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	for _, preferred := range []string{"cover-letter.md", "cover-letter.pdf", "cover-letter.html", "cover-letter-draft.md"} {
		for _, e := range entries {
			if !e.IsDir() && strings.EqualFold(e.Name(), preferred) {
				return filepath.Join(dir, e.Name())
			}
		}
	}
	return ""
}

func findCoverLetterBrief(dir string) string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	for _, e := range entries {
		name := strings.ToLower(e.Name())
		if !e.IsDir() && strings.HasPrefix(name, "cover-letter-brief") && strings.HasSuffix(name, ".md") {
			return filepath.Join(dir, e.Name())
		}
	}
	return ""
}

// matchOutputArtifacts finds one deterministic, high-confidence artifact
// directory for a company+role pair. It deliberately rejects zero-score
// company matches and tied fuzzy role matches: showing no shortcut is safer
// than opening another application's documents.
func matchOutputArtifacts(index map[string]outputArtifacts, company, role string) (outputArtifacts, bool) {
	compNorm := cvSlug(normalizeCompany(company))
	roleNorm := cvSlug(role)
	if compNorm == "" || roleNorm == "" {
		return outputArtifacts{}, false
	}

	compCandidates := make(map[string]struct{})
	for key := range index {
		parts := strings.SplitN(key, "\x00", 2)
		if len(parts) == 2 {
			compCandidates[parts[0]] = struct{}{}
		}
	}
	sortedCompanies := make([]string, 0, len(compCandidates))
	for candidate := range compCandidates {
		sortedCompanies = append(sortedCompanies, candidate)
	}
	sort.Strings(sortedCompanies)

	bestComp := ""
	bestCompScore := 0
	compNormNoHyphen := strings.ReplaceAll(compNorm, "-", "")
	for _, candidate := range sortedCompanies {
		candidateNoHyphen := strings.ReplaceAll(cvSlug(candidate), "-", "")
		if candidateNoHyphen == compNormNoHyphen {
			bestComp = candidate
			bestCompScore = len(candidateNoHyphen) + 1000
			break
		}
		score := 0
		if candidateNoHyphen != "" && (strings.Contains(compNormNoHyphen, candidateNoHyphen) || strings.Contains(candidateNoHyphen, compNormNoHyphen)) {
			score = len(candidateNoHyphen)
		}
		if score > bestCompScore {
			bestCompScore = score
			bestComp = candidate
		}
	}
	if bestComp == "" || bestCompScore == 0 {
		return outputArtifacts{}, false
	}

	// Exact role directory names are authoritative.
	exactKey := bestComp + "\x00" + roleNorm
	if artifacts, ok := index[exactKey]; ok {
		return artifacts, true
	}

	// Fuzzy fallback handles harmless title additions such as "remote-canada".
	// Strong ties are rejected instead of selecting whichever map entry happened
	// to be visited first.
	keys := make([]string, 0, len(index))
	for key := range index {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	bestKey := ""
	bestScore := 0.0
	tied := false
	for _, key := range keys {
		parts := strings.SplitN(key, "\x00", 2)
		if len(parts) != 2 || parts[0] != bestComp {
			continue
		}
		score := titleSimilarity(roleNorm, cvSlug(parts[1]))
		if score > bestScore {
			bestScore = score
			bestKey = key
			tied = false
		} else if score == bestScore && score > 0 {
			tied = true
		}
	}
	if bestKey == "" || bestScore < 0.75 || tied {
		return outputArtifacts{}, false
	}
	return index[bestKey], true
}

func titleSimilarity(a, b string) float64 {
	aTokens := uniqueTitleTokens(a)
	bTokens := uniqueTitleTokens(b)
	if len(aTokens) == 0 || len(bTokens) == 0 {
		return 0
	}
	overlap := 0
	for token := range aTokens {
		if _, ok := bTokens[token]; ok {
			overlap++
		}
	}
	union := len(aTokens) + len(bTokens) - overlap
	return float64(overlap) / float64(union)
}

func uniqueTitleTokens(slug string) map[string]struct{} {
	tokens := make(map[string]struct{})
	qualifiers := map[string]struct{}{
		"canada": {}, "canadian": {}, "full": {}, "hybrid": {}, "remote": {}, "time": {},
	}
	for _, token := range strings.Split(slug, "-") {
		if token == "" {
			continue
		}
		if _, ignored := qualifiers[token]; !ignored {
			tokens[token] = struct{}{}
		}
	}
	return tokens
}

// cvSlug converts a string to a lowercase hyphen-separated slug.
func cvSlug(s string) string {
	s = strings.ToLower(s)
	var b strings.Builder
	prevHyphen := true // skip leading hyphens
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			prevHyphen = false
		} else if !prevHyphen {
			b.WriteRune('-')
			prevHyphen = true
		}
	}
	return strings.TrimRight(b.String(), "-")
}

// ComputeMetrics calculates aggregate metrics from applications.
func ComputeMetrics(apps []model.CareerApplication) model.PipelineMetrics {
	m := model.PipelineMetrics{
		ByStatus: make(map[string]int),
	}

	var totalScore float64
	var scored int

	for _, app := range apps {
		if app.IsPending {
			continue
		}
		m.Total++
		status := NormalizeStatus(app.Status)
		m.ByStatus[status]++

		if app.Score > 0 {
			totalScore += app.Score
			scored++
			if app.Score > m.TopScore {
				m.TopScore = app.Score
			}
		}
		if status != "ghosted" && status != "rejected" && status != "discarded" {
			m.Actionable++
		}
	}

	if scored > 0 {
		m.AvgScore = totalScore / float64(scored)
	}

	return m
}

// NormalizeStatus lowercases a status label. PostgreSQL constrains jobs.status
// to the canonical labels (see infra/sql/schema.sql), so no alias handling is needed.
func NormalizeStatus(raw string) string {
	return strings.TrimSpace(strings.ToLower(raw))
}

// LoadReportSummary extracts key fields from a report file.
func LoadReportSummary(careerOpsPath, reportPath string) (archetype, tldr, remote, comp string) {
	fullPath := filepath.Join(careerOpsPath, reportPath)
	content, err := os.ReadFile(fullPath)
	if err != nil {
		return
	}
	text := string(content)

	// Current format first, then the historical format.
	if m := reCurArchetype.FindStringSubmatch(text); m != nil {
		archetype = cleanTableCell(m[1])
	} else if m := reArchetype.FindStringSubmatch(text); m != nil {
		archetype = cleanTableCell(m[1])
	} else if m := reArchetypeColon.FindStringSubmatch(text); m != nil {
		archetype = cleanTableCell(m[1])
	}

	if m := reCurSummary.FindStringSubmatch(text); m != nil {
		tldr = cleanTableCell(m[1])
	} else if m := reTlDr.FindStringSubmatch(text); m != nil {
		tldr = cleanTableCell(m[1])
	} else if m := reTlDrColon.FindStringSubmatch(text); m != nil {
		tldr = cleanTableCell(m[1])
	}

	if m := reCurLocation.FindStringSubmatch(text); m != nil {
		remote = cleanTableCell(m[1])
	} else if m := reRemote.FindStringSubmatch(text); m != nil {
		remote = cleanTableCell(m[1])
	}

	if m := reCurComp.FindStringSubmatch(text); m != nil {
		comp = cleanTableCell(m[1])
	} else if m := reComp.FindStringSubmatch(text); m != nil {
		comp = cleanTableCell(m[1])
	}
	// "UNKNOWN", "UNKNOWN — JD lists no band" and "Not assessed" carry no figure;
	// blank them so the pipeline column only shows real compensation data.
	if lc := strings.ToLower(comp); strings.HasPrefix(lc, "unknown") || lc == "not assessed" {
		comp = ""
	}

	// Truncate long fields
	if len(tldr) > 120 {
		tldr = tldr[:117] + "..."
	}

	return
}

func cleanTableCell(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimRight(s, "|")
	return strings.TrimSpace(s)
}

// StatusPriority returns the sort priority for a status (lower = higher priority).
func StatusPriority(status string) int {
	switch NormalizeStatus(status) {
	case "interview":
		return 0
	case "offer":
		return 1
	case "applied":
		return 2
	case "evaluated":
		return 3
	case "ghosted":
		return 4
	case "rejected":
		return 5
	case "discarded":
		return 6
	default:
		return 7
	}
}

// ComputeProgressMetrics computes progress-oriented analytics from applications.
func ComputeProgressMetrics(apps []model.CareerApplication) model.ProgressMetrics {
	pm := model.ProgressMetrics{}

	// Count by normalized status
	statusCounts := make(map[string]int)
	var totalScore float64
	var scored int

	for _, app := range apps {
		if app.IsPending {
			continue
		}
		norm := NormalizeStatus(app.Status)
		statusCounts[norm]++

		if app.Score > 0 {
			totalScore += app.Score
			scored++
			if app.Score > pm.TopScore {
				pm.TopScore = app.Score
			}
		}

		if norm == "offer" {
			pm.TotalOffers++
		}
		if norm == "applied" || norm == "interview" || norm == "offer" {
			pm.ActiveApps++
		}
	}

	if scored > 0 {
		pm.AvgScore = totalScore / float64(scored)
	}

	// Count rejected apps that reached interview stage (notes contain "interview").
	// Convention: put "interview" in notes of any rejected app that had an interview.
	rejectedWithInterview := 0
	for _, app := range apps {
		if NormalizeStatus(app.Status) == "rejected" &&
			strings.Contains(strings.ToLower(app.Notes), "interview") {
			rejectedWithInterview++
		}
	}

	// Funnel: each stage counts all apps that reached at least that stage.
	// Rejections count as responses — a rejection IS a company getting back to you.
	// Rejected apps with "interview" in notes also count toward the interview stage.
	total := 0
	for _, app := range apps {
		if !app.IsPending {
			total++
		}
	}
	applied := statusCounts["applied"] + statusCounts["interview"] + statusCounts["offer"] + statusCounts["rejected"] + statusCounts["ghosted"]
	responded := statusCounts["interview"] + statusCounts["offer"] + statusCounts["rejected"]
	interview := statusCounts["interview"] + statusCounts["offer"] + rejectedWithInterview
	offer := statusCounts["offer"]

	pm.FunnelStages = []model.FunnelStage{
		{Label: "Evaluated", Count: total, Pct: 100.0},
		{Label: "Applied", Count: applied, Pct: safePct(applied, total)},
		{Label: "Responded", Count: responded, Pct: safePct(responded, applied)},
		{Label: "Interview", Count: interview, Pct: safePct(interview, applied)},
		{Label: "Offer", Count: offer, Pct: safePct(offer, applied)},
	}

	// Rates (relative to applied)
	if applied > 0 {
		pm.ResponseRate = float64(responded) / float64(applied) * 100
		pm.InterviewRate = float64(interview) / float64(applied) * 100
		pm.OfferRate = float64(offer) / float64(applied) * 100
	}

	// Score distribution
	buckets := [5]int{} // 0: 4.5-5.0, 1: 4.0-4.4, 2: 3.5-3.9, 3: 3.0-3.4, 4: <3.0
	for _, app := range apps {
		if app.Score <= 0 {
			continue
		}
		switch {
		case app.Score >= 4.5:
			buckets[0]++
		case app.Score >= 4.0:
			buckets[1]++
		case app.Score >= 3.5:
			buckets[2]++
		case app.Score >= 3.0:
			buckets[3]++
		default:
			buckets[4]++
		}
	}
	pm.ScoreBuckets = []model.ScoreBucket{
		{Label: "4.5-5.0", Count: buckets[0]},
		{Label: "4.0-4.4", Count: buckets[1]},
		{Label: "3.5-3.9", Count: buckets[2]},
		{Label: "3.0-3.4", Count: buckets[3]},
		{Label: "  <3.0", Count: buckets[4]},
	}

	// Weekly activity: group by ISO week from Date field, show last 8 weeks.
	weekCounts := make(map[string]int)
	for _, app := range apps {
		if app.Date == "" {
			continue
		}
		t, err := time.Parse("2006-01-02", app.Date)
		if err != nil {
			continue
		}
		year, week := t.ISOWeek()
		key := fmt.Sprintf("%d-W%02d", year, week)
		weekCounts[key]++
	}

	// Sort weeks and take last 8
	var weeks []string
	for w := range weekCounts {
		weeks = append(weeks, w)
	}
	sort.Strings(weeks)
	if len(weeks) > 8 {
		weeks = weeks[len(weeks)-8:]
	}

	for _, w := range weeks {
		pm.WeeklyActivity = append(pm.WeeklyActivity, model.WeekActivity{
			Week:  w,
			Count: weekCounts[w],
		})
	}

	return pm
}

// safePct returns the percentage of part/whole, or 0 if whole is 0.
func safePct(part, whole int) float64 {
	if whole == 0 {
		return 0
	}
	return float64(part) / float64(whole) * 100
}
