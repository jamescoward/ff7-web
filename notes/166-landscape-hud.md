# 166: battle status strip in landscape (Labs flag `battle-hud`)

**Decision** (owner, 2026-11-18): option 2, a compact, translucent strip overlaid on the picture. The details below are the implementer's choices: the owner delegated landscape layout (`docs/decisions/2026-11-18-defaults-over-owner-decisions.md`).

## What was measured (Chromium, iPhone 14 Pro landscape profiles of #106)
The picture is not free of controls along its top, so the strip can't sit flush with it:
- the top bar's buttons sit at y 6..50, across much of the picture's width;
- the shoulder buttons sit at y 40..112 at its sides;
- the pad reaches well into the picture: the d-pad's right edge is at x 168..286 (depending on flags and insets), and the face buttons start at x 542 (picture 164..688 at 852x393).

The clear space is a centred column below the top bar.

## Layout
- In landscape, `#hud` is `position: absolute` (the same containing block as the pad and the top bar).
  - Placement: top = safe-area top + 56 px, just below the top bar; centred, `width: min(240px, 100%)`, 58 px tall.
  - Look: 3 rows of 17 px, 10 px text, 3 px bars, background `#000000a6`.
  - `pointer-events: none` as before.
- It covers part of the upper battle scene. FF7's own help and target-name window sits at the very top of the picture, which our top bar already covers.
- Measured: 306,56 240x58 (852x393, insets) and 247,56 240x58 (734x343, Safari). No overlap with any control, and the widest numbers fit (9999/9999 HP, 999/999 MP).

## Tests
`node --test web/test/battle-hud-browser.test.js`: the landscape layout tests now check that the strip shows in battle, lies inside the picture and in its upper half, takes no touch, stays inside the viewport, overlaps no control, and fits the widest numbers. Portrait tests also use the widest numbers now. Chromium passes locally; WebKit runs in CI only (not installed in agent containers).

## Not verified (Tier 3)
On a real iPhone in a real battle:
- Is the strip readable over a bright scene?
- Does it hide anything that matters (an enemy at the top of the scene)?
- Does it clash with the game's top window when a long battle message shows?
