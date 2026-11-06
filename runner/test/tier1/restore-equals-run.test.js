// Tier 1: a restored save state runs on exactly as the core that saved it
// (#88), on the real core with homebrew only.
//
// timer-probe (runner/synth/timer-probe.js) stores the three root counters,
// a busy-wait count and four SPU voices' envelopes in RAM every frame, so
// RAM depends on the exact cycle. Before core/patches/0002-savestate-round-trip.patch, a restore lost
// part of a tick (counters 0 and 2) and the interpreter's fractional cycle
// (counter 1), and RAM differed from a run that never restored within 10
// frames; chained restores lost more. Each check compares a restored run
// with one core that ran from power-on with no save at all: main RAM, and
// every part of the state at the end (runner/stateparts.js).
// Needs core/build.sh and runner/build.sh.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { build as buildPadEcho } from '../../../harness/fixtures/pad-echo.js';
import { createBackend } from '../../backend.js';
import { runScenario2, runSequence } from '../../format2.js';
import { loadScenario, ScenarioError } from '../../scenario.js';
import { PARTS, partDigests, splitState, STATE_SIZE } from '../../stateparts.js';
import { buildIso } from '../../synth/iso9660.js';
import { buildExe, RC0_ADDR, RC1_ADDR, RC2_ADDR, VOL_ADDR } from '../../synth/timer-probe.js';

let dir;
let probe;
let disc;
before(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ff7-restore-'));
  probe = path.join(dir, 'timer-probe.exe');
  writeFileSync(probe, buildExe());
  // The probe as the boot executable of a synthetic disc, so the HLE BIOS
  // boots it through the CD-ROM drive.
  disc = path.join(dir, 'disc.bin');
  writeFileSync(disc, buildIso({
    files: {
      'SYSTEM.CNF': 'BOOT = cdrom:\\PROBE.EXE;1\r\nTCB = 4\r\nEVENT = 10\r\nSTACK = 801FFF00\r\n',
      'PROBE.EXE': buildExe(),
    },
  }));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const open = async (program) => {
  const b = await createBackend();
  b.loadProgram(program);
  return b;
};
const ram = (b) => Buffer.from(b.readMem(0x80000000, 0x200000));
const counters = (b) => [b.readU16(RC0_ADDR), b.readU16(RC1_ADDR), b.readU16(RC2_ADDR)];

/** Which state parts differ between two backends now (saves both). */
function differingParts(a, b) {
  const da = partDigests(a.saveState());
  const db = partDigests(b.saveState());
  return PARTS.filter((p) => da[p] !== db[p]);
}

/** Power on and run `frames` with no save; the reference. */
async function scratch(program, frames) {
  const b = await open(program);
  b.runFrames(frames);
  return b;
}

/**
 * A chain: power on, run segs[0] frames, save; then for each later segment
 * a new core restores the last save and runs it (saving again unless last).
 */
async function chain(program, segs) {
  const first = await open(program);
  first.runFrames(segs[0]);
  let bytes = first.saveState();
  first.close();
  let b = null;
  for (let i = 1; i < segs.length; i++) {
    b?.close();
    b = await open(program);
    b.loadState(bytes);
    b.runFrames(segs[i]);
    if (i < segs.length - 1) bytes = b.saveState();
  }
  return b;
}

for (const [label, prog] of [['exe', () => probe], ['disc', () => disc]]) {
  for (const segs of [[30, 10], [31, 1], [33, 10], [37, 60], [30, 7, 1], [30, 60, 1], [30, 1, 1, 1, 1, 1]]) {
    test(`timer-probe (${label}): restored at ${segs.slice(0, -1).join('+')} then ${segs.at(-1)} frames equals running on`, async () => {
      const total = segs.reduce((x, y) => x + y, 0);
      const ref = await scratch(prog(), total);
      const got = await chain(prog(), segs);
      try {
        assert.deepEqual(counters(got), counters(ref), 'root counters as the program read them');
        assert.ok(ram(got).equals(ram(ref)), 'main RAM');
        assert.deepEqual(differingParts(got, ref), [], 'state parts that differ');
      } finally {
        got.close();
        ref.close();
      }
    });
  }
}

test('timer-probe: a core that saved and ran on equals one that never saved', async () => {
  const ref = await scratch(probe, 70);
  const b = await open(probe);
  try {
    for (let i = 0; i < 7; i++) {
      b.runFrames(10);
      b.saveState();
    }
    assert.ok(ram(b).equals(ram(ref)), 'main RAM');
    assert.deepEqual(differingParts(b, ref), [], 'state parts that differ');
  } finally {
    b.close();
    ref.close();
  }
});

test('timer-probe: the counters really run (the check is not vacuous)', async () => {
  const b = await scratch(probe, 20);
  try {
    const one = counters(b);
    b.runFrames(1);
    const two = counters(b);
    assert.ok(one.every((v, i) => v !== two[i]), `each counter moved in a frame: ${one} -> ${two}`);
    assert.ok(b.readU16(VOL_ADDR) > 0, 'voice 0 is sounding');
  } finally {
    b.close();
  }
});

test('pad-echo: restored mid-run equals running on, part by part', async () => {
  const exe = path.join(dir, 'pad-echo.exe');
  writeFileSync(exe, Buffer.from(buildPadEcho()));
  const ref = await scratch(exe, 50);
  const got = await chain(exe, [30, 10, 10]);
  try {
    assert.ok(ram(got).equals(ram(ref)), 'main RAM');
    assert.deepEqual(differingParts(got, ref), [], 'state parts that differ');
  } finally {
    got.close();
    ref.close();
  }
});

test('stateparts: splits a real state, covers it without overlap, and refuses others', async () => {
  const b = await scratch(probe, 5);
  try {
    const s = b.saveState();
    const parts = splitState(s);
    const ranges = PARTS.flatMap((p) => parts[p]).sort((x, y) => x[0] - y[0]);
    let covered = 0;
    let end = 0;
    for (const [a, z] of ranges) {
      assert.ok(a >= end && z > a, `ranges are ordered and disjoint at ${a}`);
      covered += z - a;
      end = z;
    }
    assert.equal(end, STATE_SIZE);
    // left out: save_counter (4 bytes), the two MDEC pointers (8 bytes) and
    // the top bytes of the nine GP1 register copies, and cdr.Prev (4 bytes)
    assert.equal(STATE_SIZE - covered, 25);
    // two saves of the same moment have equal parts
    assert.deepEqual(partDigests(s), partDigests(b.saveState()));
    assert.throws(() => splitState(new Uint8Array(10)), RangeError);
    const bad = Uint8Array.from(s);
    bad[0] ^= 1;
    assert.throws(() => splitState(bad), /not a PCSX ReARMed state/);
  } finally {
    b.close();
  }
});

// Scenario-level part checks (same_PART metrics, runner/format2.js): a
// pad-echo chain A -> B where B's "boot" replay equals the restored run in
// every part; and a broken chain, where main RAM differs.
const peMemory = { counter: { addr: '0x800f0000', type: 'u32', description: 'VBLANKs seen by pad-echo' } };
const peA = {
  format: 2,
  name: 'parts-a',
  tier: 1,
  boot: { fixture: 'pad-echo', from: 'pad-echo-ready' },
  memory: peMemory,
  input: [{ wait: { frames: 7 } }, { buttons: ['circle'], frames: 3 }],
  assert: [{ sameState: 'rerun' }],
  snapshot: 'parts-pe',
};
const peB = {
  format: 2,
  name: 'parts-b',
  tier: 1,
  boot: { from: 'parts-pe' },
  memory: peMemory,
  input: [{ buttons: ['up'], frames: 2 }, { wait: { frames: 1 } }],
  assert: [{ sameState: 'boot', metric: 'match_boot' }],
  metrics: ['match_boot', 'same_ram', 'same_cpu', 'same_io', 'same_gpu', 'same_spu', 'same_cdrom', 'same_timers'],
};

test('same_PART metrics: 1 for every part when the chain equals scratch', async () => {
  const [a, b] = await runSequence([loadScenario(peA), loadScenario(peB)]);
  assert.equal(a.status, 'pass', JSON.stringify(a));
  assert.equal(b.status, 'pass', JSON.stringify(b));
  assert.deepEqual(b.metrics, { match_boot: 1, same_ram: 1, same_cpu: 1, same_io: 1, same_gpu: 1, same_spu: 1, same_cdrom: 1, same_timers: 1 });
});

test('same_PART metrics: 0 for the parts that differ when the chain does not lead to the snapshot', async () => {
  let kept;
  await runScenario2(loadScenario(peA), { onSnapshot: (s) => { kept = s; } });
  // One frame longer: the replay ends a frame later than the snapshot run.
  const other = loadScenario({ ...peA, input: [{ wait: { frames: 8 } }, { buttons: ['circle'], frames: 3 }] });
  const r = await runScenario2(loadScenario(peB), { snapshot: { ...kept, chain: [other] } });
  assert.equal(r.status, 'fail');
  assert.equal(r.metrics.match_boot, 0);
  assert.equal(r.metrics.same_ram, 0, 'pad-echo counted one more frame');
  assert.equal(r.metrics.same_cpu, 0, 'one frame later, the cycle count differs');
});

test('same_PART metrics need a "boot" check', () => {
  const doc = { ...peB, assert: [{ sameState: 'rerun', metric: 'match_boot' }] };
  assert.throws(() => loadScenario(doc), (e) => e instanceof ScenarioError && /add a \{ "sameState": "boot" \} check/.test(e.message));
});
