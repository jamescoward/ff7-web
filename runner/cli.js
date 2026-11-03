#!/usr/bin/env node
// Headless runner CLI: load a PS1 program, run N frames, print JSON.
//
//   node runner/cli.js --frames N [options] <program>
//
// Options:
//   --frames N            frames to run (required)
//   --hash-every K        emit a sample every K frames (default 1); the last
//                         frame is always sampled
//   --peek ADDR[:LEN]     RAM bytes to report in each sample (hex, LEN
//                         default 4); repeatable
//   --pad FROM[-TO]=BTNS  hold buttons on frames FROM..TO (1-based,
//                         inclusive; TO defaults to FROM); BTNS is a comma
//                         list such as start,cross; repeatable
//   --option KEY=VALUE    libretro core option; repeatable
//   --verbose             forward core info logs to stderr
//
// stdout carries only deterministic data: the same program, flags and core
// build give byte-identical output.

import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { createBackend } from './backend.js';
import { hex32, ramOffset } from './memmap.js';
import { padMask } from './pad.js';

export function parseCli(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      frames: { type: 'string' },
      'hash-every': { type: 'string', default: '1' },
      peek: { type: 'string', multiple: true, default: [] },
      pad: { type: 'string', multiple: true, default: [] },
      option: { type: 'string', multiple: true, default: [] },
      verbose: { type: 'boolean', default: false },
    },
  });
  if (positionals.length !== 1) throw new Error('expected exactly one program path');
  const frames = intArg('--frames', values.frames, 1);
  const hashEvery = intArg('--hash-every', values['hash-every'], 1);

  const peeks = values.peek.map((p) => {
    const m = /^(0x[0-9a-f]+|\d+)(?::(\d+))?$/i.exec(p);
    if (!m) throw new Error(`bad --peek ${p}; expected ADDR[:LEN]`);
    const peek = { addr: Number(m[1]), len: m[2] === undefined ? 4 : Number(m[2]) };
    ramOffset(peek.addr, peek.len); // throws RangeError for non-RAM ranges
    return peek;
  });

  const pads = values.pad.map((p) => {
    const m = /^(\d+)(?:-(\d+))?=(.*)$/.exec(p);
    if (!m) throw new Error(`bad --pad ${p}; expected FROM[-TO]=BUTTONS`);
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    if (from < 1 || to < from) throw new Error(`bad --pad frame range ${p}`);
    return { from, to, mask: padMask(m[3]) };
  });

  const coreOptions = {};
  for (const o of values.option) {
    const i = o.indexOf('=');
    if (i < 1) throw new Error(`bad --option ${o}; expected KEY=VALUE`);
    coreOptions[o.slice(0, i)] = o.slice(i + 1);
  }
  return { program: positionals[0], frames, hashEvery, peeks, pads, coreOptions, verbose: values.verbose };
}

function intArg(name, v, min) {
  if (v === undefined) throw new Error(`${name} is required`);
  if (!/^\d+$/.test(v) || Number(v) < min) throw new Error(`${name} must be an integer >= ${min}`);
  return Number(v);
}

/** Pad mask to hold during a frame: OR of every --pad range covering it. */
export function padAt(pads, frame) {
  let mask = 0;
  for (const p of pads) if (frame >= p.from && frame <= p.to) mask |= p.mask;
  return mask;
}

export async function run(cfg) {
  const backend = await createBackend({ coreOptions: cfg.coreOptions, verbose: cfg.verbose });
  try {
    backend.loadProgram(cfg.program);

    const samples = [];
    backend.onFrameEnd(({ frame }) => {
      if (frame % cfg.hashEvery !== 0 && frame !== cfg.frames) return;
      const info = backend.frameInfo();
      const mem = {};
      for (const p of cfg.peeks) {
        mem[`0x${hex32(p.addr)}:${p.len}`] = Buffer.from(backend.readMem(p.addr, p.len)).toString('hex');
      }
      samples.push({
        frame,
        width: info.width,
        height: info.height,
        format: info.format,
        hash: backend.frameHash(),
        ...(cfg.peeks.length ? { mem } : {}),
      });
    });

    for (let f = 1; f <= cfg.frames; f++) {
      backend.setPad(padAt(cfg.pads, f));
      backend.stepFrame();
    }

    const build = backend.buildInfo();
    return {
      runner: 'ff7-web/runner',
      format: 1,
      core: build && {
        pcsx_rearmed_commit: build.pcsx_rearmed_commit,
        emsdk_version: build.emsdk_version,
        wasm_sha256: build.wasm_sha256,
      },
      program: { sha256: createHash('sha256').update(readFileSync(cfg.program)).digest('hex') },
      frames: cfg.frames,
      hashEvery: cfg.hashEvery,
      fps: backend.fps(),
      samples,
    };
  } finally {
    backend.close();
  }
}

async function main() {
  let cfg;
  try {
    cfg = parseCli(process.argv.slice(2));
  } catch (e) {
    console.error(`error: ${e.message}\nusage: node runner/cli.js --frames N [--hash-every K] [--peek ADDR[:LEN]] [--pad FROM[-TO]=BTNS] [--option K=V] <program>`);
    process.exit(2);
  }
  try {
    const out = await run(cfg);
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  await main();
}
