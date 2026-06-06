package collectors

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"go-knowledge-app/internal/shared"
)

// Decision mirrors the TS Decision interface.
type Decision struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Status string `json:"status"`
	Body   string `json:"body"`
	Mtime  *int   `json:"mtime,omitempty"` // epoch seconds
}

// MemoryEntry / LektionEntry — a knowledge file with its mtime (epoch seconds).
type MemoryEntry struct {
	Name  string `json:"name"`
	Mtime int    `json:"mtime"`
}
type LektionEntry struct {
	Name  string `json:"name"`
	Mtime int    `json:"mtime"`
}

// ChangelogEntry is one CHANGELOG block (heading + body).
type ChangelogEntry struct {
	Heading string `json:"heading"`
	Body    string `json:"body"`
}

// DocEntry mirrors the TS DocEntry interface.
type DocEntry struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	File  string `json:"file"`
	Mtime *int   `json:"mtime,omitempty"` // epoch seconds
}

var (
	decisionLineRe = regexp.MustCompile(`^\s*##\s+(?P<id>\d+)\s*(?:—|-{1,2})\s*(?P<title>.*\S)\s*$`)
	statusRe       = regexp.MustCompile(`(?i)^\s*(?:[-*]\s*)?\**\s*Status\s*\**\s*[:=]\s*(.+\S)\s*$`)
)

// ParseDecisionsMd parses a knowledge/decisions.md into Decision blocks.
func ParseDecisionsMd(text string) []Decision {
	out := []Decision{}
	currentIdx := -1
	body := []string{}

	flush := func() {
		if currentIdx >= 0 {
			out[currentIdx].Body = strings.TrimSpace(strings.Join(body, "\n"))
		}
	}

	for _, line := range strings.Split(text, "\n") {
		if m := decisionLineRe.FindStringSubmatch(line); m != nil {
			flush()
			body = body[:0]
			out = append(out, Decision{ID: m[1], Title: m[2], Status: "", Body: ""})
			currentIdx = len(out) - 1
			continue
		}
		if currentIdx >= 0 {
			if sm := statusRe.FindStringSubmatch(line); sm != nil && out[currentIdx].Status == "" {
				out[currentIdx].Status = strings.TrimSpace(strings.Trim(strings.TrimSpace(sm[1]), "*"))
			}
			body = append(body, line)
		}
	}
	flush()
	return out
}

func mtimeSeconds(path string) int {
	if info, err := os.Stat(path); err == nil {
		return int(info.ModTime().Unix())
	}
	return 0
}

var (
	decisionFileRe = regexp.MustCompile(`^decision-(\d+)`)
	h1Re           = regexp.MustCompile(`^#\s+(.*\S)\s*$`)
	statusLineRe   = regexp.MustCompile(`(?im)^status:\s*(.+\S)\s*$`)
)

func backlogDecisions(repo string) []Decision {
	ddir := filepath.Join(repo, "backlog", "decisions")
	entries, err := os.ReadDir(ddir)
	if err != nil {
		return []Decision{}
	}
	out := []Decision{}
	for _, e := range entries {
		if e.IsDir() || !decisionFileRe.MatchString(e.Name()) {
			continue
		}
		fpath := filepath.Join(ddir, e.Name())
		did := strings.TrimSuffix(e.Name(), ".md")
		if m := decisionFileRe.FindStringSubmatch(e.Name()); m != nil {
			did = m[1]
		}
		text, _ := shared.ReadText(fpath)
		title := strings.TrimSuffix(e.Name(), ".md")
		for _, line := range strings.Split(text, "\n") {
			if hm := h1Re.FindStringSubmatch(line); hm != nil {
				title = strings.TrimSpace(hm[1])
				break
			}
		}
		status := ""
		if sm := statusLineRe.FindStringSubmatch(text); sm != nil {
			status = strings.TrimSpace(sm[1])
		}
		body := text
		if strings.HasPrefix(strings.TrimLeft(text, " \t\r\n"), "---") {
			parts := strings.Split(text, "---")
			if len(parts) >= 3 {
				body = strings.Join(parts[2:], "---")
			}
		}
		mt := mtimeSeconds(fpath)
		out = append(out, Decision{ID: did, Title: title, Status: status, Body: sliceRunes(strings.TrimSpace(body), 8000), Mtime: &mt})
	}
	sortByMtimeDescThenID(out)
	return out
}

// sortByMtimeDescThenID sorts decisions by mtime DESC, then id (localeCompare).
func sortByMtimeDescThenID(d []Decision) {
	sort.SliceStable(d, func(i, j int) bool {
		mi, mj := derefOr0(d[i].Mtime), derefOr0(d[j].Mtime)
		if mi != mj {
			return mi > mj
		}
		return localeLess(d[i].ID, d[j].ID)
	})
}

func derefOr0(p *int) int {
	if p == nil {
		return 0
	}
	return *p
}

func resolveVault() string {
	if env := os.Getenv("OBSIDIAN_VAULT_PATH"); env != "" {
		return env
	}
	if env := os.Getenv("TASKNOTES_VAULT"); env != "" {
		return env
	}
	def := filepath.Join(Home(), "GITHUB", "ObsidianPKM")
	if _, err := os.Stat(def); err == nil {
		return def
	}
	return ""
}

var (
	h23Re     = regexp.MustCompile(`^#{2,3}\s+`)
	hAnyRe    = regexp.MustCompile(`^#\s+`)
	isoDateRe = regexp.MustCompile(`(\d{4}-\d{2}-\d{2})`)
)

// ParseChangelogBlocks parses a CHANGELOG.md into blocks (one block = one
// `##`/`###` heading + body). H1 is the doc title and skipped; empty-body blocks
// dropped. Sorted newest-first (reversed if file appears oldest-first).
func ParseChangelogBlocks(text string, limit int) []ChangelogEntry {
	blocks := []ChangelogEntry{}
	var current *ChangelogEntry
	bodyLines := []string{}

	flush := func() {
		if current != nil {
			body := strings.TrimSpace(strings.Join(bodyLines, "\n"))
			if body != "" {
				current.Body = body
				blocks = append(blocks, *current)
			}
			current = nil
		}
		bodyLines = bodyLines[:0]
	}

	for _, line := range strings.Split(text, "\n") {
		switch {
		case h23Re.MatchString(line):
			flush()
			current = &ChangelogEntry{Heading: strings.TrimSpace(line)}
		case hAnyRe.MatchString(line):
			flush()
		case current != nil:
			bodyLines = append(bodyLines, line)
		}
	}
	flush()

	if len(blocks) >= 2 {
		firstDate := firstSubmatch(isoDateRe, blocks[0].Heading)
		lastDate := firstSubmatch(isoDateRe, blocks[len(blocks)-1].Heading)
		if firstDate != "" && lastDate != "" && firstDate < lastDate {
			for i, j := 0, len(blocks)-1; i < j; i, j = i+1, j-1 {
				blocks[i], blocks[j] = blocks[j], blocks[i]
			}
		}
	}

	if len(blocks) > limit {
		return blocks[:limit]
	}
	return blocks
}

func firstSubmatch(re *regexp.Regexp, s string) string {
	if m := re.FindStringSubmatch(s); m != nil {
		return m[1]
	}
	return ""
}

func vaultChangelog(repo, repoName, vault string, limit int) []ChangelogEntry {
	if localText, ok := shared.ReadText(filepath.Join(repo, "knowledge", "CHANGELOG.md")); ok && localText != "" {
		return ParseChangelogBlocks(localText, limit)
	}
	if vault == "" {
		return []ChangelogEntry{}
	}
	if vaultText, ok := shared.ReadText(filepath.Join(vault, "Efforts", "Work", "dgk", repoName, "CHANGELOG.md")); ok && vaultText != "" {
		return ParseChangelogBlocks(vaultText, limit)
	}
	return []ChangelogEntry{}
}

var (
	fmBlockRe   = regexp.MustCompile(`(?s)^---\n(.*?)\n---`)
	titleLineRe = regexp.MustCompile(`(?im)^title:\s*(.+\S)\s*$`)
	idLineRe    = regexp.MustCompile(`(?im)^id:\s*(.+\S)\s*$`)
	quoteEdgeRe = regexp.MustCompile(`^["']|["']$`)
)

func backlogDocs(repo string) []DocEntry {
	docsDir := filepath.Join(repo, "backlog", "docs")
	out := []DocEntry{}
	entries, err := os.ReadDir(docsDir)
	if err != nil {
		return out
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") {
			continue
		}
		fpath := filepath.Join(docsDir, e.Name())
		text, _ := shared.ReadText(fpath)
		base := strings.TrimSuffix(e.Name(), ".md")
		title := base
		var fm string
		if m := fmBlockRe.FindStringSubmatch(text); m != nil {
			fm = m[1]
			if tm := titleLineRe.FindStringSubmatch(fm); tm != nil {
				title = strings.TrimSpace(quoteEdgeRe.ReplaceAllString(tm[1], ""))
			}
		}
		if title == base {
			for _, line := range strings.Split(text, "\n") {
				if hm := h1Re.FindStringSubmatch(line); hm != nil {
					title = strings.TrimSpace(hm[1])
					break
				}
			}
		}
		id := base
		if fm != "" {
			if im := idLineRe.FindStringSubmatch(fm); im != nil {
				id = strings.TrimSpace(im[1])
			}
		}
		mt := mtimeSeconds(fpath)
		out = append(out, DocEntry{ID: id, Title: title, File: e.Name(), Mtime: &mt})
	}
	sort.SliceStable(out, func(i, j int) bool {
		mi, mj := derefOr0(out[i].Mtime), derefOr0(out[j].Mtime)
		if mi != mj {
			return mi > mj
		}
		return localeLess(out[i].ID, out[j].ID)
	})
	return out
}

// CollectKnowledge inspects knowledge/: decisions, lektion-*, memory/*, vault
// CHANGELOG tail, backlog docs. Pass an empty vaultPath to auto-resolve.
func CollectKnowledge(cwd, vaultPath string) map[string]any {
	repo := RepoRoot(cwd)
	kdir := filepath.Join(repo, "knowledge")

	// Decisions: prefer knowledge/decisions.md, else backlog/decisions/*.
	decisions := []Decision{}
	decMdPath := filepath.Join(kdir, "decisions.md")
	if decMdText, ok := shared.ReadText(decMdPath); ok && decMdText != "" {
		decisions = ParseDecisionsMd(decMdText)
		decMdMtime := mtimeSeconds(decMdPath)
		for i := range decisions {
			m := decMdMtime
			decisions[i].Mtime = &m
		}
		sortByMtimeDescThenID(decisions)
	}
	if len(decisions) == 0 {
		decisions = backlogDecisions(repo)
	}

	// lektion-*.md + optional lessons-learned.md — sorted newest-first
	lektionen := []LektionEntry{}
	if entries, err := os.ReadDir(kdir); err == nil {
		for _, e := range entries {
			if !e.IsDir() && lektionFileRe.MatchString(e.Name()) {
				lektionen = append(lektionen, LektionEntry{Name: e.Name(), Mtime: mtimeSeconds(filepath.Join(kdir, e.Name()))})
			}
		}
	}
	lessonsFile := filepath.Join(kdir, "lessons-learned.md")
	if info, err := os.Stat(lessonsFile); err == nil {
		lektionen = append(lektionen, LektionEntry{Name: "lessons-learned.md", Mtime: int(info.ModTime().Unix())})
	}
	sort.SliceStable(lektionen, func(i, j int) bool { return lektionen[i].Mtime > lektionen[j].Mtime })

	// knowledge/memory/*.md — sorted newest-first
	memory := []MemoryEntry{}
	memDir := filepath.Join(kdir, "memory")
	if entries, err := os.ReadDir(memDir); err == nil {
		for _, e := range entries {
			if !e.IsDir() && strings.HasSuffix(e.Name(), ".md") {
				memory = append(memory, MemoryEntry{Name: e.Name(), Mtime: mtimeSeconds(filepath.Join(memDir, e.Name()))})
			}
		}
	}
	sort.SliceStable(memory, func(i, j int) bool { return memory[i].Mtime > memory[j].Mtime })

	// CHANGELOG: prefer knowledge/CHANGELOG.md, fall back to vault path
	vault := vaultPath
	if vault == "" {
		vault = resolveVault()
	}
	repoName := lastPathSegment(repo)
	changelog := vaultChangelog(repo, repoName, vault, 20)

	docs := backlogDocs(repo)

	return map[string]any{
		"available": true,
		"decisions": decisions,
		"lektionen": lektionen,
		"memory":    memory,
		"changelog": changelog,
		"docs":      docs,
	}
}

var lektionFileRe = regexp.MustCompile(`^lektion-.*\.md$`)
