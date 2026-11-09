# web/test

Tier 1 browser tests for the wrapper. Run with `node --test 'web/test/*.test.js'`
(Playwright from the global install; `WEB_BROWSERS=chromium,webkit`,
`WEB_REQUIRE_BROWSERS=1` in CI makes a missing browser an error, not a skip).

## iphone-profile.test.js (#106)

Runs the page with Playwright's `iPhone 14 Pro` and `iPhone 14 Pro landscape`
profiles (touch on) and checks what an owner device check would catch:
no horizontal scroll; the canvas fits the viewport at 4:3; every visible
interactive element is at least 44x44 px; no two overlap; controls and the Labs
and Card panels stay inside the safe area; a synthetic touch drag on the field
layer gives the expected pad bits; the classic pad still sends input. Layout
checks repeat for the classic pad and the field controls, and for each Labs
flag from `window.ff7web.labs.listFlags()` switched on in turn via `?labs=`.

**This is not iOS Safari.** Playwright WebKit shares the engine, not the device:
no real Safari chrome, safe areas, rubber-banding, multi-touch or hit-testing
(`docs/ARCHITECTURE_SURVEY.md` section 7, risk 5). It narrows the gap; it does
not replace the owner's iPhone check (Tier 3).

Safe area: `env(safe-area-inset-*)` is 0 under Playwright, so the test serves
`css/app.css` with each `env()` replaced in memory by the iPhone 14 Pro's inset
(portrait top 59, bottom 34; landscape left/right 59, bottom 21). Those values
are known device figures taken as a hypothesis, not measured here. "standalone"
profiles use the full 393x852 screen (Home Screen app, `viewport-fit=cover`);
"browser" profiles use Playwright's own viewport with zero insets.

Known page defects are listed in `KNOWN_DEFECTS` and reported as TODO: the
assertions still run and print the failing elements, but do not fail the suite
until the page is fixed. See `notes/106-iphone-profile.md`.
