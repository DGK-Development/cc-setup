---
name: cc-setup-auto-sync-push-hazard
description: The session-end sync hook in cc-setup auto-commits and can auto-push unreviewed code
metadata: 
  node_type: memory
  type: project
  originSessionId: 83a65db1-be08-4b7c-90c9-ca04f2ec4e3a
---

In cc-setup feuert `~/.claude/hooks/stop-workflow.sh` bei Session/Subagent-Stop und übergibt an einen inline-Claude (session-stop-Skill), der **automatisch committet und teils pusht** — auch mehrfach mitten in einer laufenden Session. Belegt: er pushte `a3e52f9` ungeprüft (Submodul-Gitlink zeigte auf ungepushtes `d55c6c3` → kaputter Remote-Pointer) und committete ungefragt Backlog-Milestones (`2ea8253`, `626495d`).

**How to apply:** In cc-setup-Sessions damit rechnen, dass neue Commits "von selbst" auftauchen — vor Push-Entscheidungen IMMER `git log @{u}..HEAD` + `git submodule status` prüfen. Submodul-Push muss VOR Parent-Push (sonst dangling Gitlink). Bei Org-gegateten Reviews: dem User klar sagen, dass der Session-Ende-Hook ungeprüft pushen könnte. Fix getrackt in Backlog CCS-008. Siehe [[org-rule-subagent-isolation]].
