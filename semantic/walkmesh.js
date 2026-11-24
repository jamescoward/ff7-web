// #120 (third budget): the field walkmesh, and pad routes over it.
// Original project code, GPL-2.0-or-later. Plain data and pure functions
// over a readMem(addr, len) -> Uint8Array function; no DOM, Worker, Node or
// timer dependencies, so a native frontend can reuse them.
//
// The layout and the rules restate the field module as described by
// Xeeynamo/ff7-decomp@33ce78c94021b2e1705785347da58a2ca30ba705. Reference
// only: no code is copied; this is an independent implementation of the
// stated layout and conditions (notes/120-touch-playthrough.md, "Third
// budget"):
//   src/field/field_private.h   FieldWalkmesh (u16 triangleCount, u16 pad,
//                               then triangleCount x 3 SVECTOR vertices,
//                               then triangleCount FieldWalkmeshAccess of 3
//                               s16), and D_8009A044 (FieldWalkmesh**).
//   src/field/field_loop.c      g_WalkmeshTriangles = walkmesh data,
//                               g_WalkmeshAccesses right after the vertices.
//   config/symbols.field.us.txt g_WalkmeshTriangles 0x800E4274,
//                               g_WalkmeshAccesses 0x80114458.
//   src/field/field_entity.c    FieldEntityWalkmeshCross (a point is inside
//                               a triangle when all three edge cross products
//                               are >= 0; edge k runs from vertex k to vertex
//                               k + 1 and leads to access k; -1 is a wall; a
//                               set bit `access` of blockedAccesses also
//                               stops the move), and FieldEntityMovementUpdate
//                               (pad -> MoveDir, plus controlDirection).
//   include/game.h              FieldState.blockedAccesses (+0xB2, 64 bytes),
//                               FieldTriggers.controlDirection (+0x09).
//
// Units: field units (FieldEntity PosX/PosY >> 12), as the vertices are.

/** Where the walkmesh is and how it is laid out. */
export const WALKMESH = Object.freeze({
  /** D_8009A044: the address of FieldDatHeader.walkmesh, which points to the FieldWalkmesh. */
  headerRef: 0x8009a044,
  /** g_WalkmeshTriangles (field overlay): must equal walkmesh + dataOffset. */
  trianglesVar: 0x800e4274,
  /** g_WalkmeshAccesses (field overlay): must equal the end of the vertices. */
  accessesVar: 0x80114458,
  dataOffset: 4,
  vertexSize: 8,
  triangleSize: 24,
  accessSize: 6,
  /** g_FieldState (0x8009ABF4) + 0xB2: one bit per triangle a move may not enter. */
  blockedAccesses: 0x8009abf4 + 0xb2,
  blockedBytes: 64,
  /** 64 bytes of bits: no more triangles than this can be locked, so none are expected. */
  maxTriangles: 512,
});

/** g_FieldTriggers and FieldTriggers.controlDirection: added to every pad direction. */
export const FIELD_TRIGGERS_REF = 0x800716c4;
export const CONTROL_DIRECTION = 0x09;

/** FieldEntity (include/game.h): 16 models of 0x84 bytes; PosI is the triangle a model stands in. */
export const ENTITY = Object.freeze({ base: 0x80074ea4, size: 0x84, posX: 0x0c, posY: 0x10, posZ: 0x14, solidOff: 0x59, talkOff: 0x5b, solidRange: 0x6c, talkRange: 0x6e, posI: 0x72 });

/**
 * Pad directions a route uses, by code (clockwise from up), and the MoveDir
 * each gives before controlDirection is added (FieldEntityMovementUpdate).
 */
export const ROUTE_DIRS = Object.freeze(['up', 'up-right', 'right', 'down-right', 'down', 'down-left', 'left', 'up-left']);
export const ROUTE_MOVE_DIR = Object.freeze([0, 224, 192, 160, 128, 96, 64, 32]);
/** The pad buttons each code holds. */
export const ROUTE_BUTTONS = Object.freeze(ROUTE_DIRS.map((d) => Object.freeze(d.split('-'))));

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const s16 = (b, o) => (u16(b, o) << 16) >> 16;
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** readMem wrapped so a bad address gives null instead of throwing. */
function safeRead(readMem, addr, len) {
  try {
    return readMem(addr, len);
  } catch {
    return null;
  }
}

/**
 * The current field's walkmesh: { count, verts: Int16Array(count * 9: x, y,
 * z of vertices 0..2), access: Int16Array(count * 3), blocked:
 * Uint8Array(64) }, or { error } when it can't be read consistently (the two
 * pointers the field module keeps must agree with the header's).
 */
export function readWalkmesh(readMem) {
  const W = WALKMESH;
  const ref = safeRead(readMem, W.headerRef, 4);
  if (!ref) return { error: 'header' };
  const hdr = safeRead(readMem, u32(ref, 0), 4);
  if (!hdr) return { error: 'header' };
  const base = u32(hdr, 0);
  const head = safeRead(readMem, base, 4);
  if (!head) return { error: 'walkmesh' };
  const count = u16(head, 0);
  if (count < 1 || count > W.maxTriangles) return { error: 'count' };
  const tri = base + W.dataOffset;
  const acc = tri + count * W.triangleSize;
  const vars = safeRead(readMem, W.trianglesVar, 4);
  const avar = safeRead(readMem, W.accessesVar, 4);
  if (!vars || !avar || u32(vars, 0) !== tri || u32(avar, 0) !== acc) return { error: 'pointers' };
  const tb = safeRead(readMem, tri, count * W.triangleSize);
  const ab = safeRead(readMem, acc, count * W.accessSize);
  const blocked = safeRead(readMem, W.blockedAccesses, W.blockedBytes);
  if (!tb || !ab || !blocked) return { error: 'walkmesh' };
  const verts = new Int16Array(count * 9);
  for (let t = 0; t < count; t++) {
    for (let v = 0; v < 3; v++) {
      const o = t * W.triangleSize + v * W.vertexSize;
      verts[t * 9 + v * 3] = s16(tb, o);
      verts[t * 9 + v * 3 + 1] = s16(tb, o + 2);
      verts[t * 9 + v * 3 + 2] = s16(tb, o + 4);
    }
  }
  const access = new Int16Array(count * 3);
  for (let i = 0; i < count * 3; i++) access[i] = s16(ab, i * 2);
  return { count, verts, access, blocked: Uint8Array.from(blocked) };
}

/** Whether a move may enter triangle t (locks: honour blockedAccesses). */
export function canEnter(mesh, t, locks = true) {
  if (t < 0 || t >= mesh.count) return false;
  return !(locks && (mesh.blocked[t >> 3] >> (t & 7)) & 1);
}

/** How many triangles blockedAccesses locks. */
export function lockedCount(mesh) {
  let n = 0;
  for (let t = 0; t < mesh.count; t++) if (!canEnter(mesh, t, true)) n += 1;
  return n;
}

const vx = (m, t, v) => m.verts[t * 9 + (v % 3) * 3];
const vy = (m, t, v) => m.verts[t * 9 + (v % 3) * 3 + 1];

/** Centroid of triangle t: [x, y]. */
export function centroid(mesh, t) {
  return [(vx(mesh, t, 0) + vx(mesh, t, 1) + vx(mesh, t, 2)) / 3, (vy(mesh, t, 0) + vy(mesh, t, 1) + vy(mesh, t, 2)) / 3];
}

/** Whether (x, y) is in triangle t, by the game's rule (all edge cross products >= 0). */
export function inTriangle(mesh, t, x, y) {
  for (let k = 0; k < 3; k++) {
    const ex = vx(mesh, t, k + 1) - vx(mesh, t, k);
    const ey = vy(mesh, t, k + 1) - vy(mesh, t, k);
    if ((x - vx(mesh, t, k)) * ey - (y - vy(mesh, t, k)) * ex < 0) return false;
  }
  return true;
}

/** The first triangle containing (x, y), or -1. */
export function locate(mesh, x, y) {
  for (let t = 0; t < mesh.count; t++) if (inTriangle(mesh, t, x, y)) return t;
  return -1;
}

/** Midpoint of the edge from triangle a into its neighbour b: [x, y], or null when they don't share an edge. */
export function portal(mesh, a, b) {
  for (let k = 0; k < 3; k++) {
    if (mesh.access[a * 3 + k] === b) return [(vx(mesh, a, k) + vx(mesh, a, k + 1)) / 2, (vy(mesh, a, k) + vy(mesh, a, k + 1)) / 2];
  }
  return null;
}

/** The point of segment (x1, y1)-(x2, y2) nearest (x, y): [x, y]. */
export function nearestOnSegment(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
  return [x1 + u * dx, y1 + u * dy];
}

/**
 * A* over triangles from `start` to any triangle in `goals` (a Set), moving
 * only into triangles canEnter allows. Cost: centroid to centroid. Returns
 * the triangles in order (start first), or null.
 */
export function findPath(mesh, start, goals, locks = true) {
  if (start < 0 || start >= mesh.count || goals.size === 0) return null;
  const goalPts = [...goals].map((g) => centroid(mesh, g));
  const h = (t) => {
    const [x, y] = centroid(mesh, t);
    return Math.min(...goalPts.map(([gx, gy]) => Math.hypot(gx - x, gy - y)));
  };
  const g = new Map([[start, 0]]);
  const from = new Map();
  const open = new Map([[start, h(start)]]);
  const closed = new Set();
  while (open.size) {
    let cur = -1;
    let best = Infinity;
    for (const [t, f] of open) {
      if (f < best || (f === best && t < cur)) {
        best = f;
        cur = t;
      }
    }
    open.delete(cur);
    if (goals.has(cur)) {
      const path = [cur];
      while (from.has(path[0])) path.unshift(from.get(path[0]));
      return path;
    }
    closed.add(cur);
    const [cx, cy] = centroid(mesh, cur);
    for (let k = 0; k < 3; k++) {
      const n = mesh.access[cur * 3 + k];
      if (closed.has(n) || !canEnter(mesh, n, locks)) continue;
      const [nx, ny] = centroid(mesh, n);
      const cost = g.get(cur) + Math.hypot(nx - cx, ny - cy);
      if (cost < (g.get(n) ?? Infinity)) {
        g.set(n, cost);
        from.set(n, cur);
        open.set(n, cost + h(n));
      }
    }
  }
  return null;
}

/**
 * Triangles a route to a gateway line should end in: those containing a
 * point of the line, or, when none does (lines often lie just off the mesh),
 * the one whose centroid is nearest the line. A Set.
 */
export function gatewayTriangles(mesh, line) {
  const out = new Set();
  for (let i = 0; i <= 8; i++) {
    const x = line.x1 + ((line.x2 - line.x1) * i) / 8;
    const y = line.y1 + ((line.y2 - line.y1) * i) / 8;
    const t = locate(mesh, x, y);
    if (t >= 0) out.add(t);
  }
  if (out.size) return out;
  let best = -1;
  let bestD = Infinity;
  for (let t = 0; t < mesh.count; t++) {
    const [cx, cy] = centroid(mesh, t);
    const [px, py] = nearestOnSegment(cx, cy, line.x1, line.y1, line.x2, line.y2);
    const d = Math.hypot(px - cx, py - cy);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return new Set(best >= 0 ? [best] : []);
}

/** The MoveDir (1/256 turns, FieldEntity.Dir convention: 64 is +x, 128 is +y) of a ground vector. */
export function moveDirOf(dx, dy) {
  const a = Math.round((Math.atan2(dy, dx) * 128) / Math.PI);
  return (((a + 64) % 256) + 256) % 256;
}

const turnDiff = (a, b) => {
  const d = (((a - b) % 256) + 256) % 256;
  return d > 128 ? 256 - d : d;
};

/** How far a code's move is from the wanted MoveDir, in 1/256 turns (0..128). */
export function codeError(code, want, controlDirection) {
  return turnDiff((ROUTE_MOVE_DIR[code] + controlDirection) & 0xff, want);
}

/**
 * The pad direction code that moves nearest to (dx, dy), given the field's
 * controlDirection. With `keep` (the code held now), keep it while it is
 * within `slack` 1/256 turns of the wanted direction, so a route does not
 * flicker between two neighbours.
 */
export function padFor(dx, dy, controlDirection, keep = -1, slack = 24) {
  const want = moveDirOf(dx, dy);
  if (keep >= 0 && codeError(keep, want, controlDirection) <= slack) return keep;
  let best = 0;
  for (let c = 1; c < 8; c++) if (codeError(c, want, controlDirection) < codeError(best, want, controlDirection)) best = c;
  return best;
}

/** Most frames one packed leg holds; longer runs are split. */
export const LEG_MAX = 9999;
/** One leg as a number: code * 10000 + frames. */
export const packLeg = (code, frames) => code * 10000 + frames;
export const unpackLeg = (n) => ({ dir: ROUTE_DIRS[Math.floor(n / 10000)], code: Math.floor(n / 10000), frames: n % 10000 });

/** Run-length legs from per-frame codes: packed numbers, in order. */
export function legsOf(codes) {
  const legs = [];
  let cur = -1;
  let n = 0;
  const flush = () => {
    while (n > 0) {
      const f = Math.min(n, LEG_MAX);
      legs.push(packLeg(cur, f));
      n -= f;
    }
  };
  for (const c of codes) {
    if (c !== cur) {
      flush();
      cur = c;
    }
    n += 1;
  }
  flush();
  return legs;
}

/**
 * Addresses a route watches. They restate confirmed entries of the address
 * table (semantic/addresses.js: playerModel, fieldId, gameState), because a
 * module copied to runner/semantic/ has no imports; a Tier 1 test keeps
 * them equal.
 */
export const ROUTE_WATCH = Object.freeze({ playerModel: 0x800965e0, fieldId: 0x8009a05c, gameState: 0x8009c560, fieldMode: 1 });
/** FieldTriggers.gateways: 12 records of 0x18 bytes at +0x38; the line's x1, y1, x2, y2 at +0, +2, +6, +8; the field it leads to at +0x12 (0x7FFF unused). */
export const GATEWAYS = Object.freeze({ offset: 0x38, size: 0x18, count: 12, x1: 0x0, y1: 0x2, x2: 0x6, y2: 0x8, to: 0x12, unused: 0x7fff });
/** The game ignores a talk to a model whose height differs from the player's by this much (field units). */
const TALK_Z = 256;

/** An s16 at addr, or null. */
export function readS16(readMem, addr) {
  const b = safeRead(readMem, addr, 2);
  return b ? s16(b, 0) : null;
}

/** Field model k: { x, y, z (field units), posI, solidOff, talkOff, solidRange, talkRange }, or null. */
export function readModel(readMem, k) {
  if (!Number.isInteger(k) || k < 0 || k > 15) return null;
  const b = safeRead(readMem, ENTITY.base + k * ENTITY.size, ENTITY.size);
  if (!b) return null;
  const s32 = (o) => u32(b, o) | 0;
  return {
    x: Math.floor(s32(ENTITY.posX) / 4096),
    y: Math.floor(s32(ENTITY.posY) / 4096),
    z: Math.floor(s32(ENTITY.posZ) / 4096),
    posI: u16(b, ENTITY.posI),
    solidOff: b[ENTITY.solidOff],
    talkOff: b[ENTITY.talkOff],
    solidRange: u16(b, ENTITY.solidRange),
    talkRange: u16(b, ENTITY.talkRange),
  };
}

/** The player's model, as readModel, plus its index (model), or null. */
export function readPlayer(readMem) {
  const k = readS16(readMem, ROUTE_WATCH.playerModel);
  const m = k === null ? null : readModel(readMem, k);
  return m && { ...m, model: k };
}

/** FieldTriggers.controlDirection of the current field, or null. */
export function readControlDirection(readMem) {
  const ref = safeRead(readMem, FIELD_TRIGGERS_REF, 4);
  const b = ref && safeRead(readMem, u32(ref, 0) + CONTROL_DIRECTION, 1);
  return b ? b[0] : null;
}

/** Gateway k of the current field: { x1, y1, x2, y2, to }, or null when it can't be read or is unused. */
export function readGateway(readMem, k) {
  if (!Number.isInteger(k) || k < 0 || k >= GATEWAYS.count) return null;
  const ref = safeRead(readMem, FIELD_TRIGGERS_REF, 4);
  const b = ref && safeRead(readMem, u32(ref, 0) + GATEWAYS.offset + k * GATEWAYS.size, GATEWAYS.size);
  if (!b) return null;
  const g = { x1: s16(b, GATEWAYS.x1), y1: s16(b, GATEWAYS.y1), x2: s16(b, GATEWAYS.x2), y2: s16(b, GATEWAYS.y2), to: u16(b, GATEWAYS.to) };
  return g.to === GATEWAYS.unused ? null : g;
}

/**
 * What a route aims for. to: { gateway: k } or { model: k }. Returns
 * { tris: Set of goal triangles, kind, k } or { error }.
 */
export function routeGoal(mesh, readMem, to) {
  if (to.gateway !== undefined) {
    const g = readGateway(readMem, to.gateway);
    if (!g) return { error: 'gateway' };
    return { kind: 'gateway', k: to.gateway, tris: gatewayTriangles(mesh, g) };
  }
  const m = readModel(readMem, to.model);
  if (!m || m.posI >= mesh.count) return { error: 'model' };
  return { kind: 'model', k: to.model, tris: new Set([m.posI]) };
}

/** Where to steer now, in the goal triangle: [x, y] (the nearest point of the gateway line, or the model), or null. */
export function goalPoint(readMem, goal, here) {
  if (goal.kind === 'gateway') {
    const g = readGateway(readMem, goal.k);
    return g && nearestOnSegment(here.x, here.y, g.x1, g.y1, g.x2, g.y2);
  }
  const m = readModel(readMem, goal.k);
  return m && [m.x, m.y];
}

/**
 * Whether the goal is reached: for a gateway, the field ID differs from
 * startField (it changes as the player walks through an exit); for a model,
 * the talk rule's distance part holds (ground distance below its TalkRange
 * plus the player's SolidRange, height within 256; semantic/nearby.js).
 */
export function goalReached(readMem, goal, startField) {
  if (goal.kind === 'gateway') {
    const f = readS16(readMem, ROUTE_WATCH.fieldId);
    return f !== null && f !== startField;
  }
  const p = readPlayer(readMem);
  const m = readModel(readMem, goal.k);
  if (!p || !m) return false;
  const dz = p.z - m.z;
  return dz > -TALK_Z && dz < TALK_Z && Math.floor(Math.hypot(m.x - p.x, m.y - p.y)) < m.talkRange + p.solidRange;
}

/**
 * The point to steer at from `here` (a readModel result) along `path` at
 * index i: the next portal, or the one after when the next is within
 * `near` field units, or goalPoint in the last triangle.
 */
export function steerPoint(mesh, path, i, here, readMem, goal, near = 6) {
  if (i < path.length - 1) {
    const p = portal(mesh, path[i], path[i + 1]);
    if (p && Math.hypot(p[0] - here.x, p[1] - here.y) < near && i < path.length - 2) {
      return portal(mesh, path[i + 1], path[i + 2]) ?? p;
    }
    if (p) return p;
  }
  return goalPoint(readMem, goal, here);
}
