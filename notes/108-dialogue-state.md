# #108: dialogue window state (open, waiting, choice cursor)

Status (2026-11-11): attempt 1 pushed, Tier 2 pending.

## Sources (reference only; no code copied)
Xeeynamo/ff7-decomp @ `d4db3de3c3aaf61269e048cf3f6a458996290de0`:
- `config/symbols.main.us.txt`: `g_WindowData = 0x80083274` (size 0xC0: four windows), `g_WindowToEntity = 0x8008326C`.
- `include/game.h`: `WindowData` is 0x30 bytes. Offsets worked out from the field order: `pointerEnabled` u8 at +0x1A, `pointerY` s16 at +0x26, `state` s16 at +0x2C (#140 already used +0x2C), `preventClose` at +0x2E. `enum WindowState`: 0 INIT (no window), 1 SHOW, 2 TXT (typing), 3 PAUSE_TXT, 4 WAIT_ROW, 5 UNK5, 6 TXT_DONE, 7 CLOSING, 8 SCROLL_ROW, 9 INIT_NEXT, 10 UNKA, 11 PAUSE_TXT_SCROLL_UNTIL_OK, 12 SCROLL_TXT_WHILE_OK, 13 PAUSE_TXT_UNTIL_OK, 14 WAIT_NEXT_WINDOW.
- `src/field/field_dialog.c`:
  - `FieldDialogMessageUpdateStates` (opcode `mes`): TXT_DONE closes on Circle; WAIT_ROW, PAUSE_TXT_UNTIL_OK, PAUSE_TXT_SCROLL_UNTIL_OK and WAIT_NEXT_WINDOW also advance only on Circle. These five are "waiting for Circle".
  - `FieldDialogAskUpdateStates` (opcode `ask`, a choice): in TXT_DONE, unless `preventClose & 1`, it sets `pointerEnabled = 1`, moves `selectedLine` with Up/Down between the opcode's first and last lines, and sets `pointerY = selectedLine * 16 + 6`. Circle picks (CLOSING). While closing, `pointerEnabled` blinks (toggles each frame) and is 0 once closed.
  - `src/field/field_opcodes.c` `OpcodeFuncAsk`: `selectedLine` itself lives in a script variable (bank 2), so the window's `pointerY` is the place a reader can find it without knowing the script.

## The reader
`semantic/addresses.js`: `dialogState` (window 0 state), `dialogPointer`, `dialogPointerY`; all hypotheses until Tier 2 confirms them. `semantic/layer.js` `dialogue()` → `{ open, waiting, choice: null | { row } }`:
- open: state ≠ 0;
- waiting: state in {4, 6, 11, 13, 14};
- choice: state 6 and pointerEnabled 1; row = (pointerY − 6) / 16, the line in the window (a question line above the options makes the first option row 1; the reader can't know the script's first line).

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
