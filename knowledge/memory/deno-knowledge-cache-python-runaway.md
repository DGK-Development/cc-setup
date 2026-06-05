---
name: deno-knowledge-cache-python-runaway
description: deno-knowledge-app Cache spawnte runaway session_analyze.py (100GB RAM) — single-flight + lazy + max 1 Python
metadata: 
  node_type: memory
  type: project
  originSessionId: f8e5304e-b509-47e8-b0b3-ba511eecda57
---

deno-knowledge-app (CCS-018) Sidebar-Cost rief pro Projekt `uv run scripts/session_analyze.py` (≈17% RAM/Lauf). Ursache des 100GB-RAM-Vorfalls (2026-06-05): mehrere parallele `just deno`-Server + `setInterval`-Refresh alle 5min × 16 Projekte → überlappende Batches → viele parallele Python. Zusätzlich triggerte ein `ensureFresh` im GET/-Handler die Scans auch in Tests (cwd `/tmp`, aber `projectRoots()` scannt echte ~/GITHUB-Dirs), fire-and-forget → lief nach Testende weiter.

**Why:** session_analyze.py ist speicher-schwer; pro-Projekt × mehrere Server × Timer = RAM-Explosion. User-Vorgabe: **max 1 Python-Skript gleichzeitig im Hintergrund**.

**How to apply:** cache.ts nutzt jetzt **single-flight** `refreshAggregate` (≤1 Lauf prozessweit; collectSidebar sequentiell → ≤1 Python), **kein Background-Timer** mehr (reines Lazy-on-Request via `ensureFresh`, nur wenn stale UND kein Lauf), `started`-Gate (kein Spawn ohne `startCache`, d.h. nie in Tests), TTL 15min. NIE mehrere `just deno`-Server gleichzeitig laufen lassen — vor Start alte killen (`pkill -f main.ts`). OFFENER Follow-up: session_analyze.py für Sidebar-Cost durch nativen TS-JSONL-Reader ersetzen (deno-only, leicht) statt uv/Python zu shellen. Siehe [[subagent-selfreport-verify]] (unabhängig verifizieren).
