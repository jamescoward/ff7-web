// Unit (#289): the naming screen fact, the "Use default name" sequence, and
// the generated Tier 2 scenario. Synthetic memory only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

import { ADDRESS_TABLE, EXE_USA_SHA1, makeTable } from '../../../semantic/addresses.js';
import { FIELD_ACTIONS, NAMING_ACTIONS, namingPressAt } from '../../../semantic/controls.js';
import { createSemantic } from '../../../semantic/layer.js';
import { ROUTE_WATCH, namingScreen } from '../../../semantic/walkmesh.js';
import { NAME_EVERY, NAME_HOLD } from '../../route.js';
import { NAME, NAME_ENTRY, namingScenario } from './naming-scenarios.js';
import { SCENARIO_DIR, serialise } from './planner-scenarios.js';

const byName = Object.fromEntries(ADDRESS_TABLE.entries.map((e) => [e.name, e]));
const GAME_STATE = byName.gameState.address & 0x1fffff;
const EVENT_CMD = byName.fieldEventCmd.address & 0x1fffff;

function setup({ gameState, eventCmd, table = ADDRESS_TABLE, failAt = null }) {
  const bytes = new Uint8Array(0x200000);
  new DataView(bytes.buffer).setInt16(GAME_STATE, gameState, true);
  bytes[EVENT_CMD] = eventCmd;
  const reads = [];
  const backend = {
    readMem: (a, l) => {
      reads.push(a);
      if (failAt === a) throw new Error('boom');
      return bytes.subarray(a & 0x1fffff, (a & 0x1fffff) + l);
    },
  };
  return { s: createSemantic({ backend, exeSha1: EXE_USA_SHA1, table }), reads, bytes };
}

/** The shipped table with fieldEventCmd back to a hypothesis. */
const UNCONFIRMED = makeTable(EXE_USA_SHA1, ADDRESS_TABLE.entries.map((e) => {
  const { exe, scenario, ...rest } = e;
  return e.name === 'fieldEventCmd' ? { ...rest, status: 'hypothesis' } : { ...rest, ...(scenario ? { scenario } : {}) };
}));

describe('naming() (#289)', () => {
  test('naming only for gameState menu (5) with fieldEventCmd 6, confirmed', async () => {
    for (const [gameState, eventCmd, want] of [[5, 6, true], [5, 9, false], [5, 0, false], [1, 6, false], [2, 6, false], [3, 6, false]]) {
      const { s } = setup({ gameState, eventCmd });
      assert.deepEqual(await s.naming(), { value: want, confirmed: true }, `${gameState}/${eventCmd}`);
    }
  });

  test('out of the menu it does not read fieldEventCmd', async () => {
    const { s, reads } = setup({ gameState: 1, eventCmd: 6 });
    await s.naming();
    assert.ok(!reads.includes(byName.fieldEventCmd.address));
  });

  test('with fieldEventCmd a hypothesis, the menu answer is unconfirmed; out of the menu it stays confirmed', async () => {
    assert.deepEqual(await setup({ gameState: 5, eventCmd: 6, table: UNCONFIRMED }).s.naming(), { value: true, confirmed: false });
    assert.deepEqual(await setup({ gameState: 1, eventCmd: 6, table: UNCONFIRMED }).s.naming(), { value: false, confirmed: true });
  });

  test('a failed read or an inactive gate gives no answer', async () => {
    const r = await setup({ gameState: 5, eventCmd: 6, failAt: byName.fieldEventCmd.address }).s.naming();
    assert.deepEqual(r, { value: null, confirmed: false, reason: 'read failed' });
    const off = createSemantic({ backend: { readMem() { throw new Error('must not read'); } }, exeSha1: null });
    assert.equal((await off.naming()).reason, 'inactive');
  });

  test('the route watch agrees with the table and the layer', () => {
    assert.equal(ROUTE_WATCH.eventCmd, byName.fieldEventCmd.address);
    assert.equal(ROUTE_WATCH.nameEntry, NAME_ENTRY);
    assert.equal(byName.fieldEventCmd.type, 'u8');
    assert.equal(byName.fieldEventCmd.status, 'confirmed');
    assert.equal(byName.fieldEventCmd.scenario, `harness/scenarios/${NAME}.json`);
    for (const [gameState, eventCmd] of [[5, 6], [5, 9], [1, 6]]) {
      const { bytes } = setup({ gameState, eventCmd });
      const readMem = (a, l) => bytes.subarray(a & 0x1fffff, (a & 0x1fffff) + l);
      assert.equal(namingScreen(readMem), gameState === 5 && eventCmd === 6);
    }
  });
});

describe('NAMING_ACTIONS.useDefault (#289)', () => {
  const use = NAMING_ACTIONS.useDefault;

  test('Start, then Circle, as the route measured; plain frozen data', () => {
    assert.deepEqual(use.sequence, [['start'], ['circle']]);
    assert.ok(Object.isFrozen(use) && Object.isFrozen(use.sequence) && use.sequence.every(Object.isFrozen));
    assert.equal(use.label, 'Use default name');
    assert.ok(use.timeout > 179 && use.timeout <= 3600);
    // Circle is a button the touch layer already offers; Start is the pad's (the classic gamepad has it).
    assert.ok(FIELD_ACTIONS.some((a) => a.button === 'circle'));
  });

  test('the route step holds the same schedule', () => {
    assert.equal(NAME_HOLD, use.hold);
    assert.equal(NAME_EVERY, use.every);
  });

  test('namingPressAt: group k held for [k*every, k*every+hold), cycling, null between', () => {
    assert.deepEqual(namingPressAt(0), ['start']);
    assert.deepEqual(namingPressAt(use.hold - 1), ['start']);
    assert.equal(namingPressAt(use.hold), null);
    assert.equal(namingPressAt(use.every - 1), null);
    assert.deepEqual(namingPressAt(use.every), ['circle']);
    assert.deepEqual(namingPressAt(2 * use.every), ['start']);
    assert.deepEqual(namingPressAt(3 * use.every + 1), ['circle']);
    let presses = 0;
    for (let f = 0; f < 179; f++) if (namingPressAt(f) && f % use.every === 0) presses++;
    assert.equal(presses, 6);
    assert.throws(() => namingPressAt(-1), RangeError);
    assert.throws(() => namingPressAt(1.5), RangeError);
  });
});

describe('the Tier 2 scenario (#289)', () => {
  test('the committed file equals the generator (node runner/test/unit/naming-scenarios.js)', () => {
    const file = path.join(SCENARIO_DIR, `${NAME}.json`);
    assert.equal(readFileSync(file, 'utf8'), serialise(namingScenario()));
  });

  test('boots from touch-md1-1 after touch-playthrough, uses the semantic sequence, <= 8 metrics, every report a metric', () => {
    const s = namingScenario();
    assert.deepEqual(s.boot, { from: 'touch-md1-1' });
    assert.ok(`${NAME}.json` > 'touch-playthrough.json');
    const route = s.input.find((x) => x.route).route;
    assert.deepEqual(route.naming, NAMING_ACTIONS.useDefault.sequence.map((g) => [...g]));
    assert.ok(route.scene > 0);
    assert.ok(s.metrics.length <= 8);
    const named = new Set([...Object.values(route.report), ...s.assert.map((a) => a.metric).filter(Boolean)]);
    assert.deepEqual([...named].sort(), [...s.metrics].sort());
    for (const a of s.assert) assert.ok(s.memory[a.expect.mem], a.expect.mem);
  });
});
