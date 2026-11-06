// The parts of a PCSX ReARMed save state (retro_serialize), for diagnostics
// that compare two states part by part (#88). Original project code,
// GPL-2.0-or-later.
//
// The layout is the pinned core's (libpcsxcore/misc.c SaveState, at
// core/pins.env's commit with core/patches/ applied). Sizes of the C
// structs were measured by compiling their definitions with the pinned
// Emscripten (notes/88-snapshot-divergence.md). splitState checks markers
// at known places and throws if any is missing, so a core with another
// layout can't be split silently wrong.
//
// Nothing here reports state contents: callers compare parts of two
// states inside the run and report only whether each part is equal.

import { createHash } from 'node:crypto';

export const STATE_SIZE = 0x440000;

const HEADER = 32 + 4 + 1; // PcsxHeader, SaveVersion, Config.HLE
const SCREENPIC = 128 * 96 * 3; // ex-ScreenPic space (holds build info)
const RAM = 0x200000;
const BIOS = 0x80000;
const HW = 0x10000; // psxH: scratchpad and I/O registers
const SAVE_COUNTER = 0xf000 + 4 * 9; // misc_save_data.save_counter inside psxH: +1 on every save
const CPU = 792; // offsetof(psxRegisters, gteBusyCycle)
const GPU_HDR = 1032; // sizeof(GPUFreeze_t)
const VRAM = 1024 * 512 * 2;
const SIO = 256 + 4 * 2 + 4 * 4 + 2 + 4; // sioFreeze
const CDR = 35288; // sizeof(cdr) in cdrom.c
const CDR_FREEZE_VER = 2360; // offsetof(cdr, freeze_ver)
const CDR_PREV = 2364; // offsetof(cdr, Prev): the MSF of the sector in the host-side read buffer
const CDR_TAIL = 4; // FifoOffset copy
const RCNT = 4 * 28 + 4 * 4; // rcnts[4], hSyncCount, spuSyncCount, psxNextCounter, psxNextsCounter
const MDEC = 4 * 5 + 768 + 12 + 64 * 4 * 2; // reg0, reg1, rl, rl_end, pos, block_buffer, pending_dma1, iq_y, iq_uv
const MDEC_PTRS = [8, 16]; // rl, rl_end: host pointers re-based on save (garbage while NULL), left out

/** Part names, in state order, each a contiguous range except where masked. */
export const PARTS = ['ram', 'bios', 'io', 'cpu', 'gpu', 'spu', 'cdrom', 'timers', 'other'];

/**
 * Split a state into named byte ranges: { name: [[start, end], ...] }.
 * Bytes that differ between two saves of the same moment are left out:
 * save_counter in the misc block in psxH, and the MDEC host pointers (the
 * three bytes of #31, notes/88-snapshot-divergence.md). So are the top bytes
 * of the GPU's GP1 register copies, which a load changes without effect,
 * and the CD-ROM's host sector cache key.
 * Throws on an unexpected layout.
 */
export function splitState(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== STATE_SIZE) throw new RangeError(`a state is ${STATE_SIZE} bytes`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (Buffer.from(bytes.subarray(0, 11)).toString('latin1') !== 'STv4 PCSXra') throw new Error('state: not a PCSX ReARMed state');
  let p = HEADER + SCREENPIC;
  const ram = [p, p + RAM];
  p += RAM;
  const bios = [p, p + BIOS];
  p += BIOS;
  const io = [[p, p + SAVE_COUNTER], [p + SAVE_COUNTER + 4, p + HW]];
  p += HW;
  const cpu = [p, p + CPU];
  p += CPU;
  if (dv.getUint32(p, true) !== 1) throw new Error('state: GPU freeze version is not at the expected place');
  // GP1 register copies ulControl[0..8] (from hdr + 8): the load replays
  // them as GP1 writes, which records the command number in the top byte of
  // registers the program never wrote. Their top bytes are left out.
  const gpu = [];
  let g = p;
  for (let i = 0; i <= 8; i++) {
    const top = p + 8 + 4 * i + 3;
    gpu.push([g, top]);
    g = top + 1;
  }
  gpu.push([g, p + GPU_HDR + VRAM]);
  p += GPU_HDR + VRAM;
  const spuSize = dv.getUint32(p, true);
  if (spuSize <= 528 + 512 * 1024 || spuSize > 1 << 20) throw new Error('state: SPU size is not at the expected place');
  if (Buffer.from(bytes.subarray(p + 4, p + 9)).toString('latin1') !== 'PBOSS') throw new Error('state: SPU plugin name is not at the expected place');
  const spu = [p, p + 4 + spuSize];
  p += 4 + spuSize;
  const sio = [p, p + SIO];
  p += SIO;
  if (dv.getUint32(p + CDR_FREEZE_VER, true) !== 0x63647203) throw new Error('state: CD-ROM freeze version is not at the expected place');
  // cdr.Prev keys the host-side sector buffer (not in the state): a load
  // re-reads that sector, and sets Prev[0] to 0xff if it can't (as before
  // any read, when Prev is 00:00:00). Left out.
  const cdrom = [[p, p + CDR_PREV], [p + CDR_PREV + 4, p + CDR + CDR_TAIL]];
  p += CDR + CDR_TAIL;
  const timers = [p, p + RCNT];
  p += RCNT;
  const mdec = [[p, p + MDEC_PTRS[0]], [p + MDEC_PTRS[1], p + MDEC]];
  p += MDEC;
  const tail = [p, STATE_SIZE]; // pad state, then zero padding
  return {
    ram: [ram],
    bios: [bios],
    io,
    cpu: [cpu],
    gpu,
    spu: [spu],
    cdrom,
    timers: [timers],
    other: [[0, HEADER + SCREENPIC], sio, ...mdec, tail],
  };
}

/** SHA-256 of each part of a state: { name: hex }. Compared inside a run, never reported. */
export function partDigests(bytes) {
  const parts = splitState(bytes);
  return Object.fromEntries(
    PARTS.map((name) => {
      const h = createHash('sha256');
      for (const [a, b] of parts[name]) h.update(bytes.subarray(a, b));
      return [name, h.digest('hex')];
    }),
  );
}
