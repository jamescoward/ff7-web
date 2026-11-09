# #140: is the save-booted world map live?

Status (2026-11-09): **done.** A message window is open when the save-booted world map starts, and it holds the player (attempt 3). After three Circle presses close it, the pad moves the party: `save-boot-7-world-kalm` checks this (Tier 2 green at `1247393`).

## Starting point (#80, `notes/80-boot-catalogue.md`)
`disc1-wm1-kalm` and `disc1-wm0-midgar` load into the world map (g_GameState 3, the entry point holds, map number 0, player actor pointer D_8010AD40 = pool element 7, 0x8010A554). In #80 attempt 3, element 7's pos.vx/vz did not change over 60 frames of Up and 60 of Right, 600 frames after the state read 3.

## Sources (reference only; no code copied)
Xeeynamo/ff7-decomp @ `9411173034bde2ae4c9b0312167e79c3645ca1be`, `src/world/world.c`, `src/world/world.h`:
- `WORLD_Main`: after loading, sets the world loop state `D_800E566C` to -15 and runs the main loop while it is below 6. Each frame: `WmHandleButtons` (not decompiled; asm only), scripts, camera, `WmUpdateWorldState`, render.
- `WmUpdateWorldState`: a negative state counts up by 1 per loop; at 0 it sets the display mask, starts a fade-in and sets 1 (playing). 0 with the intro camera timers (`D_800E5638`, `D_800E563C`) running waits for them. 2 is the menu, 3 and 8 request a field or battle exit, 4/5 the submarine.
- `WorldActor` (0xE0 bytes): `pos` (VECTOR) at +0x0C, `altPos` at +0x1C, `unk3E` +0x3E, `direction` +0x40, `actorType` +0x50, `flags1` +0x51.
- `WmScriptDisableForPcEntity(1)` sets flags1 bit 0x10 on the player actor (a world script disables it); bit 0x80 is "position needs recalculation".
- `D_8011650C` is the frame step (2 after `WmLoadTxzDataAndInit`); movement code branches on it.
- The world code reads the pad through `InputReadPads()`, as other modules do.

## Attempt 1 plan (one Tier 2 push, diagnostic)
Four new scenarios from the same saves; each loads as `save-boot-7-world-kalm` does, then marks `ready` before the input, so changes are measured from just before the pad (in #80 attempt 3 it is not recorded whether the change was measured from the start of the script, before the world map existed). Signs only for positions and angles.

| scenario | after the load | input after the mark | reported |
|---|---|---|---|
| save-boot-7a-world-kalm-diag | 600 frames | Up 120 | wl_state, frame_d, atype, flags1, x/z/ax/dir change |
| save-boot-7b-world-kalm-long | 3000 frames | Up 300, Right 300 | wl_state, flags1, x/z/ax/az/dir/rot change |
| save-boot-7c-world-kalm-presses | 600 frames, then Circle ×3, Cross ×3 | Up 120 | game_state, wl_state, cam, flags1, x/z/dir change |
| save-boot-8a-world-midgar-diag | 600 frames (Midgar save) | Up 120 | as 7a |

What the results decide:
- wl_state not 1 (e.g. still counting, or 0 with intro timers) → the loop never reached "playing"; look at why (fade, intro camera).
- flags1 has 0x10 → a world script disabled the player (progress 6 is md1stin's value): try another progress value or entry point.
- direction/rotation change but position does not → input arrives; movement is blocked (collision, walkmesh, or the position lives elsewhere).
- Only 7b moves → a longer settle time; only 7c moves → something needed a press.
- Position changes in 7a → #80 attempt 3's measurement was the problem; attempt 2 makes the live check the acceptance check in `save-boot-7-world-kalm`.

## Attempt 1 results (`8b8eabb`, tier2: 39 pass, 4 fail; the four fails are these diagnostics)
| scenario | metrics |
|---|---|
| save-boot-7a-world-kalm-diag | wl_state 1, frame_d 2, atype 0, flags1 2, x_dir 0, z_dir 0, ax_dir 0, dir_d 0 |
| save-boot-7b-world-kalm-long | wl_state 1, flags1 2, x/z/ax/az_dir 0, dir_d 0, rot_d 0 |
| save-boot-7c-world-kalm-presses | **game_state 1**, wl_state 0, cam 0, flags1 0, x_dir -1, z_dir -1, dir_d 0 |
| save-boot-8a-world-midgar-diag | as 7a (every metric equal) |
| every earlier scenario | pass, unchanged |

Reading:
- **The world loop is in "playing"** (wl_state 1) 600 frames after the load, and still after 3000. The frame step is 2, as the load sets it. Not a long fade or a stuck intro.
- **No script lock:** flags1 is 0x02 (bit 0x10 is clear). actorType 0 (the world model for Cloud, by the decomp's model checks).
- **The D-pad does nothing:** with a mark just before the input, neither the position, the alternate position, the direction nor the rotation changed, after 600 or 3000 frames of settling, at Kalm or Midgar. So #80 attempt 3's result was not a measuring artefact.
- **Buttons do reach the world module:** Circle then Cross presses (7c) took the game **out of the world map into a field** (g_GameState 1). The world overlay's memory was then reused, which is why 7c's position "changes" (not movement).
- So input arrives, but the movement path is gated.

## Attempt 2 plan (one Tier 2 push)
Sources (same decomp, reference only): `WmUpdateStreamingAndCamera` moves the player only while `D_80109D64` is 1 (by `D_80109D68`), and holds it while `D_801163D4` is 2. It counts frames with three or more map blocks queued in `D_800E5818`; at 300 it calls `func_800A41E8(1)`, which fades out and calls `func_800A2108(0, 4)`: that clears `D_800E55FC` (read by `func_800A21A4`) and records 4 in `D_800E5600`. `WmHandleButtons` is asm only, but the pattern suggests `D_800E55FC` gates movement input. **Hypothesis: map blocks never finish loading after this boot, so the world stalls with input off.**

| scenario | what | reported |
|---|---|---|
| save-boot-7d-world-kalm-stream | 600 frames, mark, Up 120; values read while Up is held | btn_ok, btn_ctx, pend, stream, move_req, sub_state, queue_empty, x_dir |
| save-boot-7e-world-kalm-circle | 600 frames, Circle ×3, 300 frames | still_world, game_state, prev_state, map_cur, wl_state |
| save-boot-7f-world-kalm-cross | the same with Cross | the same |
| save-boot-7g-world-kalm-walk-out | 7c's presses into the field, field loads, Down 600, wait for the world map, 600, mark, Up 120 | load_done, w_world, map_cur, pc_lo, x_dir, z_dir |

What decides attempt 3:
- btn_ok 0 with btn_ctx 4 and pend ≥ 300 → the map-loading stall. Next: why blocks don't load (the CD read path, or a position with no block, since bank 4 is all zero at New Game); try exit action 2 or another entry point.
- btn_ok 1, move_req never 1 → `WmHandleButtons` doesn't request a move; look at sub_state and the entry state.
- 7g moves → the world map entered through a field exit is live: use that route for the acceptance check (the issue allows another route to a live world map).

## Attempt 2 results (`4b7604e`, tier2: 41 pass, 6 fail; the fails are the diagnostics)
| scenario | metrics |
|---|---|
| save-boot-7d-world-kalm-stream | **btn_ok 0, btn_ctx 3**, pend 0, stream 1, move_req 0, sub_state 0, queue_empty 1, x_dir 0 |
| save-boot-7e-world-kalm-circle | still_world 1, game_state 3, prev_state 0, map_cur 2, wl_state 1 |
| save-boot-7f-world-kalm-cross | still_world 1, game_state 3, prev_state 0, map_cur 2, wl_state 1 |
| save-boot-7g-world-kalm-walk-out | load_done 0 (the field never loaded: timeout), w_world 0, map_cur 2, pc_lo 0xA554, x_dir 0, z_dir 0 |
| attempt 1's four diagnostics | the same metrics as attempt 1 (a second run) |
| every earlier scenario | pass, unchanged |

Reading:
- **Not the map-loading stall:** no map blocks are queued and the stall counter is 0. But the world's button flag `D_800E55FC` **is 0**, last cleared by `func_800A2108(0, 3)`. No decompiled code passes 3, so the caller is in code that exists only as assembly (`WmHandleButtons`, `func_800A3C74`, the UI map functions and others). Only `func_800A2108(1, 3)` (or `(1, n)` after a 6) sets the flag again. The move request is never 1 while Up is held. This is the gate that holds the player.
- **Circle alone or Cross alone does not leave the world map** (7e, 7f). In 7g, after attempt 1's presses (Circle ×3, then Cross ×3) the game did *not* reach field mode without more input. So in attempt 1 (7c) it was the **Up after those presses** that ended in g_GameState 1, with the location still 2. The walk-out route was not reached.
- Leading hypothesis for attempt 3: a **message window** (the world map's `WmDialogUpdate` runs while `g_WindowData[0].state` is not INIT) is open after this boot and holds the player (reason 3). A choice in it would explain why Circle, Cross, then Up changed the mode.

The attempt 1 and 2 diagnostic scenarios are removed from the branch (their results are recorded here; their definitions are in commits `8b8eabb` and `4b7604e`), so Tier 2 runs only what attempt 3 needs.

## Attempt 3 plan (one Tier 2 push; the last in the budget)
`g_WindowData` is at 0x80083274 (`config/symbols.main.us.txt`), 0x30 bytes per window; `state` is at +0x2C (`include/game.h`), so window 0's state is at 0x800832A0.

| scenario | what | checks / reported |
|---|---|---|
| save-boot-7h-world-kalm-window | 600 frames, no input | no_win0 (window 0 closed), win0, win1, btn_ok, btn_ctx, wl_state |
| save-boot-7i-world-kalm-circle-walk | Circle ×4, 120 frames, mark, Up 120 | x_dir, z_dir (moved), world_ok; win0, btn_ok, btn_ctx |
| save-boot-7j-world-kalm-cross-walk | the same with Cross ×4 | the same |
| save-boot-7k-world-kalm-presses-state | attempt 1's presses, 60 frames, no D-pad | world_ok, game_state, wl_state, win0, btn_ok, btn_ctx |

If 7i or 7j moves, that becomes the live check in `save-boot-7-world-kalm` (with a rerun match). Otherwise the cause is recorded as far as the reachable sources allow, and the blockers are reported on #140.

## Attempt 3 results (`28be3b1`, tier2: 40 pass, 3 fail; the fails are diagnostics)
| scenario | metrics |
|---|---|
| save-boot-7h-world-kalm-window | **win0 6** (no_win0 0), win1 0, btn_ok 0, btn_ctx 3, wl_state 1, game_state 3 |
| save-boot-7i-world-kalm-circle-walk | win0 0, btn_ok 0, btn_ctx 0, **game_state 1** (world_ok 0), x_dir -1, z_dir -1 |
| save-boot-7j-world-kalm-cross-walk | win0 6, btn_ok 0, btn_ctx 3, game_state 3, x_dir 0, z_dir 0 |
| save-boot-7k-world-kalm-presses-state | **win0 0, btn_ok 1**, btn_ctx 3, wl_state 1, game_state 3 (pass) |
| every other scenario | pass, unchanged |

Reading:
- **Cause:** message window 0 is open 600 frames after the world map starts, in state 6 (WSTATE_TXT_DONE: its text is shown and it waits for OK), and the world's button flag is off (reason 3). The window holds the player. That is why the D-pad did nothing in #80 attempt 3 and in this issue's attempts 1 and 2. What the window says is not read: that would be game text.
- **Circle closes it; Cross does not** (7j: still open after four Cross presses). After three Circle presses (7k) the window is closed and the button flag is back on (btn_ok 1), still in the world map.
- **Then the D-pad works:** in 7i (and attempt 1's 7c), holding Up after the window closed ended in field mode. The entry point is outside Kalm, and walking onto a town on the world map enters it. So the world map is live; Up just leads into Kalm. The "position changes" in 7i and 7c are the overlay's memory being reused by the field, not movement.
- In 7i the button flag reads 0 again with reason 0: `func_800A2108(0, 0)` is what the decompiled field-exit requests call (`WmRequestFieldLoad`'s neighbours), which fits a town entry.

## Confirmation (the acceptance check)
Strictly this is not a fourth approach. It applies attempt 3's finding, as the issue asks ("adds a passing live check to `save-boot-7-world-kalm`").
- `save-boot-7-world-kalm`: after the 600 frames, three Circle presses one second apart, 60 frames, a mark, 60 frames of **Down+Left** (away from Kalm), 10 still. Checks: world_ok, map_ok, pc_ok (as before), **win_ok** (window 0 closed), **x_dir and z_dir** (pool element 7's pos.vx and pos.vz both changed since the mark; signs only), match (rerun). wm_id and prev_state are no longer reported, because of the 8-metric limit; #80 recorded their values (0 and 0).
- `save-boot-7h-world-kalm-window` now checks the cause as a passing scenario: window 0 open in state 6 (win_open), button flag 0 (btn_off), reason 3 (ctx_3), loop playing, rerun match.
- The other attempt 3 diagnostics are removed (results above; definitions in `28be3b1`).

Risks: a random battle within the 60 frames of walking (the rerun would still match, but world_ok would fail), or a diagonal blocked by terrain (one of x_dir/z_dir 0). Either would show in the metrics.

## Confirmation result (`1247393`, tier2: 40 pass, 0 fail)
| scenario | metrics |
|---|---|
| save-boot-7-world-kalm | w_state 400, world_ok 1, map_ok 1, pc_ok 1, **win_ok 1, x_dir -1, z_dir 1**, match 1 |
| save-boot-7h-world-kalm-window | **win_open 1, btn_off 1, ctx_3 1**, playing 1, match 1, win1 0, game_state 3 |
| every other scenario | pass, unchanged |

**The save-booted world map is live.** After the window is closed, 60 frames of Down+Left move the player actor: pos.vx decreased (Left) and pos.vz increased (Down), still in the world map at the same entry point, and a rerun matches. The cause is checked by its own scenario, which ran a second time with the same values as attempt 3.

## Outcome
- **Cause of #80's result:** a message window (`g_WindowData[0]`, state 6 = WSTATE_TXT_DONE) is open when the world map starts from these saves, and the world's button flag is off (reason 3) until it closes. Circle closes it; Cross does not.
- **Live check:** `save-boot-7-world-kalm` closes the window, walks Down+Left and checks both position signs (the issue's acceptance, first bullet).
- **What the window says is not known** (game text, not read). It may come from progress 6 being md1stin's value rather than a world map one. Not needed for the acceptance.
- **For #81 and the touch layer:** a world map reached from a save needs Circle before the pad moves the party. Walking Up from the Kalm entry point enters Kalm.
- **Not done:** a live check for Midgar (`save-boot-8`), not required. A semantic entry for the world position (the issue allowed one; nothing needs it yet).
- **Attempts:** 1 and 2 diagnostic; 3 found the cause; one confirmation run applied it.
