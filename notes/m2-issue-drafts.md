# M2 issue plan (owner-approved, 2026-11-05)

M2 is the game-state layer (`docs/PHASE0.md`). This note records how it was broken into issues and why. The issue bodies are the task contracts. Letters are the draft names used in the issues.

## Constraints that shaped the plan
- Tier 2 returns only pass/fail and at most 8 number metrics per scenario, and runs at most 32 scenarios (`harness/schema/tier2-result.schema.json`). Each try costs a push, a build, a disc download and a run. So an address is found in the decomp first (a hypothesis), then confirmed with a scenario, never searched for blind.
- The intro needs input to reach the title (`notes/36-disc-boot.md`: title code resident at frame 1231 with Start pressed, not reached in 5400 frames without input).
- The opening reaches field, menu, battle and movie, but not the world map or minigames. Those need generated-save boot points (#38).
- Snapshots stay in sandbox memory. Persisting them between runs would be a private save-state store (protected `harness/private-eval/`), so it is out of scope.

## Issues and order
| Draft | Issue | Title | Class | Blocked on |
|---|---|---|---|---|
| 0 | #37 | Scenario format 2: title snapshot, input scripts, `wait.until` | full | — (ready) |
| A | #74 | Chained snapshots and reusable input segments | full | #37 |
| B | #75 | Semantic layer skeleton, address table with provenance, hash gate | light | — (ready) |
| C | #76 | Confirm game mode: field, battle, menu, movie | full | #74, #75 |
| D | #77 | Confirm field ID and player position (and field-loaded) | full | #76 |
| E | #78 | Confirm menu cursor and party data | full | #76 |
| F | #79 | Debug overlay with live values (Tier 3) | light | #75 |
| G | #38 | Boot from a generated save, first boot point | full | #37, #76, #77 (and #74) |
| H | #80 | Boot-point catalogue: world map and a minigame | full | #38 |
| I | #81 | M2 exit: mode-detection reliability set | full | #76, #77, #78, #80 |

```
#37 ─► #74 ─┐
#75 ────────┼─► #76 ─┬─► #77 ─┬─► #38 ─► #80 ─┐
            │        └─► #78 ─┼───────────────┼─► #81 (M2 done; #24/#25 ready for M3)
#75 ─► #79 (overlay, Tier 3)  └───────────────┘
```

#37 and #75 can run in parallel.

## Decisions (owner, 2026-11-05)
- The semantic layer lives in `semantic/`.
- A second movie-detection candidate is allowed within #76's attempt budget, not as a separate issue.
- No result-format change is proposed up front. If an issue really hits the 8-metric limit after splitting scenarios, it files a separate `needs-owner` issue.
- #75 and #79 are good `model:sonnet` candidates. Only the owner adds that label.

## After M2
#81 relabels #25 (context-aware controls) and #24 (border crop, now mode-gated, reusing closed PR #72's work) as ready for M3.
