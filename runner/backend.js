// Backend interface over the Wasm core: readMem / writeMem / setPad /
// onFrameEnd, plus program loading and frame stepping.
//
// This is the layer boundary that the semantic layer and the harness build
// on. It knows nothing about FF7; it exposes PS1 RAM, the pad and frames.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ramOffset, RAM_SIZE } from './memmap.js';
import { padMask } from './pad.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DIST = path.join(HERE, 'dist');

// enum retro_pixel_format
const PIXEL_FORMATS = {
  0: { name: '0rgb1555', bytes: 2 },
  1: { name: 'xrgb8888', bytes: 4 },
  2: { name: 'rgb565', bytes: 2 },
};

const HOST_MOUNT = '/host';

/**
 * Create a backend. Only one core instance may be live per module, so each
 * backend loads its own module instance.
 *
 * @param {object} [opts]
 * @param {string} [opts.dist]   directory holding core.mjs (runner/build.sh)
 * @param {boolean} [opts.allowMemoryWrite]  enable writeMem (off by default:
 *   the project injects input only, unless an issue explicitly allows writes)
 * @param {boolean} [opts.verbose]  forward core info logs to stderr
 * @param {Record<string,string>} [opts.coreOptions]  libretro core options
 */
export async function createBackend(opts = {}) {
  const dist = opts.dist ?? DEFAULT_DIST;
  const modPath = path.join(dist, 'core.mjs');
  if (!existsSync(modPath)) {
    throw new Error(`missing ${modPath}; run core/build.sh then runner/build.sh`);
  }
  const { default: init } = await import(pathToFileURL(modPath).href);
  const m = await init({
    print: (s) => process.stderr.write(`[core] ${s}\n`),
    printErr: (s) => process.stderr.write(`[core] ${s}\n`),
  });

  const api = m._fe_init(opts.verbose ? 1 : 0);
  if (api !== 1) throw new Error(`unexpected libretro API version ${api}`);

  const withCString = (s, fn) => {
    const p = m.stringToNewUTF8(s);
    try {
      return fn(p);
    } finally {
      m._free(p);
    }
  };

  for (const [k, v] of Object.entries(opts.coreOptions ?? {})) {
    if (!withCString(k, (kp) => withCString(String(v), (vp) => m._fe_set_option(kp, vp)))) {
      throw new Error(`could not set core option ${k}`);
    }
  }

  const allowWrite = Boolean(opts.allowMemoryWrite);
  const listeners = new Set();
  let frame = 0;
  let loaded = false;
  let mounted = false;

  function ram() {
    if (!loaded) throw new Error('core RAM is not available: no program loaded');
    const ptr = m._fe_ram_ptr();
    const size = m._fe_ram_size();
    if (!ptr || size !== RAM_SIZE) throw new Error('core RAM is not available (no program loaded?)');
    // HEAPU8 is re-read every time: memory growth replaces the buffer.
    return m.HEAPU8.subarray(ptr, ptr + size);
  }

  const backend = {
    /** Build provenance of the linked core, from runner/build.sh. */
    buildInfo() {
      const p = path.join(dist, 'BUILD_INFO.json');
      return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
    },

    /**
     * Load a PS-X EXE or disc image from the host filesystem. The file is
     * read in place through NODEFS, not copied into the Wasm heap.
     */
    loadProgram(hostPath) {
      if (loaded) throw new Error('a program is already loaded; create a new backend');
      const abs = path.resolve(hostPath);
      if (!existsSync(abs)) throw new Error(`no such file: ${hostPath}`);
      if (!mounted) {
        m.FS.mkdir(HOST_MOUNT);
        mounted = true;
      }
      m.FS.mount(m.NODEFS, { root: path.dirname(abs) }, HOST_MOUNT);
      const ok = withCString(`${HOST_MOUNT}/${path.basename(abs)}`, (p) => m._fe_load_game(p));
      if (!ok) throw new Error(`core rejected ${path.basename(abs)}`);
      loaded = true;
    },

    get frame() {
      return frame;
    },

    fps() {
      return m._fe_fps();
    },

    /** Run one emulated frame, then notify onFrameEnd listeners. */
    stepFrame() {
      if (!loaded) throw new Error('no program loaded');
      m._fe_run_frame();
      frame += 1;
      for (const fn of listeners) fn({ frame, backend });
      return frame;
    },

    runFrames(n) {
      if (!Number.isInteger(n) || n < 0) throw new RangeError(`frame count must be >= 0, got ${n}`);
      for (let i = 0; i < n; i++) backend.stepFrame();
      return frame;
    },

    /** Copy `len` bytes of main RAM starting at PS1 address `addr`. */
    readMem(addr, len = 1) {
      const off = ramOffset(addr, len);
      return Uint8Array.from(ram().subarray(off, off + len));
    },

    readU8(addr) {
      return backend.readMem(addr, 1)[0];
    },
    readU16(addr) {
      const b = backend.readMem(addr, 2);
      return b[0] | (b[1] << 8);
    },
    readU32(addr) {
      const b = backend.readMem(addr, 4);
      return (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
    },

    /** Write bytes into main RAM. Throws unless allowMemoryWrite was set. */
    writeMem(addr, bytes) {
      if (!allowWrite) {
        throw new Error('writeMem is disabled: input injection only (pass allowMemoryWrite)');
      }
      const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
      const off = ramOffset(addr, data.length);
      ram().set(data, off);
    },

    /** Set a pad's held buttons: mask number, name array, or "a,b" string. */
    setPad(state, port = 0) {
      if (port !== 0 && port !== 1) throw new RangeError(`pad port must be 0 or 1, got ${port}`);
      const mask = padMask(state);
      m._fe_set_pad(port, mask);
      return mask;
    },

    /** What the core reads for a joypad query; exposed for tests. */
    inputState(port, id) {
      const RETRO_DEVICE_JOYPAD = 1;
      return m._fe_input_state(port, RETRO_DEVICE_JOYPAD, 0, id);
    },

    /** Register a callback run after every frame. Returns an unsubscribe fn. */
    onFrameEnd(fn) {
      if (typeof fn !== 'function') throw new TypeError('onFrameEnd needs a function');
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** Geometry and format of the last frame the core produced. */
    frameInfo() {
      const fmt = PIXEL_FORMATS[m._fe_fb_format()];
      return {
        width: m._fe_fb_width(),
        height: m._fe_fb_height(),
        pitch: m._fe_fb_pitch(),
        format: fmt ? fmt.name : `unknown-${m._fe_fb_format()}`,
        bytesPerPixel: fmt ? fmt.bytes : 0,
        hasData: m._fe_fb_data() !== 0,
      };
    },

    /**
     * SHA-256 of the last frame's visible pixels (row padding excluded),
     * prefixed by its format and size so a size change always changes it.
     */
    frameHash() {
      const info = backend.frameInfo();
      const h = createHash('sha256');
      h.update(`${info.format}:${info.width}x${info.height}\n`);
      const ptr = m._fe_fb_data();
      if (ptr && info.bytesPerPixel) {
        const rowBytes = info.width * info.bytesPerPixel;
        const heap = m.HEAPU8;
        for (let y = 0; y < info.height; y++) {
          const start = ptr + y * info.pitch;
          h.update(heap.subarray(start, start + rowBytes));
        }
      }
      return h.digest('hex');
    },

    stats() {
      return {
        audioFrames: m._fe_audio_frames(),
        inputPolls: m._fe_input_polls(),
        duplicateFrames: m._fe_fb_dupes(),
      };
    },

    close() {
      if (loaded) m._fe_unload();
      m._fe_deinit();
      if (mounted) {
        try {
          m.FS.unmount(HOST_MOUNT);
        } catch {
          // not mounted
        }
      }
      listeners.clear();
      loaded = false;
    },
  };
  return backend;
}
