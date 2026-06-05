---
name: redactor-doc-substring-falsepositive
description: redactor path-guard blockt beliebige Args mit .doc/.xlsx/.pdf-Substring als Office-Datei
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2a6a830b-561c-4f2e-a7eb-c8c32b04e42b
---

Der redactor path-guard (strict mode) blockt JEDEN Bash-Aufruf, dessen Kommandozeile eine Office-Datei-Endung als Substring enthält — auch wenn es gar keine Datei ist. Beispiel: `backlog task edit ... --plan "...psections.doc..."` wurde mit "command touches an office document (Word document (legacy))" abgewiesen, weil `.doc` im Fließtext stand.

**Why:** Der Guard matcht `.doc/.docx/.xlsx/.pptx/.pdf` als Token irgendwo in der Command-Line, nicht nur an echten Dateipfaden.

**How to apply:** In Bash-Argumenten (Task-Plans, Commit-Messages, Final-Summaries, echo/printf-Text) diese Endungs-Substrings vermeiden — z.B. "psections-doc" statt "psections.doc" schreiben, oder den Text in eine .txt/.md-Datei legen und referenzieren. Ergänzt die in der globalen CLAUDE.md dokumentierten Strict-Mode-Fallstricke.
