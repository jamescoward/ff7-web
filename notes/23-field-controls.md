# Issue #23: field controls

## Implementation

- Classic gamepad is the default. The top-bar **Drag to walk** / **Gamepad**
  toggle remembers the selected mode in `ff7-web-control-mode`; both reading
  and writing localStorage tolerate denied access.
- A touch anywhere in the field control area except an action button establishes
  a fixed origin. A faint dot marks that point, fading over 250 ms after release.
  Only one finger owns the joystick. Other fingers can hold actions independently.
- `field-drag.js` maps screen-space vectors to eight digital directions. The dead
  zone is 10 CSS pixels. The current sector remains selected until the thumb
  crosses its 22.5-degree edge by another 6 degrees. At 64 CSS pixels, Cross is
  added to the direction mask; retreating below 64 releases it.
- Interact = Circle; Menu = Triangle; Back = Cross. An action finger can slide
  between buttons or off them to release, but never becomes a walking finger.
- The existing input mixer combines field controls with keyboard input. Switching
  modes releases both touch controllers, preserving held keyboard input. Pointer
  cancellation, lost capture, blur, resize and page hiding release held touch.
- The classic gamepad implementation and existing tests are unchanged. Production
  field controls only emit pad masks; they neither inspect nor write game memory.

## Tier 1 coverage

`node --test 'web/test/*.test.js' 'web/bench/test/*.test.js'`

The new unit tests cover eight sectors, dead-zone entry/exit, hysteresis in both
directions including angle wrap, running/retreat and release. New Playwright
tests exercise the full page with a fake backend in Chromium and WebKit:
circle drags, multitouch Interact, buttons and sliding, cue placement/fade,
pointer cancellation, independent fingers, mode persistence, denied storage,
release on interruption, portrait/landscape target sizing, and real capture.
A separate real-core test boots the original `pad-echo` homebrew through the
file picker and asserts an upward drag produces active-low `0xffef` in PS1 RAM,
then `0xffff` after release. No FF7 data is used.

CI runs these files automatically through the existing `web` job. A missing
local browser/core is a reported skip, never evidence of passing behavior.

## Tier 3: hypotheses for the owner's iPhone

The screen-space direction mapping, Circle-confirm / Cross-cancel mapping,
Cross-to-run behavior and threshold feel have not been verified in FF7 here.
The complete device checklist is:

1. Check screen-relative directions on 2–3 fields.
2. Drag farther to run; check the transition feels right.
3. Open and close the menu with Menu / Back.
4. Talk to an NPC and open a door with Interact.
5. Compare overall feel with the classic gamepad using the top-bar toggle.

Use the classic gamepad for battles and minigames. Automatic mode detection
remains #25. Do not merge before the owner's Tier 3 result and the required
reviewer verdict and CI checks.
