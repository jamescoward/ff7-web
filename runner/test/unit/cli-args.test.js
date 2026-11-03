import assert from 'node:assert/strict';
import { test } from 'node:test';

import { padAt, parseCli } from '../../cli.js';
import { PAD } from '../../pad.js';

test('parseCli reads frames, sampling, peeks, pads and options', () => {
  const cfg = parseCli([
    '--frames', '10', '--hash-every', '5',
    '--peek', '0x800f0000', '--peek', '0x80010000:16',
    '--pad', '2-4=start,cross', '--pad', '7=up',
    '--option', 'pcsx_rearmed_region=NTSC',
    'prog.exe',
  ]);
  assert.equal(cfg.program, 'prog.exe');
  assert.equal(cfg.frames, 10);
  assert.equal(cfg.hashEvery, 5);
  assert.deepEqual(cfg.peeks, [{ addr: 0x800f0000, len: 4 }, { addr: 0x80010000, len: 16 }]);
  assert.deepEqual(cfg.pads, [
    { from: 2, to: 4, mask: PAD.start | PAD.cross },
    { from: 7, to: 7, mask: PAD.up },
  ]);
  assert.deepEqual(cfg.coreOptions, { pcsx_rearmed_region: 'NTSC' });
});

test('padAt ORs every range covering a frame', () => {
  const pads = [{ from: 2, to: 4, mask: 1 }, { from: 4, to: 5, mask: 8 }];
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((f) => padAt(pads, f)), [0, 1, 1, 9, 8, 0]);
});

test('parseCli rejects bad input', () => {
  const bad = [
    ['prog.exe'], // no --frames
    ['--frames', '0', 'prog.exe'],
    ['--frames', 'x', 'prog.exe'],
    ['--frames', '1'], // no program
    ['--frames', '1', 'a', 'b'],
    ['--frames', '1', '--peek', '0x1f800000', 'p'], // not RAM
    ['--frames', '1', '--peek', '0x801ffffe:4', 'p'], // past end
    ['--frames', '1', '--pad', '3-2=start', 'p'],
    ['--frames', '1', '--pad', '1=jump', 'p'],
    ['--frames', '1', '--option', 'novalue', 'p'],
  ];
  for (const args of bad) assert.throws(() => parseCli(args), undefined, args.join(' '));
});
