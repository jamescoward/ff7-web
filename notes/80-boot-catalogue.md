# #80: boot points for the world map and a minigame

Status (2026-11-08): attempt 1 pushed, waiting for Tier 2.

## Sources (reference only; no code copied)
- **Xeeynamo/ff7-decomp @ `9411173034bde2ae4c9b0312167e79c3645ca1be`**:
  - `src/main/110B8.c`:
    - `InitFieldFromSavemap`: a loaded save sets `g_GameState` = savemap `current_module` (0x0B94) and the world map entry argument `D_80071E28` = `worldmap_exit_action` (0x0B90), and `g_FieldCurrentMap` = `current_location_id` (0x0B96). Any state is copied, not only field.
    - The main loop: state 3 runs the world map (`func_800112E8` → `WORLD_Main(&D_80071E28, &fieldId, …)`); states 6–11 and 14 load a minigame overlay and run it, then go back to field mode.
    - `func_800112E8`: unless the exit action is 2, it becomes 0 (or 1 after a battle) and the world map gets `g_FieldCurrentMap` as its entry point.
  - `src/field/field_main.c`: a field exit to a field ID 1–64 switches to the world map (state 3) with that ID. So a save with state 3, exit action 0 and location N should enter the world map exactly as a field exit to N does.
  - `src/world/world.c`:
    - `WORLD_Main`: with exit action 0, the map number is 0 (the main map) for entry points below 0x3C apart from 0x1E, 0x1F, 0x2A and 0x38.
    - `WmReadSavemap`: bank 4 bytes 0x80–0xFF must sum to 0 mod 256 (true at New Game: they are 0); with exit action 2 it restores the position saved in bank 4.
  - `src/mini/highway/highway.c`: the motorcycle minigame reads only bank 2 byte 0x73 (arcade mode; 0 = story) and bank 3 high score bytes from the savemap.
  - `include/game.h`: `GAMESTATE_*` values (3 world, 6 highway, 7 chocobo, 8 snowboard, 9 Fort Condor, 10 submarine, 11 speed square, 14 snowboard 2).
  - `config/symbols.highway.us.txt`: `g_HighwayTrackPos` 0x8011668C, `g_HighwayExit` 0x80110B88. `config/symbols.world.txt` and `world.c`: `D_800E5634` is the map number (`WmGetWmId`).
- **ff7-mods/ff7-flat-wiki @ `638936503b1c`**: `docs/FF7/Field/Field_ID.md` (wm0 = 0x01 "Outside Midgar", wm1 = 0x02 "Outside Kalm"), `docs/FF7/Savemap.md` (0x0B94 module: 1 field, 3 world map).

## Approach
No reachable source documents save-point positions or story-progress values (#38's deviation stands). Instead of walking out of a field to the world map, which needs a triangle next to an exit, the save itself names the state:

- **Generator** (`runner/savegen/`, `harness/schema/save.schema.json`): an optional `module: { state, exitAction }`. Left out, the save is a field save exactly as before (state 1, exit action 0); a Tier 1 test checks that only 0x0B90–0x0B95 and the checksum change when it is given. `harness/schema/` is outside the issue's allowed paths; it is needed for the new description field (this PR is full class anyway).
- **World map boot points**: state 3, exit action 0, location 2 (wm1, outside Kalm, the issue's suggestion) and 1 (wm0, outside Midgar), party Cloud, Barret, Tifa, progress 6 (md1stin's value; a hypothesis for the world map).
- **Minigame boot point**: state 6 (motorcycle), location md1stin, same party.

## Attempt 1 plan (one push)
| scenario | save | waits for | checks |
|---|---|---|---|
| save-boot-7-world-kalm | disc1-wm1-kalm | g_GameState 3 | still 3 after 600 + 90 frames (world_ok), location 2 (map_ok), rerun match |
| save-boot-8-world-midgar | disc1-wm0-midgar | g_GameState 3 | as above, location 1 |
| save-boot-9-highway | disc1-highway | g_GameState 6 | still 6 after 600 frames (mini_ok), g_HighwayTrackPos increased over the last 300 (live), rerun match |

Reported as well: wm_id (world overlay map number, expected 0), prev_state, the highway's exit flag.

What decides attempt 2: if the world map and highway scenarios pass, attempt 2 confirms gameState 3 and adds the minigame value 6 to `semantic/addresses.js` (and `mode()`), with these scenarios named. If a load times out (w_state 0), attempt 2 tries the other entry point / exit action 2, or the walk-out approach.

## Results
(pending)
