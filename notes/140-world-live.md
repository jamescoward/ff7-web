# #140: is the save-booted world map live?

Status (2026-11-09): attempt 1 (diagnostic) done; attempt 2 (diagnostic plus the walk-out route) pushed, waiting for Tier 2.

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
