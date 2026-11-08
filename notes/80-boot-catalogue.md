# #80: boot points for the world map and a minigame

Status (2026-11-08): done, with one part split off. All three boot points load (attempt 1, three Tier 2 runs). gameState 3 (world) and 6 (minigame) are confirmed, and the motorcycle race is live. **The world map is not shown to be live**: attempt 3's check that the player actor moves under the pad failed. That part moved to #140.

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

### Attempt 1 (`417c75c`, tier2: 39 pass, 0 fail)
| scenario | metrics |
|---|---|
| save-boot-7-world-kalm | **w_state 400**, **game_state 3**, **world_ok 1**, **map_cur 2, map_ok 1**, **wm_id 0**, prev_state 0, match 1 |
| save-boot-8-world-midgar | **w_state 400**, **game_state 3**, **world_ok 1**, **map_cur 1, map_ok 1**, **wm_id 0**, prev_state 0, match 1 |
| save-boot-9-highway | **w_state 400**, **game_state 6**, **mini_ok 1**, **live 1**, exit 0, prev_state 0, match 1 |
| the 36 earlier scenarios | pass, unchanged |

Reading:
- **The game accepts a save with any module state.** g_GameState reads the description's state 400 frames after the title snapshot, the same frame as a field save (#38's w_field 400).
- **World map:** it still reads 3 after 690 more frames, including 60 frames of Up. The entry point (location) stays as the save named, and the world overlay's map number reads 0 (the main world map), as `WORLD_Main` predicts for entry points 1 and 2. prev_state 0: the first mode after a load has no previous mode.
- **Motorcycle minigame:** it still reads 6 after 600 frames, and `g_HighwayTrackPos` increased over the last 300: the race is running. g_HighwayExit is 0.
- **Deterministic:** match 1 in all three (a rerun from the title snapshot ends in the same RAM and picture).
- **Not yet shown for the world map:** that it is live (the pad moves the party). The state holding and the overlay's own variable reading 0 show that the world module runs, not that the party moves. Attempt 2 checks this.

### Attempt 2 plan
- `semantic/addresses.js`: gameState 3 (world) is confirmed by `save-boot-7-world-kalm`, and a new label 6 = `minigame` is confirmed by `save-boot-9-highway`. `mode()` reports `minigame` for 6. Other minigame states stay unlabelled (`unknown`). Two existing unit tests that listed the confirmed values are updated to match (3 and 6 move from unconfirmed to confirmed; 7 is still unknown). `web/js/semantic/` is re-synced (`node semantic/sync-web.js`).
- `save-boot-7-world-kalm` (diagnostic): the world overlay's player actor pointer `D_8010AD40` (low half, `pc_lo`) and the sign of the change of pos.vx/vz of actor pool elements 0-2 over the walk (`D_80109F34[i]`, 0xE0 bytes each, pos at +0x0C/+0x14). The pool is a free list handed out from element 0, so the player should be an early element; the one `pc_lo` names should move, the others need not, so their checks may fail. If the player's element moves, attempt 3 turns it into the acceptance check (the world map's "live" check) and drops the others.

### Attempt 2 (`635cf52`, tier2: 38 pass, 1 fail; the fail is the diagnostic)
| scenario | metrics |
|---|---|
| save-boot-7-world-kalm | **pc_lo 42324 (0xA554)**, x0..z2_dir all 0, match 1 |
| save-boot-8-world-midgar, save-boot-9-highway | as attempt 1 (every metric equal) |
| every other scenario | pass, unchanged |

Reading:
- The player actor pointer's low half is 0xA554 = 0x9F34 + 7 × 0xE0: **pool element 7**, exactly on an element boundary, so the pointer reading is consistent with the decomp's layout. Elements 0-2 did not move: they are other actors (or unused).
- The semantic confirmations (gameState 3 and 6) passed the unit and Tier 1 checks. The Midgar and motorcycle scenarios repeat attempt 1's metrics exactly, a second Tier 2 run.

### Attempt 3 plan
`save-boot-7-world-kalm` becomes the world map's acceptance check: pc_ok (D_8010AD40 names element 7), and element 7's pos.vx and pos.vz both change over 60 frames of Up then 60 of Right (x_dir, z_dir), plus world_ok, map_ok, match, wm_id and w_state as in attempt 1.

### Attempt 3 (`574ce89`, tier2: 38 pass, 1 fail)
| scenario | metrics |
|---|---|
| save-boot-7-world-kalm | w_state 400, world_ok 1, map_ok 1, **pc_ok 1**, wm_id 0, match 1, **x_dir 0, z_dir 0** (fail) |
| every other scenario | pass, unchanged |

Reading:
- The player actor pointer names element 7 again (a second run), so the world module sets it deterministically.
- **Element 7's pos.vx/vz did not change** over 60 frames of Up and 60 of Right, starting 600 frames after the state read 3. Either the world map isn't taking input yet in this state (a fade, an event, a script lock; progress 6 is md1stin's value, not a world map one), or the party's position lives elsewhere (altPos, or a value updated elsewhere). Not resolved here.

## Outcome
- **Generator:** an optional `module: { state, exitAction }` in save descriptions. A save can start in the world map at a named entry point, or directly in a minigame. Without it, the output is unchanged (Tier 1).
- **Boot points:**
  - `disc1-wm1-kalm`: world map, outside Kalm.
  - `disc1-wm0-midgar`: world map, outside Midgar.
  - `disc1-highway`: the motorcycle minigame.

  All three load 400 frames after the title snapshot (as a field save does) and rerun deterministically.
- **Confirmed:**
  - gameState 3 = world (`save-boot-7-world-kalm`; Midgar agrees). The state holds for 690+ frames, the world overlay's map number reads 0 and its player pointer is set.
  - gameState 6 = minigame, the motorcycle game (`save-boot-9-highway`). The state holds and `g_HighwayTrackPos` advances.
  - `mode()` reports `minigame` for 6. Other minigame states (7-11, 14) stay `unknown` until a scenario sees them.
- **#38's three checks for these boot points:**
  - ID: the location the save named stays, checked.
  - Position: the world map has no walkmesh triangle; the player actor pointer is checked instead.
  - Live: shown for the motorcycle game (track advances); **not shown for the world map** (#140).
- **Deviations:**
  - None of these is a save point: no reachable source documents save points or progress values (#38's deviation).
  - Progress 6 is md1stin's value.
  - The minigame boot point starts the minigame directly from the save, rather than standing at a save point next to a minigame entry, as the issue suggested.
- **Out of contract:** `harness/schema/save.schema.json` (the new field) and `web/js/semantic/` (the synced copy).
- **Attempts:** 1 succeeded (loading). 2 was a diagnostic that found the player actor. 3 failed (world map live). The world map live check moved to #140, per the split rule, rather than spending a fourth Tier 2 run in this PR.
