// Backend interface for the browser, over the core in emu-worker.js.
//
// Same shape as runner/backend.js where it can be: setPad, onFrameEnd,
// readMem. Calls that need the core's answer are async here, because the
// core runs in a Worker. It knows nothing about FF7.

import { padMask } from './pad.js';

export const DEFAULT_CORE_OPTIONS = Object.freeze({
  // The core hands slot 1's card to the frontend, which stores it.
  pcsx_rearmed_memcard1: 'libretro',
});

/**
 * Start the core worker. Resolves once the Wasm module is ready.
 *
 * @param {object} [opts]
 * @param {Record<string,string>} [opts.coreOptions]
 * @param {(msg: string) => void} [opts.onError]   unsolicited worker errors
 * @param {(samples: Float32Array) => void} [opts.onAudio]
 * @param {(bytes: Uint8Array) => void} [opts.onCard]  the card changed in the core
 * @param {(gate: {active: boolean, reason: string|null}) => void} [opts.onSemantic]  the semantic layer hash gate ran (#75)
 * @param {(sample: {rows: object[]}) => void} [opts.onState]  a changed debug overlay sample (#79); see overlay-state.js
 */
export async function createWorkerBackend(opts = {}) {
  const worker = new Worker(new URL('./emu-worker.js', import.meta.url), { type: 'module' });
  const frameListeners = new Set();
  const pending = new Map();
  let nextId = 1;
  let lastFrame = null;
  let loadedInfo = null;
  let semanticGate = null;
  let readyResolve;
  let readyReject;
  let loadWait = null;
  const ready = new Promise((res, rej) => {
    readyResolve = res;
    readyReject = rej;
  });

  worker.onerror = (e) => {
    const msg = e.message || 'the emulator worker failed to start';
    readyReject(new Error(msg));
    opts.onError?.(msg);
  };

  worker.onmessage = ({ data }) => {
    switch (data.type) {
      case 'ready':
        readyResolve(data.buildInfo);
        break;
      case 'loaded':
        loadedInfo = data;
        loadWait?.resolve(data);
        loadWait = null;
        break;
      case 'frame': {
        if (lastFrame) worker.postMessage({ type: 'recycle', buffer: lastFrame.buffer }, [lastFrame.buffer]);
        lastFrame = data;
        for (const fn of frameListeners) fn(data);
        break;
      }
      case 'audio':
        opts.onAudio?.(data.samples);
        break;
      case 'card':
        opts.onCard?.(data.bytes);
        break;
      case 'semantic':
        semanticGate = { active: data.active, reason: data.reason };
        opts.onSemantic?.(semanticGate);
        break;
      case 'state':
        opts.onState?.(data.sample);
        break;
      case 'reply':
        pending.get(data.id)?.resolve(data.value);
        pending.delete(data.id);
        break;
      case 'error':
        if (data.id && pending.has(data.id)) {
          pending.get(data.id).reject(new Error(data.message));
          pending.delete(data.id);
        } else if (loadWait) {
          loadWait.reject(new Error(data.message));
          loadWait = null;
        } else if (!loadedInfo && readyReject) {
          readyReject(new Error(data.message));
          opts.onError?.(data.message);
        } else {
          opts.onError?.(data.message);
        }
        break;
      default:
        break;
    }
  };

  const request = (msg) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id });
  });

  worker.postMessage({
    type: 'init',
    options: { ...DEFAULT_CORE_OPTIONS, ...(opts.coreOptions ?? {}) },
  });
  const buildInfo = await ready;

  const backend = {
    buildInfo: () => buildInfo,
    get loaded() {
      return loadedInfo;
    },
    /** { active, reason } once the hash gate has run for the loaded disc, else null. */
    get semanticGate() {
      return semanticGate;
    },
    get frame() {
      return lastFrame?.frame ?? 0;
    },

    /** Boot from the chosen files (read in place, never uploaded). */
    loadFiles(files, card = null) {
      if (loadWait) return Promise.reject(new Error('already loading'));
      return new Promise((resolve, reject) => {
        loadWait = { resolve, reject };
        worker.postMessage({ type: 'load', files: [...files], card });
      });
    },

    /** Set a pad's held buttons: mask number, name array, or "a,b" string. */
    setPad(state, port = 0) {
      if (port !== 0 && port !== 1) throw new RangeError(`pad port must be 0 or 1, got ${port}`);
      const mask = padMask(state);
      worker.postMessage({ type: 'pad', port, mask });
      return mask;
    },

    /** Called with { frame, width, height, buffer } after each drawn batch. */
    onFrameEnd(fn) {
      if (typeof fn !== 'function') throw new TypeError('onFrameEnd needs a function');
      frameListeners.add(fn);
      return () => frameListeners.delete(fn);
    },
    lastFrame: () => lastFrame,

    /** Copy of main RAM at a PS1 address (KUSEG/KSEG0/KSEG1). */
    readMem(addr, len = 1) {
      return request({ type: 'readMem', addr, len });
    },

    /** Start or stop the worker sampling game state for the debug overlay (#79). */
    setOverlay(on) {
      worker.postMessage({ type: 'overlay', on: on === true });
    },

    pause: () => worker.postMessage({ type: 'pause' }),
    resume: () => worker.postMessage({ type: 'run' }),

    /** The slot 1 card as the core holds it now, or null before a load. */
    getCard: () => request({ type: 'getCard' }),
    /** Replace the slot 1 card in the running core. */
    setCard(bytes) {
      worker.postMessage({ type: 'setCard', bytes });
    },

    close() {
      worker.terminate();
      frameListeners.clear();
    },
  };
  return backend;
}
