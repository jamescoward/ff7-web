// Tier 1 unit tests for the automatic picture crop (issue #24), on synthetic
// frames. No browser, no core build.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { contentBounds, CROP_DEFAULTS, cropAspect, createCropTracker } from '../js/crop.js';

const W = 320;
const H = 240;
const rgb = (r, g, b) => (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
const GREY = (v) => rgb(v, v, v);

/** A black frame with `box` ({ top, right, bottom, left } insets) filled by `fill(x, y)`. */
function frame(box, fill = () => GREY(128), w = W, h = H) {
  const px = new Uint32Array(w * h).fill(rgb(0, 0, 0));
  for (let y = box.top; y < h - box.bottom; y++) {
    for (let x = box.left; x < w - box.right; x++) px[y * w + x] = fill(x, y);
  }
  return px;
}
const insets = (top, right, bottom, left) => ({ top, right, bottom, left });
const rectOf = (b, w = W, h = H) => ({ x: b.left, y: b.top, w: w - b.left - b.right, h: h - b.top - b.bottom });
const FULL = rectOf(insets(0, 0, 0, 0));

/** Feed `n` frames from `make(i)`, starting at frame `start`; returns the crops. */
function run(tracker, start, n, make) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(tracker.update(make(i), W, H, start + i));
  return out;
}

/** True when no pixel with content lies outside `crop`. */
function nothingCut(px, crop, w = W, h = H) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inside = x >= crop.x && x < crop.x + crop.w && y >= crop.y && y < crop.y + crop.h;
      const p = px[y * w + x];
      const lit = (p & 0xff) > CROP_DEFAULTS.blackMax || ((p >>> 8) & 0xff) > CROP_DEFAULTS.blackMax
        || ((p >>> 16) & 0xff) > CROP_DEFAULTS.blackMax;
      if (lit && !inside) return false;
    }
  }
  return true;
}

describe('contentBounds', () => {
  test('finds the box, ignores near-black and single stray pixels', () => {
    const px = frame(insets(16, 32, 24, 8));
    px[3 * W + 100] = GREY(255); // one stray pixel in the top border
    for (let x = 0; x < W; x++) px[5 * W + x] = GREY(16); // a near-black row
    const b = contentBounds(px, W, H);
    assert.deepEqual([b.top, b.right, b.bottom, b.left], [16, 32, 24, 8]);
    assert.ok(b.fraction > 0.7 && b.fraction < 0.8, `fraction ${b.fraction}`);
  });

  test('returns null for an all-black frame', () => {
    assert.equal(contentBounds(new Uint32Array(W * H).fill(rgb(0, 0, 0)), W, H), null);
  });

  test('any one channel counts as content', () => {
    const b = contentBounds(frame(insets(10, 0, 10, 0), () => rgb(0, 0, 40)), W, H);
    assert.equal(b.top, 10);
  });
});

describe('createCropTracker', () => {
  test('fixed borders: crops after the stability delay, not before', () => {
    const t = createCropTracker();
    const box = insets(24, 16, 24, 16);
    const crops = run(t, 0, 90, () => frame(box));
    const firstCropped = crops.findIndex((c) => c.w < W);
    assert.equal(firstCropped, CROP_DEFAULTS.stableFrames, 'narrows exactly once the window is full');
    assert.ok(crops.slice(0, firstCropped).every((c) => c.w === W && c.h === H), 'full frame until then');
    assert.deepEqual(crops.at(-1), rectOf(box));
  });

  test('full-screen content: no crop', () => {
    const t = createCropTracker();
    const crops = run(t, 0, 200, () => frame(insets(0, 0, 0, 0)));
    assert.ok(crops.every((c) => c.x === 0 && c.y === 0 && c.w === W && c.h === H));
  });

  test('content appearing at an edge widens on the same frame', () => {
    const t = createCropTracker();
    const box = insets(32, 32, 32, 32);
    run(t, 0, 120, () => frame(box));
    assert.deepEqual(t.rect, rectOf(box));
    // A sprite walks into the top-left border.
    const px = frame(box);
    for (let y = 4; y < 20; y++) for (let x = 6; x < 30; x++) px[y * W + x] = GREY(200);
    const c = t.update(px, W, H, 120);
    assert.equal(c.y, 4);
    assert.equal(c.x, 6);
    assert.ok(nothingCut(px, c));
  });

  test('flicker at an edge: the crop stays wide, no pumping', () => {
    const t = createCropTracker();
    const box = insets(32, 32, 32, 32);
    run(t, 0, 120, () => frame(box));
    const flick = (i) => {
      const px = frame(box);
      if (i % 20 < 2) for (let x = 100; x < 140; x++) px[8 * W + x] = GREY(220); // a blinking line at y=8
      return px;
    };
    const crops = run(t, 120, 600, flick);
    const ys = new Set(crops.slice(1).map((c) => c.y));
    assert.deepEqual([...ys], [8], `crop top settles at the flicker and stays: ${[...ys]}`);
    crops.forEach((c, i) => assert.ok(nothingCut(flick(i), c), `frame ${i}`));
  });

  test('fade to black and back: the crop holds, nothing is cut', () => {
    const t = createCropTracker();
    const box = insets(24, 0, 24, 0);
    // A vertical gradient: the rows near the borders are darkest, so a naive
    // detector would shrink the box as they drop under the threshold.
    const scene = (k) => frame(box, (x, y) => GREY(Math.round(k * (40 + 200 * Math.sin((Math.PI * (y - 24)) / 192)))));
    run(t, 0, 120, () => scene(1));
    const settled = t.rect;
    assert.deepEqual(settled, rectOf(box));
    const levels = [
      ...Array.from({ length: 60 }, (_, i) => 1 - i / 60), // fade out over 1 s
      ...Array(30).fill(0), // black
      ...Array.from({ length: 60 }, (_, i) => i / 60), // fade in
      ...Array(120).fill(1),
    ];
    let f = 120;
    for (const k of levels) {
      const px = scene(k);
      const c = t.update(px, W, H, f++);
      assert.ok(c.y <= settled.y && c.h >= settled.h, `frame ${f}: crop ${JSON.stringify(c)} narrower than ${JSON.stringify(settled)}`);
      assert.ok(nothingCut(px, c), `frame ${f}: content cut`);
    }
    assert.deepEqual(t.rect, settled);
  });

  test('a dark scene with a bright object is not cropped to the object', () => {
    const t = createCropTracker();
    run(t, 0, 120, () => frame(insets(0, 0, 0, 0)));
    assert.deepEqual(t.rect, FULL);
    // Night: everything near black but a lamp in the middle.
    const night = () => {
      const px = new Uint32Array(W * H).fill(GREY(8));
      for (let y = 100; y < 140; y++) for (let x = 140; x < 180; x++) px[y * W + x] = GREY(250);
      return px;
    };
    const crops = run(t, 120, 600, night);
    assert.ok(crops.every((c) => c.w === W && c.h === H), 'stays full');
  });

  test('narrowing ignores frames from before a black gap', () => {
    const t = createCropTracker();
    run(t, 0, 50, () => frame(insets(40, 0, 40, 0)));
    run(t, 50, 5, () => new Uint32Array(W * H)); // black: loading
    const crops = run(t, 55, 50, () => frame(insets(40, 0, 40, 0)));
    assert.ok(crops.every((c) => c.h === H), 'the run restarted after the gap');
  });

  test('nearly centred content is cropped symmetrically; off-centre is not', () => {
    const t = createCropTracker();
    run(t, 0, 100, () => frame(insets(20, 10, 26, 14)));
    assert.deepEqual(t.rect, rectOf(insets(20, 10, 20, 10)));
    const u = createCropTracker();
    run(u, 0, 100, () => frame(insets(10, 0, 40, 0)));
    assert.deepEqual(u.rect, rectOf(insets(10, 0, 40, 0)));
  });

  test('never crops more than a quarter from any side', () => {
    const t = createCropTracker();
    run(t, 0, 100, () => frame(insets(70, 100, 70, 100))); // 120x100: enough content to count
    assert.deepEqual(t.rect, rectOf(insets(60, 80, 60, 80)));
  });

  test('small narrowing steps are not applied', () => {
    const t = createCropTracker();
    run(t, 0, 100, () => frame(insets(20, 0, 20, 0)));
    run(t, 100, 100, () => frame(insets(22, 0, 22, 0)));
    assert.equal(t.rect.y, 20);
  });

  test('a new frame size starts from the full frame', () => {
    const t = createCropTracker();
    run(t, 0, 100, () => frame(insets(20, 0, 20, 0)));
    const c = t.update(frame(insets(40, 0, 40, 0), undefined, 368, 240), 368, 240, 100);
    assert.deepEqual(c, { x: 0, y: 0, w: 368, h: 240 });
  });
});

test('cropAspect keeps the pixel aspect ratio', () => {
  assert.equal(cropAspect({ w: 320, h: 240 }, 320, 240), 4 / 3);
  assert.equal(cropAspect({ w: 512, h: 240 }, 512, 240), 4 / 3);
  assert.ok(Math.abs(cropAspect({ w: 320, h: 192 }, 320, 240) - 5 / 3) < 1e-9);
  assert.ok(Math.abs(cropAspect({ w: 256, h: 240 }, 512, 240) - 2 / 3) < 1e-9);
});
