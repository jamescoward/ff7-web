# #25: context-aware Interact label (Labs flag `interact-label`)

Original project notes, GPL-2.0-or-later.

## What it does
With the flag on and the field controls shown, `web/js/interact-label.js` reads
`semantic.nearby()` (#112) at 4 Hz and relabels the field Interact button with
`interactLabel()` from `semantic/controls.js` (pure, no DOM). A tap still
presses Circle: only the text, a `data-interact` attribute and the
`field-dim` class change. Flag off, or the classic pad shown: no reads, and
the button is exactly as `field-controls.js` made it.

| nearby() result | Label |
|---|---|
| failed read, a `reason` (not in a settled field, out of range), or `confirmed: false` | Interact ○, not dimmed |
| confirmed, an NPC with `inRange` | Talk ○ |
| confirmed, no NPC in range, an exit with `inRange` | Exit ○ |
| confirmed, nothing in range (`unknown` models never count) | Interact ○, dimmed |

## Agent defaults (Trip mode rule 11)
- **Dimmed, not hidden** (from the refined contract): the layout never shifts, and a dimmed button still presses Circle (save points and chests are not reported by `nearby()`, so "nothing in range" is not proof Circle does nothing).
- **Talk beats Exit when both are in range**: Circle talks to an NPC in range; it never takes an exit (the player walks across the gateway line). The contract's "Exit when an exit is the closest thing in range" is read as "an exit is in range and no NPC is".
- **Unconfirmed results show the plain label, undimmed**: dimming would claim nothing is in range, which an unconfirmed read cannot say.

## What a real game shows today
`nearby()` is `confirmed: false` while `fieldZ`, `fieldTalkOff` and `fieldTalkRange` are hypotheses (`notes/112-field-interactables.md`). So in a real game the label stays plain Interact until #112's talk rule is confirmed in Tier 2. This is deliberate: the contract asks that a hypothesis is not shown as fact. Exits alone are not enough either, because the whole result carries one `confirmed` flag. A follow-up could split confirmation per entry kind.

## Tests
- Tier 1 unit: `runner/test/unit/semantic-interact-label.test.js` (every row above, both-in-range, over `nearbyFrom`, and no label text in the web module).
- Tier 1 browser: `web/test/interact-label-browser.test.js` (labels follow a fake `nearby()`, a tap on Talk sends Circle then release, flag off restores the button and stops reads, no reads with the classic pad). The iPhone-profile test picks up the new flag automatically.
- Tier 2: none needed (contract). Tier 3: deferred (#123).
