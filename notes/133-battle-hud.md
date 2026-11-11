# 133: battle status strip (Labs flag `battle-hud`)

Default off. With it on, the USA-disc gate open and a confirmed battle (`mode()`
reads `battle`, confirmed), a strip below the picture shows one row per party
slot: HP and MP as `value/max` with bars, ATB and limit as percentages with bars.
Labels are "Slot 1/2/3"; no names are read or committed.

## Design
- `semantic/party-gauges.js` (pure, platform-neutral): `partyGauges(status)` turns
  a `partyStatus(slot)` value (#130) into bars. ATB is out of 0xFFFF (the decomp's
  BattleTurnWork atbGauge "saturates/compares at 0xFFFF"), limit out of 255 (limitBar
  capped at 255; wiki: 0xFF = limit break). `full` marks a full ATB or a ready limit.
  A null value (unconfirmed or unread) gives a null bar.
- `web/js/battle-hud.js`: polls `mode()` and, in battle only, `partyStatus(0..2)` at
  4 Hz, never overlapping, only while the flag is on, the gate is active and a
  backend exists (its own semantic instance over `backend.readMem`, like #113).
  `hudRows` drops empty slots, unconfirmed slots (`confirmed: false`) and slots with
  no confirmed value; a null field leaves its column empty (visibility hidden, so the
  columns stay aligned). A failed mode read leaves the strip as it is; any other mode
  hides it. Sets `<html data-hud-on>` while shown.
- Layout: `#hud` sits in `.stage` between the picture and the pad, fixed height
  `--hud-h` (84 px), so rows coming and going never move the pad. It never takes a
  touch (`pointer-events: none`). With `safe-layout` the picture's height budget
  subtracts `--hud-h`, so the whole pad still fits (Safari portrait: the picture
  shrinks to about 197x148 CSS px while the strip shows).
- **Landscape: hidden.** The pad's halves already sit over the picture's edges on an
  iPhone in landscape (852x393: picture 164..688, face buttons from 660), so there is
  no free space beside the picture. Placing it there needs a decision (shrink the
  picture, or overlay it): follow-up issue.
- Tests drive it with `window.ff7web.battleHud.setSource({ mode, partyStatus })`.

## Tests
- `node --test runner/test/unit/semantic-party-gauges.test.js` (ranges, clamping, nulls)
- `node --test web/test/battle-hud-unit.test.js` (policy, rows, lifecycle; no browser)
- `node --test web/test/battle-hud-browser.test.js` (Chromium + WebKit, stubbed backend):
  battle-only display, values follow the source, unconfirmed/empty left out, flag off
  and the Labs panel toggle; iPhone 14 Pro portrait and landscape, Home Screen and
  Safari, with `battle-hud`, `+safe-layout`, `+auto-controls`: strip below the
  picture, inside the viewport, overlapping no control, numbers fit; with
  `safe-layout` every control above the fold and no scroll; landscape hidden.
- `web/test/iphone-profile.test.js` runs every registered flag, so it covers this one
  (the strip is hidden there: no battle source).

## Not verified
Tier 3 (owner's iPhone): in a real battle, are the numbers readable in portrait, and
do they match the game's own? Is the smaller picture with `safe-layout` acceptable?
`battle-panel` (#116) has not merged, so the strip has not been checked beside it.
Read cost: one mode() plus up to 3 × 7 reads per tick at 4 Hz through the worker;
not measured on a device.
