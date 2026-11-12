# #114 slice: tap to advance dialogue

Labs flag `dialogue-taps` (off by default). When the game's message window
waits for Circle, a tap on the picture presses Circle once.

## Design
- `semantic/controls.js` (copied to `web/js/semantic/`): plain data
  `DIALOGUE_ACTIONS` and the pure `dialogueTapButton(sample)`: `'circle'` only
  for a confirmed `dialogue()` sample with `waiting === true`, else `null`.
  Field meanings (#146) will join this module.
- `web/js/dialogue-taps.js`: listens for a tap (pointerdown/up within 12 px and
  500 ms) on the `#screen` canvas. At tap time it makes a fresh `dialogue()`
  read (a failed or unconfirmed read sends nothing), asks `dialogueTapButton`,
  sets the `dialogue-taps` mixer source to that PAD bit and releases it after
  100 ms. Taps during a press are ignored: one press per tap. It polls
  `dialogue()` at 4 Hz only while flag, gate and backend/source are present;
  the polled sample is informational, the tap always re-reads.
- Which element: the canvas only. The status line, debug overlay, pad and the
  `#field` drag surface are separate elements, so a drag on `#field` never
  reaches the tap listener and drag-to-walk and the classic pad are unchanged.
  Where `#field` overlays the picture (landscape) a tap there is a drag-surface
  touch, not a dialogue tap; that is a known limit to check on the device.
- Input only: no game memory is written.

## Tests
- `node --test runner/test/unit/semantic-controls.test.js`
- `node --test web/test/dialogue-taps-unit.test.js web/test/dialogue-taps-browser.test.js web/test/iphone-profile.test.js`
- `node semantic/sync-web.js --check`

## Not verified
- Real-game behaviour (Tier 3, owner's iPhone): that a tap in a real waiting
  window advances it, and that landscape layout leaves the picture tappable.
- The choice panel (tap to pick) is out of scope: `dialogue().choice` is
  always null until #168 and the option count is not reported. Follow-up issue.
