---
name: ""
metadata: 
  node_type: memory
  originSessionId: fa416bc6-308a-42c7-a6d3-c01eabf809ac
---

2026-06-07: GitHub Push Protection (Repo-Rule, läuft auch ohne aktiviertes Secret Scanning) blockte Push auf DGK-Development/cc-setup — echtes Slack-Bot-Token `xoxb-…` in `logs/2026-06-07-redacted.jsonl:14`, obwohl Datei `-redacted` heißt. Die Log-Redaction (bzw. der redactor, hier eh redactor-frei laut [[deploy-no-redactor-flag]]) fängt `xoxb-/xoxp-/xapp-`-Slack-Tokens NICHT. Token kam via Auto-Sync-Stop-Hook in den Commit ([[cc-setup-auto-sync-push-hazard]]).

**Fix angewandt:** logs/ komplett untracked (`git rm -r --cached logs/`), `.gitignore` von `logs/run-gates-*.log` auf `logs/` verbreitert, HEAD-Commit `git commit --amend` (Token war nur im Tip-Commit), Push ok. Keine Token-Rotation (verließ die Maschine nie — Push war blockiert).

**Why:** redactor/Log-Scrubbing deckt Slack-Token-Muster nicht ab → falsch-negativ (Gegenstück zu [[redactor-doc-substring-falsepositive]]).
**How to apply:** logs/ bleibt jetzt gitignored. Bei künftigen Push-Protection-Treffern NICHT den `unblock-secret`-Link klicken (pusht echtes Secret), sondern Tip-Commit amenden/rebasen. Redactor-Pattern für `xox[baprs]-` ergänzen, wenn Logs je wieder getrackt werden.
