# #251: CRT filter (Labs flag `crt-filter`)

## Decision (agent default, Trip mode rule 11)
**Plain 2D canvas, no WebGL.** While the flag is on, `web/js/crt-filter.js`
draws the shown rectangle of the frame (full frame, border crop or battle
crop) at 2× with nearest-neighbour scaling, then fills a 1×2 pattern over it,
so the second output line of every source row is dimmed. Why:

- one scanline per **source row**, whatever the crop, because the lines are
  part of the canvas and scale with the picture; no CSS-pixel overlay to beat
  against it;
- no second rendering path to fall back from: the 2D context the page already
  uses works everywhere the page runs;
- cheap: 0.105 ms mean per filtered draw over 120 frames in headless Chromium
  (Tier 1 measurement, not a device claim);
- the canvas grows from 320×240 to 640×480 only while the flag is on; the
  picture box keeps its CSS size, which the test checks.

With the flag off the page uses the old `putImageData` path unchanged, and the
test checks the canvas equals the frame byte for byte.

The frame the core posted is only read (the test compares its bytes before and
after). Crop rectangles, frame hashes and semantic reads are unaffected,
because the filter runs after them, in the page's `draw()`.

## Strength
The Labs panel shows a **Strength** select under the toggle while the flag is
on: Subtle (default, dims the scanline by 22 %), Medium (38 %) and Strong
(55 %). To support it, `labs.js` gained one optional `setting` per flag,
stored apart from the on/off list in `localStorage` `ff7web.labs.settings`
(so the existing format is unchanged). "Reset all flags" clears it too.

No mask or vignette: the issue makes them optional, and scanlines alone keep it subtle.

## 2× internal resolution (#252)
`CRT_SCALE` is the number of output lines per source row. Once #252 gives
640×480 frames, the issue asks for one scanline per output line; that is a
one-line change in #252 (scale by 2 on a 640×480 frame gives 1280×960, which is
fine, or drop to an alternate-row tile at scale 1).

## Not verified
- How it looks on the iPhone (Tier 3, deferred to #123).
- WebKit locally: Playwright WebKit is not installed in the session's sandbox; CI runs it.
