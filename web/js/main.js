// Page wiring: file pick -> core worker; frames -> canvas; touch pad and
// keyboard -> setPad; audio -> worklet; memory card <-> browser storage.

import { createAudio } from './audio.js';
import { createWorkerBackend } from './backend.js';
import { ACCEPT } from './files.js';
import { createVirtualGamepad } from './gamepad.js';
import { createKeyboard } from './keyboard.js';
import { cardProblem, createCardStore, downloadCard, readCardFile } from './memcard.js';
import { createInputMixer } from './pad.js';

const $ = (id) => document.getElementById(id);
const canvas = $('screen');
const ctx2d = canvas.getContext('2d', { alpha: false });
const status = $('status');
const fileInput = $('file-input');
fileInput.accept = ACCEPT;

const setStatus = (text, kind = '') => {
  status.textContent = text;
  status.dataset.kind = kind;
  status.hidden = !text;
};

const audio = createAudio();
const cards = createCardStore();
let backend = null;
let pendingFrame = null;
let drawn = 0;

// Inputs work before the core is ready; the latest mask is sent on load.
const mixer = createInputMixer((mask) => backend?.setPad(mask));
const pad = createVirtualGamepad($('pad'), { onChange: (m) => mixer.set('touch', m) });
const keyboard = createKeyboard({ onChange: (m) => mixer.set('keys', m) });

function draw() {
  requestAnimationFrame(draw);
  const f = pendingFrame;
  if (!f) return;
  pendingFrame = null;
  if (canvas.width !== f.width || canvas.height !== f.height) {
    canvas.width = f.width;
    canvas.height = f.height;
  }
  ctx2d.putImageData(new ImageData(new Uint8ClampedArray(f.buffer), f.width, f.height), 0, 0);
  drawn = f.frame;
}
requestAnimationFrame(draw);

async function persistCard(bytes) {
  try {
    await cards.save(bytes);
    navigator.storage?.persist?.().catch(() => {});
  } catch (e) {
    console.warn(`could not store the memory card: ${e.message}`);
  }
}

const backendReady = createWorkerBackend({
  onAudio: (s) => audio.push(s),
  onCard: (bytes) => {
    if (!cardProblem(bytes)) persistCard(bytes);
  },
  onError: (msg) => setStatus(msg, 'error'),
}).then((b) => {
  backend = b;
  backend.onFrameEnd((f) => {
    pendingFrame = f;
  });
  return b;
}).catch((e) => {
  setStatus(`The emulator core did not start: ${e.message}`, 'error');
  throw e;
});

// iOS starts audio only inside a gesture: unlock on the tap that opens the picker.
$('load-label').addEventListener('click', () => {
  if (!audio.muted) audio.unlock();
});

// iOS suspends audio again when the file picker covers the page, or when the
// route changes (headphones) or a call comes in. Resume on the next tap or
// key press: these events count as user gestures, pointerdown does not.
for (const type of ['touchend', 'click', 'keydown']) {
  document.addEventListener(type, () => {
    if (audio.needsResume) audio.unlock();
  }, { capture: true, passive: true });
}

// Safari ignores user-scalable=no. CSS touch-action: manipulation stops
// double-tap zoom on most of the page; on the controls, where fast repeated
// taps are the point, cancel the touch itself. Pointer events still fire.
$('pad').addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

fileInput.addEventListener('change', async () => {
  const files = [...fileInput.files];
  fileInput.value = '';
  if (!files.length) return;
  try {
    const b = await backendReady;
    if (b.loaded) {
      setStatus('A program is already running. Reload the page to load another.', 'error');
      return;
    }
    setStatus('Loading…');
    const card = await cards.load().catch(() => null);
    const info = await b.loadFiles(files, card);
    b.setPad(mixer.mask);
    $('load-label').classList.remove('primary');
    setStatus('');
    console.info(`booted ${info.path} at ${info.fps.toFixed(2)} fps`);
  } catch (e) {
    setStatus(e.message, 'error');
  }
});

$('mute-btn').addEventListener('click', (e) => {
  const muted = !audio.muted;
  audio.setMuted(muted);
  if (!muted) audio.unlock();
  e.currentTarget.textContent = muted ? 'Sound off' : 'Sound on';
  e.currentTarget.setAttribute('aria-pressed', String(muted));
});

$('card-export').addEventListener('click', async () => {
  try {
    const live = backend?.loaded ? await backend.getCard() : null;
    const bytes = live ?? (await cards.load());
    if (!bytes) {
      setStatus('There is no memory card yet: it is created when a game first runs.', 'error');
      return;
    }
    downloadCard(bytes);
  } catch (e) {
    setStatus(`Export failed: ${e.message}`, 'error');
  }
});

$('card-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const bytes = await readCardFile(file);
    await cards.save(bytes);
    if (backend?.loaded) backend.setCard(bytes);
    setStatus(backend?.loaded
      ? 'Card imported. If the game had the card open, go back to its title screen before loading.'
      : 'Card imported. It will be in slot 1 when a game starts.');
  } catch (err) {
    setStatus(`Import failed: ${err.message}`, 'error');
  }
});

// Stop when hidden: saves battery, releases held buttons, and stores the card.
document.addEventListener('visibilitychange', () => {
  if (!backend?.loaded) return;
  if (document.hidden) {
    pad.releaseAll();
    keyboard.releaseAll();
    backend.pause();
  } else {
    backend.resume();
  }
});

// For tests and the benchmark page (#8). Exposes no game data.
window.ff7web = {
  get backend() {
    return backend;
  },
  ready: backendReady,
  audio,
  cards,
  mixer,
  drawnFrame: () => drawn,
};
