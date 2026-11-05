# Issue 79: debug overlay with live game state

## What it is
A "Debug" button in the top bar toggles a read-only panel on the picture showing, from the semantic layer (#75): mode (with raw value and previous mode), field ID, player position, menu cursor, party (character IDs), party HP. Each value carries a badge, `hypothesis` or `confirmed`, taken from the address table (a value built from several addresses is `confirmed` only if all are). A value that cannot be read shows "—" and the layer's reason (`no address`, `read failed`), not an error. Today only mode has an address (`g_GameState`, hypothesis); everything else reads "— no address" until #77/#78 supply addresses. Nothing is invented.

## Files
| Path | Role |
|---|---|
| `web/js/overlay-state.js` | `sampleState(semantic)` turns the six readers into display rows; `createStatePoller` polls at `OVERLAY_HZ` and posts only changed samples; samples never overlap. Shared by the worker and the tests. |
| `web/js/overlay.js` | The toggle and panel. Hidden and disabled unless the gate is on; off by default; turning it off clears the panel. DOM built with `textContent` only. |
| `web/js/emu-worker.js` | After the hash gate says active, builds the layer over an in-worker `peek` (a RAM copy, same bounds as `readMem`) and a poller. New in message `{type:'overlay', on}`, out message `{type:'state', sample}`. |
| `web/js/backend.js` | `opts.onState`, `backend.setOverlay(on)`. |
| `web/js/main.js`, `index.html`, `css/app.css` | Wiring, button, panel. |
| `semantic/` (+ synced `web/js/semantic/`) | Small addition: `partyHp()` reader and `partyHp0..2` entries (u16, `address: null`, so `no address`). Unit test: `runner/test/unit/semantic-party-hp.test.js`. |

## Polling: 4 Hz, in the worker, only while the overlay is on
- The values change at human speed (a map change, a cursor step); 4 Hz is below perception of lag for a debug read-out and costs nothing.
- The layer reads the core's RAM directly in the worker (a `HEAPU8.slice` of 1 to 2 bytes per entry), so there is no `readMem` message round trip and nothing blocks the frame loop for more than microseconds. The timer shares the worker's event loop with the frame `setTimeout`; a sample is a handful of awaited microtasks.
- Nothing is polled while the overlay is off (the poller isn't started), and only samples that differ from the last one are posted, so a quiet game sends no messages.
- Writes: the layer has no write path and the worker hands it `{ readMem }` only.

## Gate
The worker creates the layer only when `gateForFiles` says active. It passes the table's own exe hash to `createSemantic` (the gate already compared the real hash; the hash is not kept or sent). With the gate off, no layer or poller exists, and the page keeps the button `hidden` and `disabled`. A later gate-off verdict while the overlay is on turns it off.

## Test hook (Tier 1 only)
There is no switch in the shipped app. Tests replace `js/backend.js` for one page with `page.route` (the pattern `field-browser.test.js` already uses). The replacement runs the real layer, `createStatePoller` and the page's overlay code over a synthetic RAM image, with `window.fake.load(active, table)` playing the worker's gate message. One test goes through the real worker and core: it points the table's exe hash (by rewriting the worker's `addresses.js` module request) at a synthetic disc (pad-echo homebrew as the boot file, cue + bin) and checks the gate, toggle and a live sample. That substitution exists only in the test.

## Tests
`web/test/debug-overlay.test.js`: poller unit tests (changed-only, no overlap, stop, 1 to 5 Hz); gate off (button hidden/disabled, nothing read, forced click does nothing); real table (off by default, mode row, "no address" rows, updates when RAM changes, polling stops when toggled off); synthetic table (confirmed vs hypothesis per row, all six rows, updates); the panel does not cover the pad/field and ignores pointer events, toggle is at least 44 px, the classic gamepad and field drag still work with the overlay on; landscape layout; real worker with the gate off (bare exe) and on (synthetic disc). WebKit runs skip locally (not installed); CI runs them.

## What the owner should look for on the iPhone
See the checklist in the PR. The overlay can only show real values for a USA disc image (`.bin` raw), and today only the Mode row has an address, so on the field the other rows read "no address".

## Not done / limits
- Party HP has no address, so it reads "no address".
- `.chd`/`.pbp`/`.exe` loads leave the gate (and so the overlay) off, as in #75.
- A gate-on test with the true USA hash needs the real disc and belongs to Tier 2/3.
