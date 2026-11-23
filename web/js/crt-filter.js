// CRT filter (#251), behind the Labs flag `crt-filter` (off by default): a
// subtle scanline look on the displayed picture only. It is applied when the
// page draws a frame, after any crop (border crop #24, battle crop #136), so
// the frame the core produced, frame hashes, crop regions and every semantic
// reading are untouched. Overlays (Debug, labels, panels) are DOM elements
// above the canvas and are not filtered.
//
// Approach (agent default, Trip mode rule 11; notes/251-crt-filter.md): plain
// 2D canvas, no WebGL. While the flag is on, the canvas holds each shown source
// row as SCALE output lines (nearest neighbour): the first line is the row as
// it is, the last one is darkened by the chosen strength. So there is exactly
// one scanline per source row, whatever the crop, and the lines cannot beat
// against the picture, because they are part of it and scale with it. With the
// flag off the page draws as before (putImageData at source size).

export const CRT_FLAG = 'crt-filter';
export const CRT_SCALE = 2; // output lines per source row
// Strength: how much the scanline (the last output line of each row) is dimmed.
export const CRT_LEVELS = [
  { value: 'subtle', label: 'Subtle', dim: 0.22 },
  { value: 'medium', label: 'Medium', dim: 0.38 },
  { value: 'strong', label: 'Strong', dim: 0.55 },
];
export const CRT_DEFAULT = 'subtle';

export const dimFor = (value) => (CRT_LEVELS.find((l) => l.value === value) ?? CRT_LEVELS[0]).dim;

// canvas/ctx: the page's picture canvas and its 2D context. makeCanvas makes the
// small off-screen canvases (the frame at source size, the scanline tile).
export function createCrtFilter({ canvas, ctx, labs, makeCanvas = () => document.createElement('canvas') }) {
  let src = null;
  let srcCtx = null;
  let tile = null;
  let tileDim = -1;
  let pattern = null;
  let frames = 0;
  let totalMs = 0;
  const now = () => globalThis.performance?.now?.() ?? Date.now();

  function scanlines(dim) {
    if (dim !== tileDim) {
      tile ??= makeCanvas();
      tile.width = 1;
      tile.height = CRT_SCALE;
      const t = tile.getContext('2d');
      t.clearRect(0, 0, 1, CRT_SCALE);
      t.fillStyle = `rgba(0, 0, 0, ${dim})`;
      t.fillRect(0, CRT_SCALE - 1, 1, 1);
      tileDim = dim;
      pattern = null;
    }
    pattern ??= ctx.createPattern(tile, 'repeat');
    return pattern;
  }

  return {
    get on() { return labs.isOn(CRT_FLAG); },
    get strength() { return labs.getSetting?.(CRT_FLAG) ?? CRT_DEFAULT; },
    // Draw rectangle r ({ x, y, w, h }) of frame f ({ width, height, buffer })
    // at the canvas origin, SCALE output pixels per source pixel, then dim the
    // last output line of each source row. f.buffer is only read.
    draw(f, r) {
      const t0 = now();
      const w = r.w * CRT_SCALE;
      const h = r.h * CRT_SCALE;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      if (!src) {
        src = makeCanvas();
        srcCtx = src.getContext('2d', { alpha: false });
      }
      if (src.width !== r.w || src.height !== r.h) {
        src.width = r.w;
        src.height = r.h;
      }
      srcCtx.putImageData(new ImageData(new Uint8ClampedArray(f.buffer), f.width, f.height), -r.x, -r.y, r.x, r.y, r.w, r.h);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(src, 0, 0, w, h);
      ctx.fillStyle = scanlines(dimFor(this.strength));
      ctx.fillRect(0, 0, w, h);
      frames += 1;
      totalMs += now() - t0;
    },
    // Display cost, for the Tier 1 frame-time check (a measurement, not a device claim).
    stats: () => ({ frames, meanMs: frames ? totalMs / frames : 0 }),
    resetStats() { frames = 0; totalMs = 0; },
  };
}
