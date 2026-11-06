# M3/M4 issue plan (owner-approved, 2026-11-06)

Planned before the owner's six-week trip so scheduled agents can keep working without them (`docs/CONTINUITY.md`, "Trip mode"). The owner asked for the plan to go as far as possible with no device checks. The issue bodies are the task contracts. Letters are the draft names used in the issues.

## Constraints that shaped the plan
- **No Tier 3 while the owner is away.** Every touch feature merges behind a Labs flag that is off by default (L1), and is labelled `tier3-deferred` for one batched iPhone check on return (trip log #123). The default build stays the one the owner verified.
- **Playwright WebKit is not iOS Safari.** L2 adds iPhone-profile Tier 1 checks (layout, ≥44 px targets, safe area, touch) to catch what it can.
- **The game side is proved in Tier 2, the UI side in Tier 1.** UI issues use a fake semantic source in Tier 1. The game behaviour they rely on (state addresses, the planner's pad sequences) has its own Tier 2 issue.
- **Input only.** Panels compile taps into pad sequences through one planner (S3), and confirm by reading memory (`docs/ARCHITECTURE_SURVEY.md` §6). No memory writes.
- **No game text.** Panel labels are project-written English or generic ("Choice 2"). Names decoded from RAM at runtime may be shown on the device, never committed or reported from Tier 2.
- **Tier 2 budget.** 32 scenarios per run until #109 (raise to 64, owner-merged) lands. Batch hypotheses; find addresses in the decomp first.

## Issues and order
| Draft | Issue | Title | Class | Blocked on |
|---|---|---|---|---|
| L1 | #105 | Labs feature flags | light | — |
| L2 | #106 | iPhone-profile Tier 1 checks | light | — (per-flag loop: #105) |
| — | #107 | Overlay follow-ups from #92 | light/full | — |
| S1 | #108 | Confirm dialogue window state | full | — |
| S2 | #110 | Confirm battle command state | full | — |
| S3 | #111 | Menu planner, proved in Tier 2 | full | — |
| S4 | #112 | Field interactables model | full | — (#99 helps) |
| S5 | #117 | Confirm inventory, materia, equipment from generated saves | full | — |
| U1 | #113 | Automatic control mode (half of #25) | light | #105 |
| U2 | #114 | Tap to advance dialogue, tap a choice | light | #105, #108, #111 |
| U3 | #115 | Main menu panel | light | #105, #111 |
| U4 | #116 | Battle command panel | light/full | #105, #110, #111 |
| — | #25 | Context-aware Interact label (refine to the other half) | light | #112, #113 |
| — | #24 | Border crop, mode-gated | light | #81 |
| X1 | #120 | M3 exit: headless touch-action playthrough to the first save point | full | #108, #110, #111, #112, #114, #116 |
| P1 | #118 | Speed toggle | light | — |
| P2 | #119 | Suspend and resume | light | — |
| P3 | #121 | Native Materia / Equip screen | full | #105, #111, #115, #117 |

M2's remaining issues (#93, #99, #101, #80, #81) stay first in the queue. #93 can merge in trip mode because Debug is already off by default.

```
#105 ─┬─► #113 ─────────────┐
      ├─► #114 ◄─ #108, #111 ├─► #25 ◄─ #112
      ├─► #115 ◄─ #111 ──────┼─► #121 ◄─ #117
      └─► #116 ◄─ #110, #111 │
#108, #110, #111, #112, #114, #116 ─► #120 (M3 exit, headless)
#118, #119: independent (M4)
```

## Order for agents
Oldest ready first, as usual (`docs/CONTINUITY.md`). In practice: the M2 queue, then #105 and #106 (cheap, and they unblock every UI issue), then the Tier 2 confirmations (#108, #110, #111, #112, #117), interleaved with the UI issues as they unblock. #118 and #119 fill gaps when Tier 2 work is waiting on CI.

## What M3 "done" means
#120 green in Tier 2, plus the owner's Tier 3 batch on return. Until that check, M3 is "done headless".

## Not planned yet
Tap to walk (stretch goal), world-map controls beyond the classic pad, minigames beyond #80's one, the native shell. Agents in trip mode don't plan these; they're for the owner on return.
