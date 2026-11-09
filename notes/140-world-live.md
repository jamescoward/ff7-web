# #140: is the save-booted world map live?

Status (2026-11-09): attempt 1 (diagnostic) pushed, waiting for Tier 2.

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
