# Memory Index — cc-setup

- [Org-Regel via Subagent-Isolation](org-rule-subagent-isolation.md) — dev≠review in einer Session: Dev-Subagent → Review-Subagent
- [fallow Stop-Hook strippt Exporte](subagent-resume-file-revert.md) — cleanup-dispatch-stop.sh fährt `fallow fix --yes` bei Stop und entfernt `export` von Symbolen, deren Consumer fallow nicht sieht (.pi/ Dot-Dir, nur-Test); Fix via .fallowrc.json ignoreExports/entryPoints
- [Auto-Sync-Push-Hazard](cc-setup-auto-sync-push-hazard.md) — Stop-Hook committet/pusht ungeprüft; vor Push immer git-State checken
- [Logs-Redacted Slack-Token-Leak](logs-redacted-slack-token-leak.md) — "redacted"-Logs scrubben xoxb--Tokens nicht; Push Protection blockt; logs/ jetzt gitignored, nie unblock-Link klicken
- [Flat-Migration-Stand](cc-setup-flat-migration.md) — ccs-flat fertig in-repo, 13 Commits ungepusht/nicht-deployed; Aktivierung = User-Review→push→just setup→Restart
- [Redactor .doc-Substring-Falsepositive](redactor-doc-substring-falsepositive.md) — Bash-Args mit .doc/.xlsx/.pdf-Substring werden als Office-Datei geblockt
- [Subagent-Self-Report verifizieren](subagent-selfreport-verify.md) — Dev-Subagent "Tests grün" unabhängig mit echten Task-Flags + End-to-End re-checken
- [Deno-Knowledge Cache Python-Runaway](deno-knowledge-cache-python-runaway.md) — Sidebar-Cost spawnte runaway session_analyze.py (100GB); single-flight+lazy, max 1 Python, kein Multi-Server
- [Deno-Knowledge tn Org-Block](deno-knowledge-tn-org-block.md) — tn-Daten = kunden-/personenbezogen; NICHT cross-project aggregieren, tn projects meiden (Org-Regel)
- [Skill-Deploy Plugin-Root-Platzhalter](skill-deploy-plugin-root-placeholder.md) — Skills nutzen ${CLAUDE_PLUGIN_ROOT}-Platzhalter (deploy-zeit-sed), nie hardcoded $HOME/.claude; deploy.sh defaultet auf $CLAUDE_CONFIG_DIR
- [CC Kontext: Skill/Agent nur Metadaten](cc-context-skill-agent-metadata-only.md) — /context lädt je Skill/Agent nur name+description (progressive disclosure), nicht ganze Datei; Footprint-Tools entsprechend zählen
- [pi-Orchestrator-Workflow](pi-orchestrator-workflow.md) — CCS-035 implementiert (11/11 Done); Worker via Claude Agent SDK (nicht claude -p), redactor im Worker aus (settingSources:[], User-ok), autonomer E2E = manueller just-orchestrate-Lauf (Harness-Limit)
- [pi-Worker canUseTool-Permissions](pi-worker-canusetool-permissions.md) — bypassPermissions wird unter Enterprise-Managed-Policy ignoriert (headless-auto-deny); echter Headless-Approver = canUseTool-Whitelist + permissionMode:'default'; Repo-Root deterministisch in Prompt
- [pi Neu-Meilenstein-Ausarbeitung](pi-new-milestone-elaboration.md) — pio „Neuer Meilenstein": Launcher zerlegt per milestone-planner-Worker in Draft-Tasks + Human-Gate (promote/archive) + CC_ORCH_MILESTONE-Scope; Orchestrator unverändert (CCS-036.15)
- [go-knowledge-app Port](go-knowledge-app-port.md) — Go-1:1-Port der deno-knowledge-app; Phase 1 (Quellcode) fertig+verifiziert, Tests offen; go:embed, just go / just go-build
- [deploy --no-redactor Flag](deploy-no-redactor-flag.md) — diese Maschine bewusst redactor-frei (Flag+Sentinel); Enforcement greift erst nach Restart; Code uncommitted+ungereviewt
