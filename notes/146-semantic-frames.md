# #146: the movie window counts frames; field button meanings in `semantic/`

## Movie window
Before: `mode()` kept the last `MOVIE_WINDOW` (5) `movieFrame` reads, one per call. How much game time that covered depended on the caller's polling rate: 60 frames at the overlay's 4 Hz, but 5 frames when polled every frame.

Now (`semantic/layer.js`, `pushMovieSample`):
- When `backend.frame` is an integer ≥ 0, the window holds the reads from the last `MOVIE_SPAN_FRAMES` (60) game frames, the current one included. 60 is what five samples cover at 4 Hz, so the overlay's answer is unchanged.
  - A second read on the same frame replaces the first.
  - A frame number that goes back (a reset or a loaded state) starts a new window.
  - Polled less often than every 30 frames, the window holds one sample and never reports a movie. The polling rates in use (4 Hz, and 20 Hz in tests) are well inside this.
- When the backend gives no frame number (missing, not an integer, negative, or a getter that throws), the window is the last `MOVIE_WINDOW` calls, as before. A switch between the two cases starts a new window.
- `clearMovieWindow()` (#107) empties the window in both cases.

**Measured (Tier 1, synthetic RAM, `runner/test/unit/semantic-movie-frames.test.js`):** a counter that advances every 4 frames, polled every 1, 4 and 15 frames, gives the same report at every frame all three rates sample (multiples of 60, frames 0 to 600). At every rate, the report ends within 60 frames of the counter stopping. A stuck counter (1790, with stray 0 reads) is never a movie at rates 1, 2, 4, 15 and 30.

**Not wired yet:** none of the frontends' layers gets a frame number today. Each one wraps the backend as `{ readMem }` only:
- the overlay, in `web/js/emu-worker.js`;
- `auto-controls.js`, `battle-hud.js` and `dialogue-taps.js` on the main thread.

So they all keep the per-call behaviour, which is what #146's "Behaviour: unchanged" asks for. Those files are outside #146's allowed paths. Passing the frame through is the follow-up issue (linked on PR #180). The runner's backend already has `frame`, so a runner-side `createSemantic({ backend })` gets the frame window straight away.

## Field buttons
`FIELD_ACTIONS` in `semantic/controls.js` holds the three field buttons in screen order: `{ id, label, button, kind }`. `button` is a key of `PAD`. `kind` is `action` or `back`, and `field-controls.js` renders it as the class `field-<kind>`. `field-controls.js` builds the buttons from this data and holds no field facts of its own (checked by a unit test). `web/test/field-actions-browser.test.js` checks that the rendered buttons match the markup from before #146 (tag, type, class, `data-action`, text), so behaviour is unchanged.
