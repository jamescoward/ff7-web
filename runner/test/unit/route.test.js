// Tier 1 tests for the walkmesh reader and the format 2 route step (#120,
// third budget): semantic/walkmesh.js and runner/route.js. Original project
// code, GPL-2.0-or-later. No game data: the mesh is a synthetic,
// author-made strip of triangles in a fake RAM, and a toy backend moves the
// player one field unit a frame in the direction the pad and the field's
// controlDirection give, honouring walls and locks.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ADDRESS_TABLE } from '../../../semantic/addresses.js';
import {
  ENTITY,
  FIELD_TRIGGERS_REF,
  GATEWAYS,
  ROUTE_BUTTONS,
  ROUTE_DIRS,
  ROUTE_MOVE_DIR,
  ROUTE_WATCH,
  WALKMESH,
  canEnter,
  findPath,
  inTriangle,
  legsOf,
  locate,
  lockedCount,
  moveDirOf,
  packLeg,
  padFor,
  readWalkmesh,
  unpackLeg,
} from '../../../semantic/walkmesh.js';
import { padMask } from '../../pad.js';
import { ROUTE_OUTCOME, emptyRoute, routeMetrics, runRoute } from '../../route.js';
import { loadScenario2, playScript } from '../../format2.js';

const BASE = 0x80000000;
const MESH_AT = 0x80120000;
const HEADER_AT = 0x80110000;
const TRIGGERS_AT = 0x80118000;

/**
 * A corridor of 2 * n triangles along +x, 32 units wide: squares
 * [32i, 32i + 32] x [0, 32], each split into a lower and an upper triangle,
 * wound so the game's inside rule (all edge cross products >= 0) holds.
 * Returns { verts: [[x, y, z] * 3] per triangle, access: [a1, a2, a3] }.
 */
function corridor(n) {
  const tris = [];
  for (let i = 0; i < n; i++) {
    const x0 = 32 * i;
    const x1 = x0 + 32;
    // lower: (x0,0) (x0,32) (x1,0); upper: (x1,32) (x1,0) (x0,32)
    tris.push({ v: [[x0, 0], [x0, 32], [x1, 0]] });
    tris.push({ v: [[x1, 32], [x1, 0], [x0, 32]] });
  }
  // Adjacency by shared edges (edge k: vertex k to k + 1).
  const key = (a, b) => `${a}|${b}`;
  const edges = new Map();
  tris.forEach((t, ti) => {
    for (let k = 0; k < 3; k++) edges.set(key(t.v[k], t.v[(k + 1) % 3]), ti);
  });
  return tris.map((t) => ({
    verts: t.v.map(([x, y]) => [x, y, 0]),
    access: [0, 1, 2].map((k) => edges.get(key(t.v[(k + 1) % 3], t.v[k])) ?? -1),
  }));
}

/** A fake RAM laid out as the field module keeps it (semantic/walkmesh.js). */
function fakeRam(tris, { blocked = [], control = 0, player = [16, 16], models = [], gateway = null } = {}) {
  const ram = new Uint8Array(0x200000);
  const dv = new DataView(ram.buffer);
  const at = (a) => a - BASE;
  const w32 = (a, v) => dv.setUint32(at(a), v >>> 0, true);
  const w16 = (a, v) => dv.setInt16(at(a), v, true);
  w32(WALKMESH.headerRef, HEADER_AT);
  w32(HEADER_AT, MESH_AT);
  dv.setUint16(at(MESH_AT), tris.length, true);
  const triAt = MESH_AT + WALKMESH.dataOffset;
  const accAt = triAt + tris.length * WALKMESH.triangleSize;
  w32(WALKMESH.trianglesVar, triAt);
  w32(WALKMESH.accessesVar, accAt);
  tris.forEach((t, i) => {
    t.verts.forEach((v, j) => v.forEach((c, k) => w16(triAt + i * 24 + j * 8 + k * 2, c)));
    t.access.forEach((a, k) => w16(accAt + i * 6 + k * 2, a));
  });
  for (const b of blocked) ram[at(WALKMESH.blockedAccesses) + (b >> 3)] |= 1 << (b & 7);
  w32(FIELD_TRIGGERS_REF, TRIGGERS_AT);
  ram[at(TRIGGERS_AT + 9)] = control;
  for (let k = 0; k < GATEWAYS.count; k++) dv.setUint16(at(TRIGGERS_AT + GATEWAYS.offset + k * GATEWAYS.size + GATEWAYS.to), GATEWAYS.unused, true);
  if (gateway) {
    const g = TRIGGERS_AT + GATEWAYS.offset;
    w16(g + GATEWAYS.x1, gateway.x1);
    w16(g + GATEWAYS.y1, gateway.y1);
    w16(g + GATEWAYS.x2, gateway.x2);
    w16(g + GATEWAYS.y2, gateway.y2);
    dv.setUint16(at(g + GATEWAYS.to), gateway.to, true);
  }
  w16(ROUTE_WATCH.playerModel, 0);
  w16(ROUTE_WATCH.fieldId, 0x75);
  w16(ROUTE_WATCH.gameState, ROUTE_WATCH.fieldMode);
  const setModel = (k, m) => {
    const e = ENTITY.base + k * ENTITY.size;
    dv.setInt32(at(e + ENTITY.posX), m.x * 4096, true);
    dv.setInt32(at(e + ENTITY.posY), m.y * 4096, true);
    dv.setUint16(at(e + ENTITY.solidRange), m.solid ?? 10, true);
    dv.setUint16(at(e + ENTITY.talkRange), m.talk ?? 20, true);
  };
  setModel(0, { x: player[0], y: player[1] });
  models.forEach((m, i) => setModel(i + 1, m));
  return { ram, dv, at };
}

/**
 * A toy backend over fakeRam: each frame moves the player one field unit
 * along the MoveDir the pad and controlDirection give (64 is +x, 128 is +y),
 * unless that would leave the mesh or enter a locked triangle; crossing the
 * gateway line's x changes the field ID.
 */
function toyBackend(tris, opts = {}) {
  const f = fakeRam(tris, opts);
  const mesh = readWalkmesh((a, l) => f.ram.slice(a - BASE, a - BASE + l));
  const e0 = ENTITY.base;
  const pos = () => [f.dv.getInt32(f.at(e0 + ENTITY.posX), true) / 4096, f.dv.getInt32(f.at(e0 + ENTITY.posY), true) / 4096];
  const setI = () => {
    const [x, y] = pos();
    f.dv.setUint16(f.at(e0 + ENTITY.posI), locate(mesh, x, y), true);
  };
  setI();
  for (let k = 1; k <= (opts.models ?? []).length; k++) {
    const e = ENTITY.base + k * ENTITY.size;
    f.dv.setUint16(f.at(e + ENTITY.posI), locate(mesh, f.dv.getInt32(f.at(e + ENTITY.posX), true) / 4096, f.dv.getInt32(f.at(e + ENTITY.posY), true) / 4096), true);
  }
  let pad = 0;
  return {
    frames: 0,
    readMem: (a, l) => f.ram.slice(a - BASE, a - BASE + l),
    setPad(mask, port) {
      if (port === 0) pad = mask;
    },
    stepFrame() {
      this.frames += 1;
      const code = ROUTE_BUTTONS.findIndex((b) => padMask([...b]) === pad);
      if (code < 0) return;
      const d = ((ROUTE_MOVE_DIR[code] + (opts.control ?? 0)) & 0xff) * (Math.PI / 128);
      const [x, y] = pos();
      const nx = Math.round(x + Math.sin(d) * 1);
      const ny = Math.round(y - Math.cos(d) * 1);
      const t = locate(mesh, nx, ny);
      if (t < 0 || !canEnter(mesh, t, true)) return;
      f.dv.setInt32(f.at(e0 + ENTITY.posX), nx * 4096, true);
      f.dv.setInt32(f.at(e0 + ENTITY.posY), ny * 4096, true);
      f.dv.setUint16(f.at(e0 + ENTITY.posI), t, true);
      if (opts.gateway && nx >= opts.gateway.x1) f.dv.setInt16(f.at(ROUTE_WATCH.fieldId), opts.gateway.to, true);
    },
  };
}

const frameOn = (b) => (mask) => {
  b.setPad(mask, 0);
  b.stepFrame();
};

describe('semantic/walkmesh.js', () => {
  it('restates the confirmed address-table entries it watches', () => {
    const at = (n) => ADDRESS_TABLE.entries.find((e) => e.name === n);
    assert.equal(at('playerModel').address, ROUTE_WATCH.playerModel);
    assert.equal(at('fieldId').address, ROUTE_WATCH.fieldId);
    assert.equal(at('gameState').address, ROUTE_WATCH.gameState);
    assert.equal(at('fieldTriggers').address, FIELD_TRIGGERS_REF);
    assert.equal(at('fieldX').address, ENTITY.base + ENTITY.posX);
    assert.equal(at('fieldTalkRange').address, ENTITY.base + ENTITY.talkRange);
    assert.equal(at('fieldSolidRange').address, ENTITY.base + ENTITY.solidRange);
  });

  it('reads a mesh, and refuses one whose pointers disagree', () => {
    const tris = corridor(3);
    const f = fakeRam(tris);
    const read = (a, l) => {
      if (a < BASE || a + l > BASE + f.ram.length) throw new RangeError('not main RAM');
      return f.ram.slice(a - BASE, a - BASE + l);
    };
    const m = readWalkmesh(read);
    assert.equal(m.count, 6);
    assert.deepEqual([...m.access.slice(0, 3)], tris[0].access);
    for (let t = 0; t < 6; t++) {
      const [cx, cy] = [(m.verts[t * 9] + m.verts[t * 9 + 3] + m.verts[t * 9 + 6]) / 3, (m.verts[t * 9 + 1] + m.verts[t * 9 + 4] + m.verts[t * 9 + 7]) / 3];
      assert.ok(inTriangle(m, t, cx, cy), `centroid inside ${t}`);
    }
    f.dv.setUint32(f.at(WALKMESH.trianglesVar), 0x80100000, true);
    assert.deepEqual(readWalkmesh(read), { error: 'pointers' });
    f.dv.setUint32(f.at(WALKMESH.headerRef), 0x12345678, true);
    assert.deepEqual(readWalkmesh(read), { error: 'header' });
  });

  it('finds a path along the mesh, and none through a lock', () => {
    const tris = corridor(4);
    const open = readWalkmesh((a, l) => fakeRam(tris).ram.slice(a - BASE, a - BASE + l));
    // The corridor is one chain of triangles: 0, 1, ..., 7.
    assert.deepEqual(findPath(open, 0, new Set([7]), true), [0, 1, 2, 3, 4, 5, 6, 7]);
    const f = fakeRam(tris, { blocked: [4] });
    const m = readWalkmesh((a, l) => f.ram.slice(a - BASE, a - BASE + l));
    assert.equal(lockedCount(m), 1);
    assert.equal(findPath(m, 0, new Set([7]), true), null);
    assert.deepEqual(findPath(m, 0, new Set([7]), false), [0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('picks the pad direction nearest a wanted move, with controlDirection', () => {
    assert.equal(moveDirOf(1, 0), 64);
    assert.equal(moveDirOf(0, 1), 128);
    assert.equal(moveDirOf(0, -1), 0);
    // controlDirection 0: up is MoveDir 0 (-y), right is 192 (-x): the field's own axes.
    assert.equal(ROUTE_DIRS[padFor(0, -5, 0)], 'up');
    assert.equal(ROUTE_DIRS[padFor(5, 0, 0)], 'left');
    // controlDirection 128 (md1stin-like: up raises y, right raises x).
    assert.equal(ROUTE_DIRS[padFor(0, 5, 128)], 'up');
    assert.equal(ROUTE_DIRS[padFor(5, 0, 128)], 'right');
    assert.equal(ROUTE_DIRS[padFor(5, 5, 128)], 'up-right');
    // keep: hold the current code while it is within the slack.
    assert.equal(padFor(10, 4, 128, 2), 2);
    assert.equal(padFor(10, -4, 128, 2), 2);
    assert.equal(padFor(-10, 0, 128, 2), 6);
  });

  it('packs legs by run length', () => {
    assert.deepEqual(legsOf([2, 2, 2, 1, 1, 2]), [packLeg(2, 3), packLeg(1, 2), packLeg(2, 1)]);
    assert.deepEqual(unpackLeg(packLeg(7, 120)), { dir: 'up-left', code: 7, frames: 120 });
    assert.deepEqual(legsOf(new Array(10001).fill(0)), [packLeg(0, 9999), packLeg(0, 2)]);
  });
});

describe('runner/route.js', () => {
  it('walks to a gateway along a corridor', () => {
    const b = toyBackend(corridor(5), { control: 128, gateway: { x1: 150, y1: 0, x2: 150, y2: 32, to: 0x76 } });
    const r = runRoute(b, { to: { gateway: 0 }, timeout: 1000 }, frameOn(b));
    assert.equal(r.outcome, ROUTE_OUTCOME.reached);
    assert.ok(r.frames > 100 && r.frames < 200, `frames ${r.frames}`);
    assert.ok(r.path > 0 && r.free === r.path);
    // controlDirection 128: +x is MoveDir 64, pad right (192) + 128.
    assert.equal(unpackLeg(r.legs[0]).dir, 'right');
  });

  it('walks into talk range of a model', () => {
    const b = toyBackend(corridor(5), { control: 0, models: [{ x: 120, y: 20, talk: 20, solid: 10 }] });
    const r = runRoute(b, { to: { model: 1 }, timeout: 1000 }, frameOn(b));
    assert.equal(r.outcome, ROUTE_OUTCOME.reached);
    assert.ok(r.frames > 60 && r.frames < 140, `frames ${r.frames}`);
  });

  it('reports no path through a lock, and the free path beside it', () => {
    const b = toyBackend(corridor(5), { blocked: [4, 5], gateway: { x1: 150, y1: 0, x2: 150, y2: 32, to: 0x76 } });
    const r = runRoute(b, { to: { gateway: 0 }, timeout: 1000 }, frameOn(b));
    assert.equal(r.path, 0);
    assert.ok(r.free > 0);
    assert.equal(r.locked, 2);
    assert.equal(r.outcome, ROUTE_OUTCOME.stuck);
  });

  it('stops on a timeout, and reports no mesh outside a field', () => {
    const b = toyBackend(corridor(5), { gateway: { x1: 150, y1: 0, x2: 150, y2: 32, to: 0x76 } });
    const r = runRoute(b, { to: { gateway: 0 }, timeout: 20 }, frameOn(b));
    assert.equal(r.outcome, ROUTE_OUTCOME.timeout);
    assert.equal(r.frames, 20);
    const empty = { readMem: () => new Uint8Array(4), setPad() {}, stepFrame() {} };
    assert.equal(runRoute(empty, { to: { gateway: 0 }, timeout: 20 }, () => {}).outcome, ROUTE_OUTCOME.noMesh);
  });

  it('names metrics for the reports and the legs from legFrom', () => {
    const step = { report: { outcome: 'out', legs: 'n' }, leg: ['l0', 'l1'], legFrom: 1 };
    const m = routeMetrics(step, { ...emptyRoute(), outcome: 1, legs: [10, 20] });
    assert.deepEqual([...m], [['out', 1], ['n', 2], ['l0', 20], ['l1', 0]]);
    assert.deepEqual([...routeMetrics(step, null)], [['out', 0], ['n', 0], ['l0', 0], ['l1', 0]]);
  });
});

describe('format 2 route step', () => {
  const doc = (route, metrics) => ({
    format: 2,
    name: 'route-load',
    boot: { fixture: 'pad-echo', from: 'pad-echo-ready' },
    input: [{ route }],
    assert: [],
    metrics,
  });

  it('loads, names its metrics, and plays through playScript', () => {
    const sc = loadScenario2(doc({ to: { gateway: 0 }, timeout: 1000, report: { outcome: 'out' }, leg: ['l0'] }, ['out', 'l0']), {});
    assert.equal(sc.steps[0].kind, 'route');
    const b = toyBackend(corridor(5), { control: 128, gateway: { x1: 150, y1: 0, x2: 150, y2: 32, to: 0x76 } });
    const run = playScript(b, sc.steps, {});
    assert.equal(run.routes.get(sc.steps[0]).outcome, ROUTE_OUTCOME.reached);
    assert.equal(run.frames, b.frames);
  });

  it('refuses a metric it names that is not listed', () => {
    assert.throws(() => loadScenario2(doc({ to: { model: 1 }, timeout: 10, report: { outcome: 'out' } }, []), {}), /route\.report\.outcome.*not listed/);
  });
});
