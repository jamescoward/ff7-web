# #134: drag to walk on the world map (Labs flag `world-drag`)

## What it does
With the Labs flags `auto-controls` (#113) **and** `world-drag` both on, a
confirmed world-map mode (`mode()` → `world`, gameState 3, confirmed by #80)
shows drag-to-walk instead of the classic pad. The drag surface is the same
`field-controls.js` / `field-drag.js` one used in the field, so the pad bits
are identical (a Tier 1 test compares them, direction by direction). Battle,
menu, minigame, movie, unknown and unconfirmed modes still get the pad. With
`world-drag` alone nothing polls: the flag only widens `auto-controls`'
policy, so turning it on cannot change the default behaviour.

Toggling `world-drag` while already on the world map applies at the next poll
(4 Hz): the policy changed, so the same mode is re-applied once.

The Controls button still overrides until the next mode change, which is how
world-map buttons the field controls lack (camera, map) stay reachable.

## Where the policy lives
`controlsForMode(sample, { worldDrag })` in `web/js/auto-controls.js`, next
to #113's field rule. The contract's allowed paths exclude `semantic/`, and
the rule only picks a web layout from `mode()`'s mode names; it holds no
addresses, regions or pad sequences. If a native frontend needs the same
"walkable modes" list, moving it to `semantic/controls.js` is a small
follow-up.

## Evidence (Tier 1)
- `node --test web/test/auto-controls-unit.test.js`: 15 pass (policy, polling
  with the flag on, off, alone, and toggled in the world map).
- `node --test web/test/auto-controls-browser.test.js`: Chromium 7 pass
  (3 new: world with the flag on shows drag-to-walk with the same eight
  direction bits as the field; the Controls override holds on the world map;
  flag off → the pad). WebKit is not installed in the agent container; CI's
  `web` job runs it.
- `web/test/iphone-profile.test.js` covers every registered flag, so it now
  includes `world-drag` (Chromium passed locally).

## Not verified
- Whether drag directions feel right relative to the world-map camera. The
  world map's camera rotates; the drag sends screen-relative D-pad bits, as
  the classic pad does. #140 showed Down+Left moves the player, nothing more.
- Whether Interact ○ / Menu △ / Back ✕ mean the same on the world map as in
  the field (labels unchanged, a source-free assumption). Tier 3 deferred.
