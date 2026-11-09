// Tier 1: iPhone 14 Pro profile checks (#106): layout, touch targets, safe
// area and the field drag gesture, in portrait and landscape, with every Labs
// flag on in turn. Playwright WebKit is not iOS Safari: see notes/106-iphone-profile.md.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { PAD } from '../js/pad.js';
import { BROWSERS, launch, loadPlaywright, serveWeb } from './helpers.js';

const pw = loadPlaywright();
let server;
before(async () => { server = await serveWeb(); });
after(() => server?.close());

// env(safe-area-inset-*) evaluates to 0 under Playwright. So the stylesheet is
// served with each env() replaced by the iPhone 14 Pro's inset (in memory only;
// the file is untouched), and positions are asserted against the same constants. HYPOTHESIS (known device values, not
// measured here): portrait top 59 (Dynamic Island), bottom 34 (home indicator);
// landscape left/right 59, bottom 21, top 0.
const INSETS = {
  portrait: { top: 59, right: 0, bottom: 34, left: 0 },
  landscape: { top: 0, right: 59, bottom: 21, left: 59 },
};
const ZERO = { top: 0, right: 0, bottom: 0, left: 0 };
// "standalone": added to the Home Screen (the page sets apple-mobile-web-app-capable
// and viewport-fit=cover), so the viewport is the full 393x852 screen and the
// insets apply. "browser": Safari with its toolbars, Playwright's own viewport
// for the device; the toolbars take the insets, so they are 0 here.
const PROFILES = [
  { name: 'portrait standalone', device: 'iPhone 14 Pro', insets: INSETS.portrait, viewport: { width: 393, height: 852 } },
  { name: 'landscape standalone', device: 'iPhone 14 Pro landscape', insets: INSETS.landscape, viewport: { width: 852, height: 393 } },
  { name: 'portrait browser', device: 'iPhone 14 Pro', insets: ZERO },
  { name: 'landscape browser', device: 'iPhone 14 Pro landscape', insets: ZERO },
];
// Page defects this test found on main (#106), listed element by element. A
// problem that matches an entry is reported (t.diagnostic) instead of failing;
// any other problem fails the test, and so does an entry that no longer matches
// anything in its case (a fixed defect must be removed from this list). Each
// entry: profile, layout ('gamepad' | 'field' | '*'), and a regexp over the
// problem message. Fix: #152, behind the Labs flag `safe-layout` (off by
// default). With that flag on none of these apply, so a case with it on must
// show none of them; they stay for every case without it.
const FIXED_BY = 'safe-layout';
const KNOWN_DEFECTS = [
  // .pad is position:absolute; inset:0, so the body's safe-area padding does
  // not reach it: landscape controls sit in the left/right/bottom insets.
  { profile: 'landscape standalone', layout: 'gamepad', match: /: (vp-btn vp-sh|vp-dpad|vp-btn vp-round vp-circle|vp-btn vp-pill) \d[^ ]* leaves the safe area/ },
  { profile: 'landscape standalone', layout: 'field', match: /: btn (field-action\[(circle|triangle)\]|field-back\[cross\]) \d[^ ]* leaves the safe area/ },
  // Start/Select (vp-pill) below the fold in Safari with its toolbars.
  { profile: 'portrait browser', layout: 'gamepad', match: /: vp-btn vp-pill \d[^ ]* leaves the safe area/ },
  { profile: 'landscape browser', layout: 'gamepad', match: /: vp-btn vp-pill \d[^ ]* leaves the safe area/ },
];
const knownFor = (profile, layout, flag) => (flag === FIXED_BY ? [] : KNOWN_DEFECTS)
  .filter((d) => d.profile === profile.name && (d.layout === '*' || d.layout === layout));

/** Fail on unknown problems and on stale known-defect entries; report the rest. */
function settle(t, problems, known, where) {
  const unknown = problems.filter((p) => !known.some((d) => d.match.test(p)));
  for (const p of problems) if (!unknown.includes(p)) t.diagnostic(`known defect: ${p}`);
  const stale = known.filter((d) => !problems.some((p) => d.match.test(p)));
  assert.deepEqual(unknown, [], `${where}: ${unknown.length} problem(s)`);
  assert.deepEqual(stale.map((d) => String(d.match)), [], `${where}: known defect(s) no longer seen; remove them from KNOWN_DEFECTS`);
}
const MIN_TARGET = 44;
const TOL = 1; // px

// Visible things that take a touch. Pad arrows are pointer-events:none (the
// d-pad disc takes the touch) and the landscape field surface spans the screen
// by design, so neither is listed; the field surface is covered in portrait.
const COLLECT = () => {
  const landscape = window.innerWidth > window.innerHeight;
  const sel = ['button', 'input:not([type=hidden])', 'select', 'textarea', 'a[href]', '[role=button]',
    'summary', 'label', '.vp-dpad', '#field', '#status'].join(',');
  const seen = [];
  for (const el of document.querySelectorAll(sel)) {
    if (el.id === 'field' && landscape) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none') continue;
    if (el.closest('[hidden]')) continue;
    const closed = el.closest('details:not([open])');
    if (closed && !(el.tagName === 'SUMMARY' && el.parentElement === closed)) continue;
    // A <label> wrapping a hidden input is the control; an input inside a label is part of it.
    seen.push({ el, id: el.id || el.className || el.tagName, rect: r.toJSON() });
  }
  return seen.map((s) => ({
    id: s.id + (s.el.dataset.action ? `[${s.el.dataset.action}]` : '') + (s.el.dataset.flag ? `[${s.el.dataset.flag}]` : ''),
    rect: s.rect,
    parent: seen.findIndex((o) => o.el !== s.el && o.el.contains(s.el)) >= 0,
    isField: s.el.id === 'field',
    isStatus: s.el.id === 'status',
  }));
};

const intersects = (a, b) => a.x < b.x + b.width - 0.01 && b.x < a.x + a.width - 0.01
  && a.y < b.y + b.height - 0.01 && b.y < a.y + a.height - 0.01;
const fmt = (r) => `${Math.round(r.width * 10) / 10}x${Math.round(r.height * 10) / 10}@${Math.round(r.x)},${Math.round(r.y)}`;

const envInsets = (insets) => (css) => css.replace(/env\(safe-area-inset-(top|right|bottom|left)\)/g, (_, side) => `${insets[side]}px`);

async function openApp(browser, device, query, insets = ZERO, viewport, srv = server) {
  const context = await browser.newContext({ ...pw.devices[device], ...(viewport && { viewport }) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/js/backend.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `export async function createWorkerBackend() {
      window.padCalls = [];
      return { loaded: false, onFrameEnd() {}, setPad(m) { window.padCalls.push(m); } };
    }`,
  }));
  const rewrite = envInsets(insets);
  await page.route('**/css/app.css', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: rewrite(await res.text()) });
  });
  await page.goto(srv.url + query);
  await page.evaluate(() => window.ff7web.ready);
  return { context, page, errors };
}

/** Layout checks on the page as it stands. Returns problem messages labelled with `where`. */
async function checkLayout(page, profile, where, problems = []) {
  const check = (ok, msg) => { if (!ok) problems.push(msg); };
  const vp = page.viewportSize();
  const { insets } = profile;
  const m = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    bodyScrollW: document.body.scrollWidth,
    innerW: window.innerWidth,
    canvas: document.getElementById('screen').getBoundingClientRect().toJSON(),
    screen: document.querySelector('.screen').getBoundingClientRect().toJSON(),
  }));
  check(m.scrollW <= m.innerW, `${where}: horizontal scroll (scrollWidth ${m.scrollW} > ${m.innerW})`);
  check(m.bodyScrollW <= m.innerW, `${where}: body wider than the viewport (${m.bodyScrollW} > ${m.innerW})`);
  // The picture: canvas fits the viewport and keeps 4:3 (the .screen box is 4:3 in CSS).
  const c = m.canvas;
  check(c.width > 0 && c.height > 0, `${where}: canvas has a size`);
  check(c.x >= -TOL && c.y >= -TOL && c.x + c.width <= vp.width + TOL && c.y + c.height <= vp.height + TOL,
    `${where}: canvas ${fmt(c)} exceeds viewport ${vp.width}x${vp.height}`);
  check(Math.abs(c.width / c.height - 4 / 3) * c.height <= TOL + 0.5,
    `${where}: canvas ${fmt(c)} is not 4:3`);

  const items = await page.evaluate(COLLECT);
  check(items.length >= 8, `${where}: found interactive elements (${items.length})`);
  const area = { l: insets.left, t: insets.top, r: vp.width - insets.right, b: vp.height - insets.bottom };
  for (const it of items) {
    const r = it.rect;
    // The portrait field surface is a drag area, not a button; hit-size still applies.
    check(r.width >= MIN_TARGET - 0.01 && r.height >= MIN_TARGET - 0.01 || it.isStatus && r.width >= MIN_TARGET && r.height >= 20,
      `${where}: ${it.id} is ${fmt(r)}, under ${MIN_TARGET}px`);
    // Safe area: controls only; the picture and its status line may sit under the notch bands.
    // The picture box is not an interactive element, so it is not asserted here.
    if (!it.isStatus) {
      check(r.x >= area.l - TOL && r.y >= area.t - TOL && r.x + r.width <= area.r + TOL && r.y + r.height <= area.b + TOL,
        `${where}: ${it.id} ${fmt(r)} leaves the safe area (${area.l},${area.t})-(${area.r},${area.b})`);
    }
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (a.isStatus || b.isStatus) continue; // the status line is a dismissible caption on the picture
      // Skip a container and its own children (the field surface holds its buttons).
      if (a.isField !== b.isField) {
        const [field, other] = a.isField ? [a, b] : [b, a];
        if (other.parent && intersects(field.rect, other.rect)) continue;
      }
      check(!intersects(a.rect, b.rect), `${where}: ${a.id} ${fmt(a.rect)} overlaps ${b.id} ${fmt(b.rect)}`);
    }
  }
  return problems;
}

const fire = (page, type, id, p) => page.locator('#field').dispatchEvent(type, {
  pointerId: id, pointerType: 'touch', isPrimary: id === 1,
  clientX: p.x, clientY: p.y, bubbles: true, cancelable: true,
});

// The registered Labs flags, read from the page before the tests are declared:
// node:test declares the per-flag cases synchronously, so a list filled in a
// before() hook would come too late and only the fallback would be covered.
const pageFlags = async (browser, srv = server) => {
  const { context, page } = await openApp(browser, 'iPhone 14 Pro', '', ZERO, undefined, srv);
  try { return await page.evaluate(() => window.ff7web.labs.listFlags().map((f) => f.name)); } finally { await context.close(); }
};
let FLAGS = ['labs-demo'];
for (const name of BROWSERS) {
  const r = await launch(pw, name).catch(() => ({}));
  if (!r.browser) continue;
  const own = await serveWeb();
  try { FLAGS = await pageFlags(r.browser, own); } finally { await r.browser.close(); own.close(); }
  break;
}

for (const name of BROWSERS) {
  describe(`iphone profile: ${name}`, () => {
    let browser;
    let skip;
    const flags = FLAGS;
    before(async () => {
      const r = await launch(pw, name);
      browser = r.browser;
      skip = r.skip;
      // Every browser must see the same flags as the declared cases.
      if (browser) assert.deepEqual(await pageFlags(browser), flags);
    });
    after(() => browser?.close());

    for (const profile of PROFILES) {
      test(`${profile.name}: the device profile is applied`, async (t) => {
        if (skip) return t.skip(skip);
        const { context, page } = await openApp(browser, profile.device, '', profile.insets, profile.viewport);
        try {
          const d = pw.devices[profile.device];
          const got = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight, touch: navigator.maxTouchPoints > 0 || 'ontouchstart' in window }));
          const want = profile.viewport ?? d.viewport;
          assert.deepEqual([got.w, got.h], [want.width, want.height]);
          assert.ok(got.touch, 'touch is enabled');
          assert.ok(flags.includes(FIXED_BY), `the ${FIXED_BY} flag is registered: ${flags}`);
        } finally { await context.close(); }
      });

      for (const flag of [null, ...flags]) {
        for (const layout of ['gamepad', 'field']) {
          const label = `${profile.name}, ${layout}, ${flag ? `flag ${flag}` : 'no flags'}`;
          test(`layout checks: ${label}`, async (t) => {
            if (skip) return t.skip(skip);
            const { context, page, errors } = await openApp(browser, profile.device, flag ? `?labs=${flag}` : '', profile.insets, profile.viewport);
            try {
              if (flag) assert.equal(await page.evaluate((f) => window.ff7web.labs.isOn(f), flag), true);
              if (layout === 'field') await page.click('#controls-btn');
              assert.equal(await page.locator('#field').isVisible(), layout === 'field');
              const problems = await checkLayout(page, profile, label);
              // Panels opened from the bar must also stay inside the viewport and the safe area.
              await page.click('#labs-btn');
              const panel = await page.locator('#labs-panel').boundingBox();
              const vp = page.viewportSize();
              const ins = profile.insets;
              if (!(panel.x >= ins.left - TOL && panel.y >= ins.top - TOL
                && panel.x + panel.width <= vp.width - ins.right + TOL && panel.y + panel.height <= vp.height - ins.bottom + TOL)) {
                problems.push(`${label}: labs panel ${fmt(panel)} leaves the safe area`);
              }
              await page.click('#labs-btn'); // close
              await page.click('summary');
              const menu = await page.locator('.menu-body').boundingBox();
              if (!(menu.x >= ins.left - TOL && menu.y >= ins.top - TOL
                && menu.x + menu.width <= vp.width - ins.right + TOL && menu.y + menu.height <= vp.height - ins.bottom + TOL)) {
                problems.push(`${label}: card menu ${fmt(menu)} leaves the safe area`);
              }
              for (const b of await page.locator('.menu-body .btn').all()) {
                const bb = await b.boundingBox();
                if (!(bb.width >= MIN_TARGET && bb.height >= MIN_TARGET)) problems.push(`${label}: card menu item ${fmt(bb)} under ${MIN_TARGET}px`);
              }
              await page.click('summary');
              await page.click('#labs-btn');
              for (const row of await page.locator('.labs-row').all()) {
                const b = await row.boundingBox();
                if (!(b.width >= MIN_TARGET && b.height >= MIN_TARGET)) problems.push(`${label}: labs row ${fmt(b)} under ${MIN_TARGET}px`);
              }
              settle(t, problems, knownFor(profile, layout, flag), label);
              assert.deepEqual(errors, []);
            } finally { await context.close(); }
          });
        }
      }

      test(`touch drag on the field layer gives the expected pad bits: ${profile.name}`, async (t) => {
        if (skip) return t.skip(skip);
        const { context, page, errors } = await openApp(browser, profile.device, '', profile.insets, profile.viewport);
        try {
          await page.click('#controls-btn');
          const box = await page.locator('#field').boundingBox();
          // Land in empty space, clear of the action buttons (bottom edge) and the bar.
          const o = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
          const mask = () => page.evaluate(() => window.ff7web.mixer.mask);
          await fire(page, 'pointerdown', 1, o);
          assert.equal(await mask(), 0);
          const cases = [[30, 0, PAD.right], [0, -30, PAD.up], [-30, 0, PAD.left], [0, 30, PAD.down], [0, -80, PAD.up | PAD.cross]];
          for (const [dx, dy, want] of cases) {
            await fire(page, 'pointermove', 1, { x: o.x + dx, y: o.y + dy });
            assert.equal(await mask(), want, `${profile.name}: drag (${dx},${dy})`);
          }
          await fire(page, 'pointerup', 1, o);
          assert.equal(await mask(), 0);
          assert.deepEqual(errors, []);
        } finally { await context.close(); }
      });

      test(`the classic pad still sends bits on a tap: ${profile.name}`, async (t) => {
        if (skip) return t.skip(skip);
        const { context, page } = await openApp(browser, profile.device, '', profile.insets, profile.viewport);
        try {
          const b = await page.locator('.vp-cross').boundingBox();
          await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
          const calls = await page.evaluate(() => window.padCalls);
          assert.ok(calls.includes(PAD.cross), `cross reached the backend: ${JSON.stringify(calls)}`);
        } finally { await context.close(); }
      });
    }
  });
}
