# #108: dialogue window state (open, waiting, choice cursor)

Status (2026-11-11): **open and waiting confirmed** (attempt 1); the choice cursor is split to #168 (no choice window reachable yet). Attempts used: 1 of 3.

## Sources (reference only; no code copied)
Xeeynamo/ff7-decomp @ `d4db3de3c3aaf61269e048cf3f6a458996290de0`:
- `config/symbols.main.us.txt`: `g_WindowData = 0x80083274` (size 0xC0: four windows), `g_WindowToEntity = 0x8008326C`.
- `include/game.h`: `WindowData` is 0x30 bytes. Offsets worked out from the field order: `pointerEnabled` u8 at +0x1A, `pointerY` s16 at +0x26, `state` s16 at +0x2C (#140 already used +0x2C), `preventClose` at +0x2E. `enum WindowState`: 0 INIT (no window), 1 SHOW, 2 TXT (typing), 3 PAUSE_TXT, 4 WAIT_ROW, 5 UNK5, 6 TXT_DONE, 7 CLOSING, 8 SCROLL_ROW, 9 INIT_NEXT, 10 UNKA, 11 PAUSE_TXT_SCROLL_UNTIL_OK, 12 SCROLL_TXT_WHILE_OK, 13 PAUSE_TXT_UNTIL_OK, 14 WAIT_NEXT_WINDOW.
- `src/field/field_dialog.c`:
  - `FieldDialogMessageUpdateStates` (opcode `mes`): TXT_DONE closes on Circle; WAIT_ROW, PAUSE_TXT_UNTIL_OK, PAUSE_TXT_SCROLL_UNTIL_OK and WAIT_NEXT_WINDOW also advance only on Circle. These five are "waiting for Circle".
  - `FieldDialogAskUpdateStates` (opcode `ask`, a choice): in TXT_DONE, unless `preventClose & 1`, it sets `pointerEnabled = 1`, moves `selectedLine` with Up/Down between the opcode's first and last lines, and sets `pointerY = selectedLine * 16 + 6`. Circle picks (CLOSING). While closing, `pointerEnabled` blinks (toggles each frame) and is 0 once closed.
  - `src/field/field_opcodes.c` `OpcodeFuncAsk`: `selectedLine` itself lives in a script variable (bank 2), so the window's `pointerY` is the place a reader can find it without knowing the script.

## The reader
`semantic/addresses.js`: `dialogState` (window 0 state; **confirmed**, values 0 and 6), `dialogPointer`, `dialogPointerY` (hypotheses, #168). `semantic/layer.js` `dialogue()` → `{ open, waiting, choice: null | { row } }`:
- open: state ≠ 0;
- waiting: state in {4, 6, 11, 13, 14};
- choice: state 6 and pointerEnabled 1; row = (pointerY − 6) / 16, the line in the window (a question line above the options makes the first option row 1; the reader can't know the script's first line). Reported only from confirmed entries, as `partyStatus` does: until #168 confirms the pointer entries, `choice` is always null.
- confirmed: the state read is a confirmed value (0 or 6). Typing, closing and the other waiting states read `confirmed: false`.

Only window 0 is read. Field scripts can use windows 1-3 too; whether the touch layer needs them is open.

## Where a window is known to open
- #140: the world map loaded from `disc1-wm1-kalm` has window 0 in state 6 after 600 frames; Circle closes it (three presses were used), Cross does not. The world module runs its own dialog code (`WmDialogUpdate`) over the same `g_WindowData`.
- The opening's spoken lines: none measured yet. `reactor-next-0-after-battle` and the opening segment press Circle every second, which would have advanced any window.

## Attempt 1 plan (one Tier 2 push)
| scenario | what | checks / reported |
|---|---|---|
| save-boot-12a-dialog-world-entry (diag) | Kalm save, until g_GameState 3, nothing more | win0, ptr_en, win1 at world entry |
| save-boot-12b-dialog-world-open | then wait win0 = 0, then open (1..14), then 6 | closed_wait, open_wait, done_wait (frames open but not waiting); **waiting** (6), world_ok, match; ptr_en |
| save-boot-12c-dialog-world-circle | as 12b, one Circle, wait until state ≠ 6, 30 frames, then Circle every 60 until 0 | left_wait, close_wait, **closed**, world_ok, match |
| reactor-next-4-dialog-after-battle (diag) | from `battle`, Circle until field, then no input until win0 opens and reaches 6 | open_wait, done_wait, waiting, match, ptr_en, win1, map_cur |

What the results decide:
- 12b/12c pass → dialogOpen (0 → open) and dialogWaiting (6, then drops after Circle) confirmed on the world window.
- 12a reads 6 already → the window opens before world mode; 12b's closed_wait times out and needs another start.
- reactor-next-4 opens a window → field dialogue at the opening is reachable; a choice can be searched for from there.
- ptr_en 1 anywhere → a choice window to check Down/Up on.

## Attempt 1 results (`d19a888`, tier2: 51 pass, 1 fail; the fail is a diagnostic)
| scenario | metrics |
|---|---|
| save-boot-12a-dialog-world-entry (diag) | world_ok 1, **win0 0**, ptr_en 0, win1 0 |
| save-boot-12b-dialog-world-open | **closed_wait 1, open_wait 475, done_wait 110, waiting 1**, world_ok 1, match 1, ptr_en 0 |
| save-boot-12c-dialog-world-circle | closed_wait 1, open_wait 475, done_wait 110, **left_wait 1, close_wait 1, closed 1**, world_ok 1, match 1 |
| reactor-next-4-dialog-after-battle (diag) | **open_wait 0 (timeout)**, done_wait 0, waiting 0, match 0, ptr_en 0, win1 0, map_cur 116, game_state 1 |
| every other scenario | pass, unchanged |

Reading:
- **dialogOpen 0 → 1:** window 0 is closed when world mode starts (12a, and 12b's first wait ends at once) and opens 475 frames later, with no input.
- **dialogWaiting:** for 110 frames the window is open but not in state 6 (its text is typing), then it reads 6 and holds there. After one Circle press (held 4 frames) it is out of 6 on the first frame checked (left_wait 1). In this run the close wait still pressed Circle on its first frame (close_wait 1), so this run does **not** show that one press closes the window (reviewer finding on `3d04a93`). It is a plain message: pointerEnabled 0 in state 6.
- Reruns from the same start match in 12b and 12c.
- **No field window after the first battle:** in md1stin (0x74), 1800 frames without input after the battle's end, window 0 never opened. The opening's spoken lines are elsewhere (before reactor-entrance, where the opening segment presses Circle every second).
- **No choice window:** none was reached. The issue's choice acceptance needs one; finding one is split to #168 (CONTINUITY: finish a coherent slice, file the rest).

Kept as acceptance checks: 12b and 12c. Removed: 12a and reactor-next-4 (this PR's own diagnostics; results above, definitions in `d19a888`). The Tier 2 run on the final push is the second run of 12b and 12c (the issue asks for two).

## Outcome
- `dialogState` confirmed (values 0 and 6); `dialogue()` gives open and waiting, confirmed for those values.
- `dialogPointer`/`dialogPointerY` stay hypotheses; `dialogue().choice` is null until #168.
- For the touch layer: in the world map from `disc1-wm1-kalm`, a message window opens about 475 frames after world mode starts and waits for Circle 110 frames later. One Circle closes it (re-measured below).

## Re-measurement of 12c (reviewer finding, round 1)
The review of `3d04a93` found the "one Circle closes it" claim unsupported: 12c's close wait pressed Circle every 60 frames from its first frame. 12c now presses Circle once (4 frames) and then waits with **no input** until the state leaves 6 (left_wait) and until it reads 0 (close_wait, timeout 300: a timeout fails the scenario). The description's promised `win0_after` reading is gone (it was never a metric). This is a corrected measurement of attempt 1, not a new approach.

### Result (`a3e96b6`, tier2: 50 pass, 0 fail)
| scenario | metrics |
|---|---|
| save-boot-12b-dialog-world-open | closed_wait 1, open_wait 475, done_wait 110, waiting 1, world_ok 1, match 1, ptr_en 0 (the same in all three runs: `d19a888`, `3d04a93`, `a3e96b6`) |
| save-boot-12c-dialog-world-circle | closed_wait 1, open_wait 475, done_wait 110, **left_wait 1, close_wait 3**, closed 1, world_ok 1, match 1 |

**One Circle press closes the window:** with no input after the 4-frame press, the state is out of 6 on the first frame checked and reads 0 three frames later. (On `3d04a93`, with the old Circle-every-60 close wait, 12c read close_wait 1, as on `d19a888`.) The state between 6 and 0 was not read individually; field_dialog.c says CLOSING (7).
