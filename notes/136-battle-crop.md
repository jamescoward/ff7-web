# #136: battle layout with the scene cropped (Labs flag `battle-crop`)

## What it does
Behind the Labs flag `battle-crop` (off by default): in a **confirmed** battle, in **portrait**, while the **`battle-panel`** flag is on too, the picture shows only the battle scene. That is the fixed rectangle `sceneRectFor('battle', …)` in `semantic/regions.js`, which leaves out the game's own command and status windows along the bottom. The picture box takes the crop's share of 4:3 (2:1 for 320×160 of 320×240), so it gets shorter. The freed height goes to #133's status strip and #116's command panel, which already sit below the picture in portrait. Everywhere else the full frame is shown, and the page redraws the last frame at once when the answer changes, even while paused.

## Where the FF7 knowledge lives
- `semantic/regions.js` (platform-neutral, synced to `web/js/semantic/`): `SCENE_REF` (320×240), `SCENE_REGIONS` (one row per `mode()` label; only `battle` has a rectangle), `MIN_SCENE_SHARE` (0.5) and the pure function `sceneRectFor(mode, confirmed, w, h)`. The rectangle scales with the frame size; a crop that would keep less than half the width or height is refused.
- `web/js/battle-crop.js` holds no pixel coordinates. It polls `mode()` at 4 Hz (the same read-only view as `border-crop.js`), decides whether the crop applies, and asks `semantic/` for the rectangle.
- `web/js/main.js` draws it through the same `drawCropped` path as the border crop (#24). In battle the scene crop wins over the border crop. `<html data-battle-crop-on>` is set while it applies.

## Decisions (agent defaults, Trip mode rule 11, 2026-11-21)
1. **The rectangle is a hypothesis, not measured on the disc:** keep rows 0–159 of a 320×240 frame at full width. If the game's windows start lower than row 160, part of the scene is lost; if higher, a sliver of window shows. Tier 3 checks it (checklist items 1 and 2). A later Tier 2 probe could return only the row where the window border starts.
2. **It needs `battle-panel`.** Without the page's panel, hiding the game's command window would leave the player with no visible commands. So the crop applies only while both flags are on. The panel shows generic labels ("Command 1" to "Command 4", #116), so with the crop the command names are no longer visible anywhere. That is a Tier 3 question: is it usable?
3. **Landscape (#235, 2026-11-21; was portrait only).** The picture keeps the full frame's width (4:3 at full height), so the 2:1 crop makes it two thirds as tall, and it sits at the top. The panel is one row of four 44 px buttons in the band that frees below it, between the d-pad and the face buttons, and above Start/Select. Its left and right edges come from the pad's own CSS sizes (`--gap`, `--dpad`, `--face`), plus the safe-area insets when `safe-layout` insets the pad; its top from `--screen-aspect`. So `web/css` holds no region pixels. The status strip stays where #166 put it, over the upper scene. Measured in Chromium: the band is 58 px (browser profile, safe-layout) to 87 px tall, and the row 350 px (browser) to 468 px (standalone) wide. Outside a cropped battle the panel stays hidden in landscape, as before. Without `safe-layout`, the landscape browser profile already overflows by 17 px (Start/Select, pre-existing); the panel adds none.
4. **The crop doesn't follow the panel's visibility.** The panel shows only while a command menu or target selection is open. Cropping only then would make the picture jump every turn. So the crop holds for the whole confirmed battle.

## Tests
- `runner/test/unit/semantic-battle-scene.test.js` (new): the table covers every `mode()` label; only battle has a rectangle; the table is frozen; the rectangle is inside the frame; scaling over 7 frame sizes; every other mode, unconfirmed, odd labels (`__proto__`, `toString`) and bad sizes give null.
- `web/test/battle-crop-browser.test.js` (new; Chromium + WebKit, iPhone 14 Pro profiles; stubbed backend, fake `mode()` and semantic sources):
  - flag off: no poll, full frame, 4:3;
  - crop flag without `battle-panel`: full frame;
  - both on, portrait: scene only (320×160 canvas, 2:1 box, shorter picture), and the strip and panel sit below the picture with no overlap, ≥44 px buttons and no horizontal scroll;
  - leaving the battle (field, menu, movie, world, unknown, unconfirmed battle, failed read): full frame at once with no new frame posted, then the scene again on return;
  - either flag off mid-battle: full frame at once;
  - landscape (#235; standalone and browser profiles, `safe-layout` off and on): the scene crop, the panel in one row below the picture in both views, ≥44 px buttons inside the viewport, clear of the picture, the top bar, the strip and every pad control, and no scroll added;
  - landscape: leaving the battle restores the full-frame box at once and hides the panel;
  - turning mid-battle keeps the scene; the panel switches between two rows below the strip (portrait) and the landscape row;
  - with `border-crop` on too: the scene rectangle wins in battle;
  - with `safe-layout` on: the panel stays below the picture, no horizontal scroll.
- `web/test/iphone-profile.test.js` covers every registered flag, so it runs its layout checks with `battle-crop` on.
