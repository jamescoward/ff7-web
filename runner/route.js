// #120 (third budget): the format 2 `route` script step. Original project
// code, GPL-2.0-or-later.
//
// Inside the sandbox, the step reads the current field's walkmesh
// (runner/semantic/walkmesh.js, the synced copy of semantic/walkmesh.js),
// searches a triangle path to a goal (a gateway line, or talk range of a
// field model) and steers the player along it with pad directions, one
// frame at a time, re-planning whenever the player leaves the path. It is
// reusable for any field (#168 needs it for mds7st1).
//
// Only numbers leave (docs/SECURITY.md): an outcome code, path lengths in
// triangles, how many triangles are locked, frames, and the pad legs it
// pressed, packed as direction code * 10000 + frames. No vertex, position
// or other game byte leaves. The emulator is deterministic, so the legs
// replay exactly as ordinary pad input from the same start.

import { padMask } from './pad.js';
import {
  ROUTE_BUTTONS,
  ROUTE_TALK_BUTTON,
  ROUTE_WATCH,
  blockingModel,
  findPath,
  goalReached,
  legsOf,
  lockedCount,
  namingScreen,
  openWindow,
  padFor,
  readControlDirection,
  readEventCmd,
  readModel,
  readPlayer,
  readS16,
  readWalkmesh,
  routeGoal,
  steerPoint,
  windowWaiting,
} from './semantic/walkmesh.js';

/** How a route ended (the `outcome` report). 0 is "not run" (the script stopped before the step). */
export const ROUTE_OUTCOME = Object.freeze({ reached: 1, stuck: 2, timeout: 3, left: 4, noMesh: 5, noGoal: 6, noPath: 7 });
/**
 * What a route step may report as metrics, besides its legs. talk: frames
 * of the talk phase until a message window opened (0: none opened);
 * talked: frames until every window was closed again (0: not closed);
 * window: which window opened first (index + 1); detours: sidesteps used;
 * block: the model in solid contact at the last stall (index + 1, 0 none).
 * Attempt 3 (stall diagnostics): opened: windows that nudges opened and
 * pressed through; wstall: the window open at the last stall (index + 1,
 * 0 none); remain: triangles on the path from where the route ended to the
 * goal (1 = in a goal triangle, 0 = no path); near: the nearest other model
 * within NEAR_RANGE of the player at the last stall, ignoring height and
 * solidity (index + 1, 0 none).
 * Budget 4 (scene driving): scenes: scene drives run; wmask: windows seen
 * open during them (bit i for window i); named: the route frame (+ 1) at
 * which the naming screen was first seen (0 never); nleft: frames spent on
 * the naming screen before field mode came back (0: never came back);
 * smode: the first gameState other than field seen in a drive (0 none);
 * evt: fieldEventCmd at that frame (0 also when no other mode was seen).
 */
export const ROUTE_REPORT = Object.freeze(['outcome', 'path', 'free', 'locked', 'frames', 'legs', 'talk', 'talked', 'window', 'detours', 'block', 'opened', 'wstall', 'remain', 'near', 'scenes', 'wmask', 'named', 'nleft', 'smode', 'evt']);
/** Frames without moving before a route counts as stuck (a step's `patience` overrides it). */
export const ROUTE_STUCK_FRAMES = 60;
/** Most legs one step may report (metrics are 8 a scenario; more go to later scenarios with legFrom). */
export const ROUTE_MAX_LEG_METRICS = 8;
/** A detour: this many frames sideways (90 degrees off the last direction), then this many along it. */
export const DETOUR_SIDE = 24;
export const DETOUR_ON = 16;
/** Talk phase: Interact is held this many frames, at most every ROUTE_TALK_EVERY frames. */
export const ROUTE_TALK_HOLD = 4;
export const ROUTE_TALK_EVERY = 20;
/** Talk phase: every window closed this long after one opened ends the talk. */
export const ROUTE_TALK_CLOSED = 30;

/** The leg code of frames pressed with no direction held. */
export const NO_DIRECTION = 8;
/** Ground distance (field units) within which `near` names a model. */
export const NEAR_RANGE = 256;
/** Scene drive: it ends once every window has been closed, in field mode, for this many frames. */
export const SCENE_QUIET = 90;
/** Naming screen: each press group of `naming` is held this many frames, one group every NAME_EVERY frames, in turn. */
export const NAME_HOLD = 4;
export const NAME_EVERY = 30;

/** A result with nothing done: every report 0, no legs. */
export const emptyRoute = () => ({ outcome: 0, path: 0, free: 0, locked: 0, frames: 0, legs: [], talk: 0, talked: 0, window: 0, detours: 0, block: 0, opened: 0, wstall: 0, remain: 0, near: 0, scenes: 0, wmask: 0, named: 0, nleft: 0, smode: 0, evt: 0 });

/**
 * Run a route step on a backend. step: { to: { gateway } | { model },
 * timeout, patience?, detour?, talk? }. frame(mask): plays one frame
 * holding `mask` on port 0.
 * - patience: still frames before the route counts as stuck (default 60);
 * - detour: on a stall, up to this many sidesteps (alternating sides), each
 *   followed by a re-plan;
 * - talk (model goals only): after the route ends reached or stuck, up to
 *   this many frames of facing the model and pressing Interact, then
 *   pressing it through every message until all windows are closed.
 * - nudge (attempt 3): on a stall, before any detour, press through a
 *   window that is already open; otherwise hold the last direction and tap
 *   Interact for up to this many frames, and press through a window that
 *   opens. Once per stall point: a further stall without moving goes on to
 *   the detours.
 * - scene (budget 4): whenever a message window is open or the game is out
 *   of field mode, stop steering and drive the scene for up to this many
 *   frames: press Interact whenever a window waits for Circle, and on the
 *   naming screen press the `naming` groups in turn; the drive ends once
 *   every window has been closed in field mode for SCENE_QUIET frames. Then
 *   the walkmesh is read again and the route re-planned.
 * - naming: press groups (arrays of pad button names) for the naming screen.
 * Returns emptyRoute()'s fields, filled in.
 */
export function runRoute(backend, step, frame) {
  const readMem = (a, l) => backend.readMem(a, l);
  const res = emptyRoute();
  let mesh = readWalkmesh(readMem);
  const cd = readControlDirection(readMem);
  const me0 = readPlayer(readMem);
  if (mesh.error || cd === null || !me0 || me0.posI >= mesh.count) {
    res.outcome = ROUTE_OUTCOME.noMesh;
    return res;
  }
  res.locked = lockedCount(mesh);
  let goal = routeGoal(mesh, readMem, step.to);
  if (goal.error || goal.tris.size === 0) {
    res.outcome = ROUTE_OUTCOME.noGoal;
    return res;
  }
  const startField = readS16(readMem, ROUTE_WATCH.fieldId);
  const locked = findPath(mesh, me0.posI, goal.tris, true);
  const free = findPath(mesh, me0.posI, goal.tris, false);
  res.path = locked ? locked.length : 0;
  res.free = free ? free.length : 0;
  let path = locked ?? free;
  if (!path) {
    res.outcome = ROUTE_OUTCOME.noPath;
    return res;
  }
  const patience = step.patience ?? ROUTE_STUCK_FRAMES;
  const detours = step.detour ?? 0;
  const nudge = step.nudge ?? 0;
  const scene = step.scene ?? 0;
  let nudged = false;
  const codes = [];
  // c: a direction code, or -1 for none; circle: Interact held too. Legs
  // record the direction only (the leg packing has no button field), so a
  // replay of the legs alone omits the nudges' Interact taps.
  const press = (c, circle = false) => {
    const dir = c < 0 ? [] : [...ROUTE_BUTTONS[c]];
    frame(padMask(circle ? [...dir, ROUTE_TALK_BUTTON] : dir));
    codes.push(c);
  };
  let code = -1;
  let last = null;
  let still = 0;
  for (;;) {
    if (goalReached(readMem, goal, startField)) {
      res.outcome = ROUTE_OUTCOME.reached;
      break;
    }
    if (scene === 0 && readS16(readMem, ROUTE_WATCH.gameState) !== ROUTE_WATCH.fieldMode) {
      res.outcome = ROUTE_OUTCOME.left;
      break;
    }
    if (codes.length >= step.timeout) {
      res.outcome = ROUTE_OUTCOME.timeout;
      break;
    }
    if (scene > 0 && inScene(readMem)) {
      res.scenes += 1;
      const pressButtons = (buttons) => {
        frame(padMask(buttons));
        codes.push(-1);
      };
      driveScene(readMem, Math.min(scene, step.timeout - codes.length), pressButtons, step.naming ?? [], res, () => codes.length);
      if (goalReached(readMem, goal, startField)) continue;
      if (readS16(readMem, ROUTE_WATCH.gameState) !== ROUTE_WATCH.fieldMode) continue; // still out: the timeout or the next drive ends it
      // A menu or a scene may have reloaded the field: read the walkmesh again and re-plan.
      const again = readWalkmesh(readMem);
      const here = readPlayer(readMem);
      if (again.error || !here || here.posI >= again.count) {
        res.outcome = ROUTE_OUTCOME.noMesh;
        break;
      }
      const g = routeGoal(again, readMem, step.to);
      if (g.error || g.tris.size === 0) {
        res.outcome = ROUTE_OUTCOME.noGoal;
        break;
      }
      mesh = again;
      goal = g;
      path = findPath(mesh, here.posI, goal.tris, true) ?? findPath(mesh, here.posI, goal.tris, false) ?? path;
      still = 0;
      last = null;
      nudged = false;
      continue;
    }
    if (readS16(readMem, ROUTE_WATCH.gameState) !== ROUTE_WATCH.fieldMode) {
      res.outcome = ROUTE_OUTCOME.left;
      break;
    }
    const me = readPlayer(readMem);
    if (!me) {
      res.outcome = ROUTE_OUTCOME.noMesh;
      break;
    }
    if (last && last.x === me.x && last.y === me.y) still += 1;
    else {
      if (last) nudged = false;
      still = 0;
    }
    last = me;
    if (still >= patience) {
      res.block = blockingModel(readMem, me);
      res.wstall = openWindow(readMem);
      res.near = nearestModel(readMem, me);
      if (nudge > 0 && !nudged && code >= 0) {
        nudged = true;
        const before = codes.length;
        if (res.wstall || nudgeTap(readMem, code, nudge, press, () => codes.length < step.timeout)) {
          res.opened += 1;
          pressThrough(readMem, step.timeout - codes.length, press);
        }
        still = 0;
        last = null;
        if (codes.length > before) continue;
      }
      if (res.detours >= detours || code < 0) {
        res.outcome = ROUTE_OUTCOME.stuck;
        break;
      }
      // Sidestep 90 degrees off the last direction (right first, then left, ...), then on along it.
      const side = (code + (res.detours % 2 === 0 ? 2 : 6)) % 8;
      res.detours += 1;
      for (let f = 0; f < DETOUR_SIDE && codes.length < step.timeout; f++) press(side);
      for (let f = 0; f < DETOUR_ON && codes.length < step.timeout; f++) press(code);
      still = 0;
      last = null;
      const here = readPlayer(readMem);
      if (here && here.posI < mesh.count) path = findPath(mesh, here.posI, goal.tris, true) ?? findPath(mesh, here.posI, goal.tris, false) ?? path;
      continue;
    }
    let i = path.indexOf(me.posI);
    if (i < 0) {
      path = findPath(mesh, me.posI, goal.tris, true) ?? findPath(mesh, me.posI, goal.tris, false);
      if (!path) {
        res.outcome = ROUTE_OUTCOME.noPath;
        break;
      }
      i = 0;
    }
    const target = steerPoint(mesh, path, i, me, readMem, goal);
    if (!target) {
      res.outcome = ROUTE_OUTCOME.noGoal;
      break;
    }
    const dx = target[0] - me.x;
    const dy = target[1] - me.y;
    // On the target point already: keep the last direction (or none yet).
    if (dx !== 0 || dy !== 0) code = padFor(dx, dy, cd, code);
    else if (code < 0) code = 0;
    press(code);
  }
  res.frames = codes.length;
  // A frame with no direction held (a nudge's press-through) packs as code 8.
  res.legs = legsOf(codes.map((c) => (c < 0 ? NO_DIRECTION : c)));
  const end = readPlayer(readMem);
  if (end && end.posI < mesh.count) {
    const rest = findPath(mesh, end.posI, goal.tris, false);
    res.remain = rest ? rest.length : 0;
  }
  const talkable = res.outcome === ROUTE_OUTCOME.reached || res.outcome === ROUTE_OUTCOME.stuck;
  if (step.talk && goal.kind === 'model' && talkable) talkPhase(readMem, goal, cd, step.talk, frame, res);
  return res;
}

/** The nearest other model within NEAR_RANGE of `me` on the ground, ignoring height and solidity (index + 1, 0 none). */
function nearestModel(readMem, me) {
  const n = readS16(readMem, ROUTE_WATCH.modelCount);
  if (n === null || !me) return 0;
  let best = 0;
  let bestD = NEAR_RANGE;
  for (let k = 0; k < Math.min(n, 16); k++) {
    if (k === me.model) continue;
    const m = readModel(readMem, k);
    if (!m) continue;
    const d = Math.hypot(m.x - me.x, m.y - me.y);
    if (d < bestD) {
      best = k + 1;
      bestD = d;
    }
  }
  return best;
}

/** True when a scene holds the player: a message window is open, or the game is out of field mode. */
function inScene(readMem) {
  return openWindow(readMem) !== 0 || readS16(readMem, ROUTE_WATCH.gameState) !== ROUTE_WATCH.fieldMode;
}

/**
 * A scene drive (budget 4), for at most `limit` frames: no direction held;
 * Interact pressed whenever a window waits for Circle; on the naming screen
 * the `naming` press groups in turn; out of field mode otherwise, nothing.
 * Ends once every window has been closed in field mode for SCENE_QUIET
 * frames. Fills res.wmask, res.named, res.nleft, res.smode and res.evt;
 * at() gives the route frame count so far.
 */
function driveScene(readMem, limit, pressButtons, naming, res, at) {
  let closed = 0;
  let hold = 0;
  let rest = 0;
  let nameN = 0;
  for (let m = 0; m < limit; m++) {
    if (namingScreen(readMem)) {
      if (!res.named) res.named = at() + 1;
      const group = naming.length ? naming[Math.floor(nameN / NAME_EVERY) % naming.length] : [];
      pressButtons(nameN % NAME_EVERY < NAME_HOLD ? group : []);
      nameN += 1;
      closed = 0;
      continue;
    }
    const gs = readS16(readMem, ROUTE_WATCH.gameState);
    if (gs !== ROUTE_WATCH.fieldMode) {
      if (!res.smode) {
        res.smode = gs ?? 0;
        res.evt = readEventCmd(readMem) ?? 0;
      }
      pressButtons([]);
      closed = 0;
      continue;
    }
    if (res.named && !res.nleft) res.nleft = Math.max(nameN, 1);
    let open = false;
    ROUTE_WATCH.windows.forEach((a, i) => {
      const v = readS16(readMem, a);
      if (v !== null && v !== 0) {
        open = true;
        res.wmask |= 1 << i;
      }
    });
    closed = open ? 0 : closed + 1;
    if (closed >= SCENE_QUIET) return;
    if (hold === 0 && rest === 0 && windowWaiting(readMem)) hold = ROUTE_TALK_HOLD;
    if (hold > 0) {
      pressButtons([ROUTE_TALK_BUTTON]);
      hold -= 1;
      if (hold === 0) rest = ROUTE_TALK_EVERY - ROUTE_TALK_HOLD;
    } else {
      pressButtons([]);
      if (rest > 0) rest -= 1;
    }
  }
}

/** A nudge: hold direction `code` and tap Interact for up to `limit` frames; true when a window opens. */
function nudgeTap(readMem, code, limit, press, more) {
  for (let n = 0; n < limit && more(); n++) {
    if (openWindow(readMem)) return true;
    press(code, n % ROUTE_TALK_EVERY < ROUTE_TALK_HOLD);
  }
  return openWindow(readMem) !== 0;
}

/**
 * Press Interact whenever a window waits for Circle, with no direction
 * held, until every window has been closed for ROUTE_TALK_CLOSED frames or
 * `limit` frames pass. Returns the frames used.
 */
function pressThrough(readMem, limit, press) {
  let closed = 0;
  let hold = 0;
  let rest = 0;
  for (let m = 0; m < limit; m++) {
    if (openWindow(readMem)) closed = 0;
    else closed += 1;
    if (closed >= ROUTE_TALK_CLOSED) return m;
    if (hold === 0 && rest === 0 && windowWaiting(readMem)) hold = ROUTE_TALK_HOLD;
    if (hold > 0) {
      press(-1, true);
      hold -= 1;
      if (hold === 0) rest = ROUTE_TALK_EVERY - ROUTE_TALK_HOLD;
    } else {
      press(-1);
      if (rest > 0) rest -= 1;
    }
  }
  return limit;
}

/**
 * The talk phase: face the model (hold the pad towards it) and press
 * Interact every ROUTE_TALK_EVERY frames until a window opens, for at most
 * `limit` frames; then, with no direction held, press Interact whenever a
 * window waits for Circle, until every window has been closed for
 * ROUTE_TALK_CLOSED frames (or `limit` more frames pass). Fills res.talk,
 * res.talked and res.window.
 */
function talkPhase(readMem, goal, cd, limit, frame, res) {
  let n = 0;
  let code = -1;
  while (n < limit) {
    const w = openWindow(readMem);
    if (w) {
      res.window = w;
      res.talk = Math.max(n, 1);
      break;
    }
    const me = readPlayer(readMem);
    const m = readModel(readMem, goal.k);
    if (me && m && (m.x !== me.x || m.y !== me.y)) code = padFor(m.x - me.x, m.y - me.y, cd, code);
    const dir = code < 0 ? [] : [...ROUTE_BUTTONS[code]];
    const tap = n % ROUTE_TALK_EVERY < ROUTE_TALK_HOLD;
    frame(padMask(tap ? [...dir, ROUTE_TALK_BUTTON] : dir));
    n += 1;
  }
  if (!res.window) return;
  let closed = 0;
  let hold = 0;
  let rest = 0;
  for (let m = 0; m < limit; m++) {
    if (openWindow(readMem)) closed = 0;
    else closed += 1;
    if (closed >= ROUTE_TALK_CLOSED) {
      res.talked = Math.max(m, 1);
      return;
    }
    if (hold === 0 && rest === 0 && windowWaiting(readMem)) hold = ROUTE_TALK_HOLD;
    if (hold > 0) {
      frame(padMask([ROUTE_TALK_BUTTON]));
      hold -= 1;
      if (hold === 0) rest = ROUTE_TALK_EVERY - ROUTE_TALK_HOLD;
    } else {
      frame(padMask([]));
      if (rest > 0) rest -= 1;
    }
  }
}

/**
 * The metrics a route step reports, from its result: Map(metric name ->
 * number). report names metrics for ROUTE_REPORT keys; leg names metrics
 * for legs legFrom, legFrom + 1, ... (0 past the last leg).
 */
export function routeMetrics(step, res) {
  const out = new Map();
  const r = res ?? emptyRoute();
  const values = { ...r, legs: r.legs.length };
  for (const k of ROUTE_REPORT) if (step.report[k] !== undefined) out.set(step.report[k], values[k]);
  step.leg.forEach((name, j) => out.set(name, r.legs[step.legFrom + j] ?? 0));
  return out;
}
