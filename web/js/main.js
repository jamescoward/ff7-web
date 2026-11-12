// Page wiring: file pick -> core worker; frames -> canvas; touch pad and
// keyboard -> setPad; audio -> worklet; memory card <-> browser storage.

import { createAutoControls, AUTO_FLAG } from './auto-controls.js';
import { createAudio } from './audio.js';
import { createBattleHud, HUD_FLAG } from './battle-hud.js';
import { createDialogueTaps, TAPS_FLAG } from './dialogue-taps.js';
import { createWorkerBackend } from './backend.js';
import { ACCEPT } from './files.js';
import { createControls } from './controls.js';
import { createKeyboard } from './keyboard.js';
import { cardProblem, createCardStore, downloadCard, readCardFile } from './memcard.js';
import { createOverlay } from './overlay.js';
import { createInputMixer } from './pad.js';
import * as labs from './labs.js';
import { initSafeLayout } from './safe-layout.js';
import { nextSpeed } from './speed.js';
import { createStateStore, createSuspend } from './suspend.js';

const $ = (id) => document.getElementById(id);
const canvas = $('screen');
const ctx2d = canvas.getContext('2d', { alpha: false });
const status = $('status');
const fileInput = $('file-input');
fileInput.accept = ACCEPT;

// Card messages are confirmations: they clear themselves (#66). Any message
// can be tapped away. The start-up hint and load errors stay until then.
const NOTICE_MS = 6000;
let statusTimer = 0;
const setStatus = (text, kind = '', { clearAfter = 0 } = {}) => {
  clearTimeout(statusTimer);
  status.textContent = text;
  status.dataset.kind = kind;
  status.hidden = !text;
  if (text && clearAfter) statusTimer = setTimeout(() => setStatus(''), clearAfter);
};
status.addEventListener('click', () => setStatus(''));

// The Card panel opens just below its button: the top bar wraps to two rows on
// narrow phones, so a fixed offset could cover the button. A tap outside, or
// finishing an import/export, closes it.
const cardMenu = document.querySelector('.menu');
const cardPanel = cardMenu.querySelector('.menu-body');
function placeCardPanel() {
  const below = cardMenu.querySelector('summary').getBoundingClientRect().bottom;
  const top = Math.round(below + 8);
  cardPanel.style.top = `${top}px`;
  // Stay inside the viewport above the home-bar inset: the panel scrolls if it is taller.
  const inset = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
  cardPanel.style.maxHeight = `${Math.max(88, Math.floor(window.innerHeight - inset - top - 8))}px`;
  cardPanel.style.overflowY = 'auto';
}
cardMenu.querySelector('summary').addEventListener('click', placeCardPanel);
window.addEventListener('resize', () => { if (cardMenu.open) placeCardPanel(); });
document.addEventListener('pointerdown', (e) => {
  if (cardMenu.open && !cardMenu.contains(e.target)) cardMenu.open = false;
});
const closeCardMenu = () => { cardMenu.open = false; };

// Labs (#105): off-by-default feature flags. Each names its PR and its Tier 3
// checklist (#137), copied from the trip log #123.
labs.registerFlag('speed', {
  label: 'Speed toggle',
  description: 'A top-bar button runs the game at 1x, 2x or 3x. Sound is muted above 1x.',
  pr: 160,
  checklist: [
    'The button cycles 1x/2x/3x and the game visibly speeds up.',
    'At 2x and 3x there is no sound; back at 1x the sound is fine (no crackle or backlog).',
    'Pad and drag-to-walk respond at 2x.',
    'At 3x in a busy scene: does it step down by itself, and does the notice show?',
    'Flag off: no button, nothing changed.',
  ],
});
labs.registerFlag('suspend', {
  label: 'Suspend and resume',
  description: 'When you leave the page, the game is stored on this device; Resume picks it up. Card menu: Export state / Import state.',
  pr: 161,
  checklist: [
    'Load the disc and play into a field.',
    'Leave Safari (switch app or lock), come back, reload, load the same disc: Resume is offered and lands in the same place.',
    'Card menu, Export state, reload, Import state: back at the exported point.',
    'Import a damaged file: an error message, the game unchanged.',
    'An in-game save on the memory card still works after a resume.',
  ],
});
labs.registerFlag(AUTO_FLAG, {
  label: 'Automatic controls',
  description: 'Drag to walk in the field, the classic pad in battles, menus, the world map, minigames and movies. The Controls button still overrides until the next change.',
  pr: 163,
  checklist: [
    'Walk in the field: drag-to-walk is shown.',
    'Enter a battle: the classic pad appears.',
    'Leave it: drag-to-walk returns.',
    'Open the menu: the pad.',
    'Press Controls in a battle: your choice holds until the next mode change.',
  ],
});
labs.registerFlag(HUD_FLAG, {
  label: 'Battle status strip',
  description: 'In battle, large HP, MP, ATB and limit bars for each party slot below the picture (portrait).',
  pr: 165,
  checklist: [
    'In a battle, portrait: are the strip\'s numbers readable?',
    'Do HP and MP match the game\'s own?',
    'Do the ATB and limit bars fill like the game\'s?',
    'With Safe-area layout also on: is the smaller picture acceptable?',
    'Landscape: the strip is hidden (placement question in #166).',
  ],
});
labs.registerFlag(TAPS_FLAG, {
  label: 'Tap to advance dialogue',
  description: 'When a message window has finished its text and waits, tapping the picture presses Circle once. Choices are not covered yet.',
  pr: 114,
  checklist: [
    'In a field conversation, tap the picture when the text has finished: it advances.',
    'Tap while the text is still typing: nothing happens.',
    'With no window open, tapping the picture does nothing.',
    'Drag-to-walk and the classic pad still work as before.',
    'Flag off: tapping the picture does nothing.',
  ],
});
labs.createLabsPanel({ button: $('labs-btn'), panel: $('labs-panel') });
initSafeLayout();

// The debug overlay (#79): off by default, and its toggle stays hidden unless
// the worker's hash gate says this is the USA disc.
const overlay = createOverlay({
  panel: $('debug'),
  toggle: $('debug-btn'),
  onToggle: (on) => backend?.setOverlay(on),
});

// Speed toggle (#118): a Labs flag. The button cycles 1x/2x/3x and the worker
// drops back a step by itself when the device cannot keep up.
let backend = null; // set once the worker is ready
const speedBtn = $('speed-btn');
function showSpeed(n) {
  speedBtn.textContent = `${n}x`;
  speedBtn.dataset.speed = String(n);
  speedBtn.setAttribute('aria-label', `Game speed ${n}x`);
}
function applySpeedFlag() {
  const on = labs.isOn('speed');
  speedBtn.hidden = !on;
  if (!on && backend && backend.speed > 1) backend.setSpeed(1);
  showSpeed(on && backend?.speed > 0 ? backend.speed : 1);
}
speedBtn.addEventListener('click', () => {
  if (backend?.setSpeed) showSpeed(backend.setSpeed(nextSpeed(backend.speed)));
});
labs.onChange((name) => { if (name === 'speed') applySpeedFlag(); });
applySpeedFlag();

const suspend = createSuspend({
  getBackend: () => backend,
  labs,
  store: createStateStore(),
  ui: {
    menu: cardPanel,
    resume: $('resume-btn'),
    fresh: $('fresh-btn'),
  },
  setStatus,
  closeMenu: closeCardMenu,
});

const audio = createAudio();
const cards = createCardStore();
let pendingFrame = null;
let drawn = 0;

// Inputs work before the core is ready; the latest mask is sent on load.
const mixer = createInputMixer((mask) => backend?.setPad(mask));
const controls = createControls({ padRoot: $('pad'), fieldRoot: $('field'), toggle: $('controls-btn'), mixer });
const autoControls = createAutoControls({ controls, labs });
const battleHud = createBattleHud({ root: $('hud'), labs });
const dialogueTaps = createDialogueTaps({ target: canvas, mixer, labs });
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
  onSemantic: (gate) => {
    overlay.setGate(gate);
    autoControls.setGate(gate);
    battleHud.setGate(gate);
    dialogueTaps.setGate(gate);
  },
  onState: (sample) => overlay.update(sample),
  onSpeed: (n, auto) => {
    showSpeed(n);
    if (auto) {
      speedBtn.dataset.stepped = 'true';
      setStatus(`This device could not keep up: back to ${n}x.`, '', { clearAfter: NOTICE_MS });
    }
  },
}).then((b) => {
  backend = b;
  autoControls.setBackend(b);
  battleHud.setBackend(b);
  dialogueTaps.setBackend(b);
  applySpeedFlag();
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
    suspend.checkOffer();
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
      setStatus('There is no memory card yet: it is created when a game first runs.', 'error', { clearAfter: NOTICE_MS });
      closeCardMenu();
      return;
    }
    downloadCard(bytes);
    closeCardMenu();
  } catch (e) {
    setStatus(`Export failed: ${e.message}`, 'error', { clearAfter: NOTICE_MS });
    closeCardMenu();
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
      : 'Card imported. It will be in slot 1 when a game starts.', '', { clearAfter: NOTICE_MS });
  } catch (err) {
    setStatus(`Import failed: ${err.message}`, 'error', { clearAfter: NOTICE_MS });
  }
  closeCardMenu();
});

// Stop when hidden: saves battery, releases held buttons, and stores the card.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    controls.releaseAll();
    keyboard.releaseAll();
    // Ask for the state before pausing: the worker answers messages in order.
    suspend.saveNow();
    if (backend?.loaded) backend.pause();
  } else if (backend?.loaded) {
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
  overlay,
  labs,
  autoControls,
  battleHud,
  dialogueTaps,
  suspend,
  drawnFrame: () => drawn,
};
