# Performance history

One row per benchmark run (`web/bench/`, issue #8). Paste the essentials from the report JSON; keep the JSON in the linked issue or comment. Thresholds (Experiment 01): speed ≥ 1.5×, real-time p99 ≤ 16.7 ms, 0 underruns in 10 min, peak heap ≤ 256 MB, no reloads.

| Date | Build (slot, sha) | Device, OS, mode | Program | Speed | p50 / p99 ms | First / last p99 | Underruns | Heap MB | Startup ms | Verdict | Report |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-11-04 | local, branch of #8 | headless Chromium, Linux 4 vCPU (agent container, not a phone) | gte-gpu-stress v1, 1000 tris, short run (600 frames / 10 s) | 2.79× | 6.4 / 10.5 | 10.1 / 9.2 | 0 | 64 | 100 | pass-short | notes/8-bench-page.md |
