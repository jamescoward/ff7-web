// Page wiring: file pick -> core worker; frames -> canvas; touch pad and
// keyboard -> setPad; audio -> worklet; memory card <-> browser storage.

import { createAutoControls, AUTO_FLAG, WORLD_DRAG_FLAG } from './auto-controls.js';
import { createAudio } from './audio.js';
import { createBattleHud, HUD_FLAG } from './battle-hud.js';
import { createBorderCrop, CROP_FLAG } from './border-crop.js';
import { cropAspect } from './crop.js';
import { createCrtFilter, CRT_DEFAULT, CRT_FLAG, CRT_LEVELS } from './crt-filter.js';
import { BATTLE_PANEL_FLAG, createBattlePanel } from './battle-panel.js';
import { BATTLE_CROP_FLAG, createBattleCrop } from './battle-crop.js';
import { createDialogueTaps, TAPS_FLAG } from './dialogue-taps.js';
import { createInteractLabel, INTERACT_FLAG } from './interact-label.js';
import { createMenuPanel, PANEL_FLAG } from './menu-panel.js';
import { createNamingConfirm, NAMING_FLAG } from './naming-confirm.js';
import { createItemScreen, ITEM_FLAG } from './native-item.js';
import { createEquipScreen, EQUIP_FLAG } from './native-equip.js';
import { createMateriaScreen, MATERIA_FLAG } from './native-materia.js';
import { createGameNames } from './game-names.js';
import { createWorkerBackend } from './backend.js';
import { frameScale, hiResCoreOptions, HIRES_FLAG } from './hi-res.js';
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
labs.registerFlag(WORLD_DRAG_FLAG, {
  label: 'Drag to walk on the world map',
  description: 'With Automatic controls also on: drag-to-walk on the world map too, not only in the field. Use the Controls button for the world-map buttons the field controls lack.',
  pr: 193,
  checklist: [
    'Turn on Automatic controls and this flag, then walk out onto the world map: drag-to-walk is shown.',
    'Drag in each direction: does the player move the way you drag, relative to the camera?',
    'Press Controls: the classic pad, with every world-map button.',
    'Enter a town: drag-to-walk stays; start a battle: the pad.',
    'This flag off: the world map shows the classic pad, as before.',
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
  pr: 178,
  checklist: [
    'In a field conversation, tap the picture when the text has finished: it advances.',
    'Tap while the text is still typing: nothing happens.',
    'With no window open, tapping the picture does nothing.',
    'Drag-to-walk and the classic pad still work as before.',
    'Flag off: tapping the picture does nothing.',
  ],
});
labs.registerFlag(INTERACT_FLAG, {
  label: 'Context Interact label',
  description: 'With drag-to-walk on, the Interact button says Talk when a person is in reach, Exit at an exit, and dims when nothing is in reach. It still presses Circle. It stays plain until the game reads behind it are confirmed.',
  pr: 217,
  checklist: [
    'Walk up to a person and face them: does Interact say Talk, and does a tap talk?',
    'Stand on an exit line: does it say Exit? Walk away: does it dim?',
    'Does the label flicker or lag while walking?',
    'A dimmed Interact still presses Circle (examine, save point).',
    'Flag off: the button always says Interact; the classic pad still works.',
  ],
});
labs.registerFlag(PANEL_FLAG, {
  label: 'Tap-to-select main menu',
  description: 'In the field main menu, a panel below the picture lists the ten commands. Tap one: the cursor moves there and Circle is pressed. Back and Close press Triangle. Portrait only.',
  pr: 115,
  checklist: [
    'Open the main menu (Triangle): the panel appears below the picture; close it: it goes.',
    'Tap Status, then Back: does the cursor land on Status, and does Back return to the list?',
    'Does each label match the game\'s own row (Item to Save, top to bottom)?',
    'Tap PHS or Save when they are greyed out: the game ignores it, nothing breaks.',
    'The classic pad and the picture still work while the panel is up.',
  ],
});
labs.registerFlag(BATTLE_PANEL_FLAG, {
  label: 'Battle command panel',
  description: 'In battle, while a command menu is open, large buttons below the picture: tap Command 1 to 4 to move the cursor there and press Circle. In target selection: Prev, Next, Confirm, Back. Portrait only.',
  pr: 116,
  checklist: [
    'In a battle with Cloud, portrait: the panel appears when his menu opens; tap Command 1, then Confirm: he attacks.',
    'Tap Command 2 (or a lower row): does the cursor land on that row before Circle?',
    'In target selection: do Prev and Next move the target, and does Back return to the commands?',
    'With Barret or Tifa acting, the command rows are greyed out (their rows are not confirmed yet); the targeting buttons still work.',
    'The classic pad and the battle status strip still work while the panel is up.',
  ],
});
labs.registerFlag(ITEM_FLAG, {
  label: 'Native Item screen',
  description: 'When the game\'s Item screen is open, a native panel covers the picture: the visible item page (item numbers and counts, no names) and the party\'s HP and MP. Tap an item, then a party member: the cursors move there, Circle is pressed, and the panel reads the count and HP to confirm the use. Back presses Cross; Hide shows the picture again.',
  pr: 211,
  checklist: [
    'Main menu, Item: the panel covers the picture; leave Item (Back or the pad): the picture comes back.',
    'Tap an item, then a hurt party member: is it used on that member, and does the panel say "Used" with the new count and HP?',
    'Does each row match the game\'s own list (same order, same counts)?',
    'Tap Hide: the picture shows until Item is closed and opened again.',
    'The classic pad still works while the panel is up (portrait and landscape).',
  ],
});
labs.registerFlag(EQUIP_FLAG, {
  label: 'Native Equip screen',
  description: 'When the game\'s Equip screen is open, a native panel covers the picture: each party member\'s weapon, armor and accessory, and the spare weapons (numbers and counts, no names). With one party member, tap the first spare weapon: Circle, then Circle, is pressed and the panel reads the weapon to confirm the change. Other weapons and larger parties are shown but not tappable yet. Back presses Cross; Hide shows the picture again.',
  pr: 214,
  checklist: [
    'Main menu, Equip, pick a member: the panel covers the picture; leave Equip: the picture comes back.',
    'With only Cloud in the party and a spare weapon: tap it once the button is enabled. Does the panel say "Equipped", and does the game agree?',
    'Do the member rows and the spare weapons match the game (same numbers and counts)?',
    'Use the pad on the Equip screen: the weapon button turns off until Equip is closed and reopened. Hide shows the picture.',
    'The classic pad still works while the panel is up (portrait and landscape).',
  ],
});
labs.registerFlag(MATERIA_FLAG, {
  label: 'Native Materia screen',
  description: 'When the game\'s Materia screen is open, a native panel covers the picture: the member\'s weapon materia slots and every materia in the inventory (numbers and AP, no names). With one party member, tap an empty weapon slot, then a materia: the cursors move there one step at a time, Circle is pressed, and the panel reads both slots to confirm the move. Armor slots and larger parties are not offered yet. Back presses Cross; Hide shows the picture again.',
  pr: 259,
  checklist: [
    'Main menu, Materia, pick Cloud: the panel covers the picture; leave Materia: the picture comes back.',
    'With only Cloud in the party: tap an empty weapon slot, then a materia far down the list. Does the panel say "Equipped", and does the game agree?',
    'Do the weapon slots and the materia list match the game (same numbers, AP and order)?',
    'Tap Hide: the picture shows until Materia is closed and opened again. Back leaves the screen.',
    'The classic pad still works while the panel is up (portrait and landscape).',
  ],
});
// Game names (#260): registers its Labs flag; tables built on the device from the imported disc; the
// panels show ID labels whenever names() is null (flag off or not read).
const gameNames = createGameNames({ labs, onStatus: (msg) => setStatus(msg, '', { clearAfter: NOTICE_MS }) });
labs.registerFlag(CROP_FLAG, {
  label: 'Crop black borders',
  description: 'In the field and in battle, the picture drops black borders around the scene, so it fills more of the screen. Movies, menus and every other mode show the full frame.',
  pr: 213,
  checklist: [
    'Field rooms and a battle: is anything cut off at an edge?',
    'Is there visible pumping (the picture resizing) in dark scenes or fades?',
    'Open the menu, play a movie: is the full frame shown at once?',
    'Portrait: is the picture larger with the flag on than off?',
    'The classic pad and drag-to-walk still work as before.',
  ],
});
labs.registerFlag(BATTLE_CROP_FLAG, {
  label: 'Battle scene crop',
  description: 'In battle, the picture shows only the battle scene and leaves out the game\'s own command and status windows at the bottom; the battle command panel and status strip take their place (in landscape, the panel sits in a row below the shorter picture). Needs the Battle command panel flag.',
  pr: 136,
  checklist: [
    'Portrait, in a battle, with Battle command panel on: is any part of the battle scene (enemies, party, effects) cut off at the bottom?',
    'Does any part of the game\'s own command or status window still show at the bottom edge?',
    'Is the command panel usable with one thumb, and does it stay clear of the picture?',
    'Leave the battle (win or flee): is the full picture back at once?',
    'Landscape, in a battle: is the command row below the picture easy to reach, and clear of the pad and Start/Select?',
  ],
});
labs.registerFlag(CRT_FLAG, {
  label: 'CRT filter',
  description: 'A subtle scanline look on the picture: one dimmed line per game line, drawn after any crop. Only the shown picture changes; overlays and panels stay sharp. Choose the strength below.',
  pr: 251,
  setting: { label: 'Strength', choices: CRT_LEVELS.map(({ value, label }) => ({ value, label })), initial: CRT_DEFAULT },
  checklist: [
    'Field and battle, portrait and landscape: does the picture look subtle, not blurry or darker overall?',
    'Do you see moiré or uneven lines (bands that come and go) anywhere?',
    'At 1x and 2x speed (Speed flag): any stutter with the filter on that is not there with it off?',
    'Debug overlay, panels and labels on top: are they sharp (not lined)?',
    'Try each strength in the Labs panel: is Subtle the right default?',
  ],
});
labs.registerFlag(NAMING_FLAG, {
  label: 'Use default name',
  description: 'On a character naming screen, a button in the picture\'s top-right corner keeps the default name (it presses Start, then Circle, until the screen closes). The classic pad still types a name.',
  pr: 295,
  checklist: [
    'At Cloud\'s naming screen (first reactor, after the gate scene): is the button shown, and does a tap keep the name Cloud?',
    'After the screen closes: the button goes away and the scene carries on.',
    'Does the button hide anything you need on the naming screen?',
    'The classic pad can still type a different name on that screen.',
    'Flag off: no button; the classic pad still works.',
  ],
});
labs.registerFlag(HIRES_FLAG, {
  label: '2x resolution',
  description: 'The core draws 3D at twice the PS1 resolution (sharper models; 2D backgrounds stay as they are). It may run slower. Takes effect when the page is reloaded.',
  pr: 252,
  checklist: [
    'Field and battle: are 3D models sharper, and do they still line up with the 2D backgrounds?',
    'Does the game run at full speed at 1x (and 2x with the Speed flag), or does it stutter or step down?',
    'Play for 10 minutes (field, battle, menu, a movie): no crash or freeze?',
    'Suspend and resume (Suspend flag) with 2x on: does Resume land in the same place?',
    'Turn it off and reload: is the picture as before?',
  ],
});
// The core reads its options once, when it starts: freeze the flag for this load.
const hiResActive = labs.isOn(HIRES_FLAG);
if (hiResActive) document.documentElement.dataset.hiRes = '';
labs.onChange((name) => {
  if (name === HIRES_FLAG && labs.isOn(HIRES_FLAG) !== hiResActive) {
    setStatus('2x resolution changes when the page is reloaded.', '', { clearAfter: NOTICE_MS });
  }
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
// Border crop (#24): the crop computed for each posted frame, and the last
// frame, so a mode change or a flag toggle redraws at once, even while paused.
const crops = new WeakMap();
let lastFrame = null;
let shown = null; // the part of the frame on the canvas: { x, y, w, h }
let shownAspect = 0;
const root = document.documentElement;
const stage = document.querySelector('.stage');

// Inputs work before the core is ready; the latest mask is sent on load.
const mixer = createInputMixer((mask) => backend?.setPad(mask));
const controls = createControls({ padRoot: $('pad'), fieldRoot: $('field'), toggle: $('controls-btn'), mixer });
const autoControls = createAutoControls({ controls, labs });
const battleHud = createBattleHud({ root: $('hud'), labs });
const dialogueTaps = createDialogueTaps({ target: canvas, mixer, labs });
const interactLabel = createInteractLabel({ fieldRoot: $('field'), labs });
const menuPanel = createMenuPanel({ root: $('menu-panel'), mixer, labs });
// Naming screen (#289): its button lives in the picture's corner; the element is made here.
const namingRoot = document.createElement('div');
namingRoot.className = 'naming-confirm';
namingRoot.id = 'naming-confirm';
namingRoot.setAttribute('role', 'group');
namingRoot.setAttribute('aria-label', 'Naming screen');
namingRoot.hidden = true;
document.querySelector('.screen').append(namingRoot);
const namingConfirm = createNamingConfirm({ root: namingRoot, mixer, labs });
const battlePanel = createBattlePanel({ root: $('battle-panel'), mixer, labs });
const itemScreen = createItemScreen({ root: $('native-item'), mixer, labs, names: gameNames.names });
const equipScreen = createEquipScreen({ root: $('native-equip'), mixer, labs, names: gameNames.names });
const materiaScreen = createMateriaScreen({ root: $('native-materia'), mixer, labs, names: gameNames.names });
const borderCrop = createBorderCrop({
  labs,
  onChange: () => { if (lastFrame?.buffer?.byteLength) pendingFrame = lastFrame; },
  scaleOf: (f) => frameScale(f, hiResActive),
});
const battleCrop = createBattleCrop({
  labs,
  onChange: () => { if (lastFrame?.buffer?.byteLength) pendingFrame = lastFrame; },
});
const keyboard = createKeyboard({ onChange: (m) => mixer.set('keys', m) });
// CRT filter (#251): redraw the last frame when it is switched or its strength changes.
const crt = createCrtFilter({ canvas, ctx: ctx2d, labs });
labs.onChange((name) => { if (name === CRT_FLAG && lastFrame?.buffer?.byteLength) pendingFrame = lastFrame; });

function draw() {
  requestAnimationFrame(draw);
  const f = pendingFrame;
  if (!f) return;
  pendingFrame = null;
  // The battle scene crop (#136) takes precedence over the border crop in battle.
  const scene = battleCrop.frame(f);
  const c = scene ?? (borderCrop.allowed ? crops.get(f) ?? null : null);
  if (scene) root.dataset.battleCropOn = '';
  else delete root.dataset.battleCropOn;
  if (c) {
    drawCropped(f, c);
  } else {
    if (shownAspect) {
      // Back to the full frame: drop the crop's aspect (the default is 4:3).
      shownAspect = 0;
      stage.style.removeProperty('--screen-aspect');
      delete root.dataset.borderCropOn;
    }
    if (crt.on) {
      crt.draw(f, { x: 0, y: 0, w: f.width, h: f.height });
    } else {
      if (canvas.width !== f.width || canvas.height !== f.height) {
        canvas.width = f.width;
        canvas.height = f.height;
      }
      ctx2d.putImageData(new ImageData(new Uint8ClampedArray(f.buffer), f.width, f.height), 0, 0);
    }
  }
  shown = { x: c?.x ?? 0, y: c?.y ?? 0, w: c?.w ?? f.width, h: c?.h ?? f.height };
  drawn = f.frame;
}
// Only the crop is drawn, moved to the canvas origin; the screen box takes the
// crop's share of 4:3, so the pixel aspect ratio is kept.
function drawCropped(f, c) {
  if (crt.on) {
    crt.draw(f, c);
  } else {
    if (canvas.width !== c.w || canvas.height !== c.h) {
      canvas.width = c.w;
      canvas.height = c.h;
    }
    ctx2d.putImageData(new ImageData(new Uint8ClampedArray(f.buffer), f.width, f.height), -c.x, -c.y, c.x, c.y, c.w, c.h);
  }
  const aspect = cropAspect(c, f.width, f.height);
  if (Math.abs(aspect - shownAspect) > 1e-3) {
    shownAspect = aspect;
    stage.style.setProperty('--screen-aspect', aspect.toFixed(4));
    root.dataset.borderCropOn = '';
  }
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
  coreOptions: hiResCoreOptions(hiResActive),
  onAudio: (s) => audio.push(s),
  onCard: (bytes) => {
    if (!cardProblem(bytes)) persistCard(bytes);
  },
  onError: (msg) => setStatus(msg, 'error'),
  onSemantic: (gate) => {
    overlay.setGate(gate);
    autoControls.setGate(gate);
    borderCrop.setGate(gate);
    battleCrop.setGate(gate);
    battleHud.setGate(gate);
    dialogueTaps.setGate(gate);
    interactLabel.setGate(gate);
    menuPanel.setGate(gate);
    namingConfirm.setGate(gate);
    battlePanel.setGate(gate);
    itemScreen.setGate(gate);
    equipScreen.setGate(gate);
    materiaScreen.setGate(gate);
    gameNames.setGate(gate);
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
  borderCrop.setBackend(b);
  battleCrop.setBackend(b);
  battleHud.setBackend(b);
  dialogueTaps.setBackend(b);
  interactLabel.setBackend(b);
  menuPanel.setBackend(b);
  namingConfirm.setBackend(b);
  battlePanel.setBackend(b);
  itemScreen.setBackend(b);
  equipScreen.setBackend(b);
  materiaScreen.setBackend(b);
  gameNames.setBackend(b);
  applySpeedFlag();
  backend.onFrameEnd((f) => {
    const c = borderCrop.frame(f);
    if (c) crops.set(f, c);
    lastFrame = f;
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
    // Pause, then ask for the state (#195): the worker answers messages in
    // order, so the state it returns is the paused core's, with no frame run
    // in between. Both messages are posted synchronously here, before iOS can
    // freeze the page.
    if (backend?.loaded) backend.pause();
    suspend.saveNow();
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
  borderCrop,
  battleCrop,
  battleHud,
  dialogueTaps,
  interactLabel,
  menuPanel,
  namingConfirm,
  itemScreen,
  equipScreen,
  materiaScreen,
  gameNames,
  battlePanel,
  crt,
  suspend,
  drawnFrame: () => drawn,
  /** The part of the frame on screen: { x, y, w, h }, or null before a frame (#24). */
  shownRect: () => (shown ? { ...shown } : null),
};
