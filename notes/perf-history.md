# Performance history

One row per benchmark run (`web/bench/`, issue #8). Paste the essentials from the report JSON; keep the JSON in the linked issue or comment. Thresholds (Experiment 01): speed ≥ 1.5×, real-time p99 ≤ 16.7 ms, 0 underruns in 10 min, peak heap ≤ 256 MB, no reloads.

| Date | Build (slot, sha) | Device, OS, mode | Program | Speed | p50 / p99 ms | First / last p99 | Underruns | Heap MB | Startup ms | Verdict | Report |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-11-04 | local, branch of #8 | headless Chromium, Linux 4 vCPU (agent container, not a phone) | gte-gpu-stress v1, 1000 tris, short run (600 frames / 10 s) | 2.79× | 6.4 / 10.5 | 10.1 / 9.2 | 0 | 64 | 100 | pass-short | notes/8-bench-page.md |
| 2026-11-04 | pr-27, db49cca (core 7b0e8f8fadfb, wasm 33987635ec11) | iPhone 14 Pro, iOS 18.7 (UA), Safari 27.0.1, tab, Wake Lock granted | gte-gpu-stress v1, 1000 tris, full run (3000 frames / 20 min) | 5.89× | 5 / 7 | 7 / 7 | 0 (overflows 0) | 64 | 2578 (core ready 2291) | pass | #28 |

Notes on the iPhone row:
- Safari rounds `performance.now()` to whole milliseconds, so the iPhone frame times are integers. A p99 of 7 ms is precise only to ±1 ms; the threshold (16.7 ms) is far away.
- 71,999 of 72,000 real-time frames ran, with no re-anchors (`late` 0). The first and last minutes are identical (p99 7 ms), so there's no sign of thermal slowdown over 20 minutes.
- The phone's unthrottled speed (5.89×) is about twice the agent container's headless Chromium (2.79×).
- Startup is dominated by fetching and compiling the core (2.3 s to core ready); the first frame takes 20 ms.
