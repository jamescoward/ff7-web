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
  ROUTE_WATCH,
  findPath,
  goalReached,
  legsOf,
  lockedCount,
  padFor,
  readControlDirection,
  readPlayer,
  readS16,
  readWalkmesh,
  routeGoal,
  steerPoint,
} from './semantic/walkmesh.js';

/** How a route ended (the `outcome` report). 0 is "not run" (the script stopped before the step). */
export const ROUTE_OUTCOME = Object.freeze({ reached: 1, stuck: 2, timeout: 3, left: 4, noMesh: 5, noGoal: 6, noPath: 7 });
/** What a route step may report as metrics, besides its legs. */
export const ROUTE_REPORT = Object.freeze(['outcome', 'path', 'free', 'locked', 'frames', 'legs']);
/** Frames without moving before a route counts as stuck. */
export const ROUTE_STUCK_FRAMES = 60;
/** Most legs one step may report (metrics are 8 a scenario; more go to later scenarios with legFrom). */
export const ROUTE_MAX_LEG_METRICS = 8;

/** A result with nothing done: every report 0, no legs. */
export const emptyRoute = () => ({ outcome: 0, path: 0, free: 0, locked: 0, frames: 0, legs: [] });

/**
 * Run a route step on a backend. step: { to: { gateway } | { model },
 * timeout }. frame(mask): plays one frame holding `mask` on port 0.
 * Returns { outcome, path, free, locked, frames, legs: [packed] }.
 */
export function runRoute(backend, step, frame) {
  const readMem = (a, l) => backend.readMem(a, l);
  const res = emptyRoute();
  const mesh = readWalkmesh(readMem);
  const cd = readControlDirection(readMem);
  const me0 = readPlayer(readMem);
  if (mesh.error || cd === null || !me0 || me0.posI >= mesh.count) {
    res.outcome = ROUTE_OUTCOME.noMesh;
    return res;
  }
  res.locked = lockedCount(mesh);
  const goal = routeGoal(mesh, readMem, step.to);
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
  const codes = [];
  let code = -1;
  let last = null;
  let still = 0;
  for (;;) {
    if (goalReached(readMem, goal, startField)) {
      res.outcome = ROUTE_OUTCOME.reached;
      break;
    }
    if (readS16(readMem, ROUTE_WATCH.gameState) !== ROUTE_WATCH.fieldMode) {
      res.outcome = ROUTE_OUTCOME.left;
      break;
    }
    if (codes.length >= step.timeout) {
      res.outcome = ROUTE_OUTCOME.timeout;
      break;
    }
    const me = readPlayer(readMem);
    if (!me) {
      res.outcome = ROUTE_OUTCOME.noMesh;
      break;
    }
    if (last && last.x === me.x && last.y === me.y) still += 1;
    else still = 0;
    last = me;
    if (still >= ROUTE_STUCK_FRAMES) {
      res.outcome = ROUTE_OUTCOME.stuck;
      break;
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
    frame(padMask([...ROUTE_BUTTONS[code]]));
    codes.push(code);
  }
  res.frames = codes.length;
  res.legs = legsOf(codes);
  return res;
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
