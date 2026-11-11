# 113: automatic controls (Labs flag `auto-controls`)

Default off. With it on, when the game's `mode()` changes the page shows drag-to-walk
in the field and the classic pad in battle, menu, world map, minigame, movie, unknown
and unconfirmed modes. With the semantic gate closed (not the USA disc) nothing
switches. With the flag off the page behaves as before.

## Design
- `web/js/auto-controls.js`: `controlsForMode(sample)` (UI policy over mode names) and
  `createAutoControls`, which polls `semantic.mode()` at 4 Hz (never overlapping) only
  while the flag is on, the gate is active and a backend exists. It calls
  `controls.setAuto(target)` only when the mode name changes; the first sample after
  (re)starting counts as a change. Turning the flag off or closing the gate stops
  polling and leaves the controls as they are. The main-thread semantic layer is built
  lazily over `backend.readMem`.
- `controls.setAuto(target)`: releases held input if the layout changes, shows the
  layout, does not write the saved preference. The Controls button is unchanged and
  persists its choice; since `setAuto` runs only on a mode change, a manual override
  holds until the next change.
- Tests can drive it with `window.ff7web.autoControls.setSource(asyncFn)`.

## Tests
- `node --test web/test/auto-controls-unit.test.js` (no browser)
- `node --test web/test/auto-controls-browser.test.js` (Chromium + WebKit, stubbed backend, no core needed)
- `web/test/iphone-profile.test.js` already runs every registered flag, so it covers this one.

## Not verified
Real-game mode switching needs Tier 3 on the owner's iPhone: walk in the field, enter
a battle, leave it, open the menu, and check the pad/drag layout follows, and that the
Controls button holds until the next change. Mode flicker during scene transitions is
unmeasured on a real disc.
