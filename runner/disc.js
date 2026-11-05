// Read files from a PS1 disc image: a cue sheet's first data track, or a
// bare .bin/.iso. Original project code, GPL-2.0-or-later.
//
// Used by the scenario runner (#36) for disc checks that run inside the
// Tier 2 sandbox: the boot executable named by SYSTEM.CNF and other files
// are read and compared there, and only pass/fail leaves. Nothing here
// knows about any particular game.
//
// Supported: ISO9660 on MODE1/2048, MODE1/2352 or MODE2/2352 (XA form 1,
// the PS1 data track). Only the first track of the first FILE in a cue is
// read, which is where a PS1 disc's file system lives.

import { closeSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import path from 'node:path';

export class DiscError extends Error {}

const SECTOR = 2048;
const RAW = 2352;
/** Largest file read() returns; PS1 executables and overlays are far smaller. */
export const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_CUE_BYTES = 64 * 1024;
const MAX_DIR_BYTES = 1024 * 1024;

const MODES = {
  'MODE1/2048': { size: SECTOR, offset: 0 },
  'MODE1/2352': { size: RAW, offset: 16 },
  'MODE2/2352': { size: RAW, offset: 24 },
};

/**
 * Parse a cue sheet's text. Returns { file, mode } for the first FILE and
 * its first TRACK. The file name is returned as written; callers resolve it
 * against the cue's directory.
 */
export function parseCue(text) {
  let file = null;
  let mode = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    let m;
    if (!file && (m = /^FILE\s+(?:"([^"]+)"|(\S+))\s+\S+$/i.exec(line))) {
      file = m[1] ?? m[2];
    } else if (file && !mode && (m = /^TRACK\s+\d+\s+(\S+)$/i.exec(line))) {
      mode = m[1].toUpperCase();
    }
  }
  if (!file) throw new DiscError('cue sheet has no FILE line');
  if (!mode) throw new DiscError('cue sheet has no TRACK line');
  if (!MODES[mode]) throw new DiscError(`unsupported first track mode ${mode}`);
  return { file, mode };
}

/** Guess the sector layout of a bare image from its size and first sector. */
function sniffMode(fd, size) {
  if (size % RAW === 0) {
    const head = Buffer.alloc(16);
    readSync(fd, head, 0, 16, 0);
    const sync = head[0] === 0 && head[11] === 0 && head.subarray(1, 11).every((b) => b === 0xff);
    if (sync) return head[15] === 1 ? 'MODE1/2352' : 'MODE2/2352';
    // Raw images may start with an empty sector 0 without a sync pattern;
    // the volume descriptor at sector 16 settles it.
    const pvd = Buffer.alloc(16);
    readSync(fd, pvd, 0, 16, 16 * RAW);
    if (pvd[0] === 0 && pvd[11] === 0) return pvd[15] === 1 ? 'MODE1/2352' : 'MODE2/2352';
  }
  if (size % SECTOR === 0) return 'MODE1/2048';
  throw new DiscError('image size is not a whole number of 2048 or 2352 byte sectors');
}

/** Name compare key: upper case, version (";1") and a trailing dot removed. */
const key = (name) => name.toUpperCase().replace(/;\d+$/, '').replace(/\.$/, '');

/**
 * Open a disc image. `file` is a .cue (its first FILE is opened) or an
 * image. Returns { read(path), bootPath(), close(), image, mode }.
 */
export function openDisc(file) {
  let image = file;
  let mode = null;
  if (path.extname(file).toLowerCase() === '.cue') {
    const text = readFileSync(file);
    if (text.length > MAX_CUE_BYTES) throw new DiscError('cue sheet is too large');
    const cue = parseCue(text.toString('latin1'));
    // Only a file next to the cue: a cue can't point elsewhere.
    image = path.join(path.dirname(file), path.basename(cue.file.replace(/\\/g, '/')));
    mode = cue.mode;
  }
  let fd;
  try {
    fd = openSync(image, 'r');
  } catch (e) {
    throw new DiscError(`cannot open the disc image (${e.code ?? 'error'})`);
  }
  const size = fstatSync(fd).size;
  try {
    mode ??= sniffMode(fd, size);
  } catch (e) {
    closeSync(fd);
    throw e;
  }
  const { size: sectorSize, offset } = MODES[mode];
  const sectors = Math.floor(size / sectorSize);

  function sector(lba) {
    if (!Number.isInteger(lba) || lba < 0 || lba >= sectors) throw new DiscError(`sector ${lba} is outside the image`);
    const buf = Buffer.alloc(SECTOR);
    const n = readSync(fd, buf, 0, SECTOR, lba * sectorSize + offset);
    if (n !== SECTOR) throw new DiscError(`short read at sector ${lba}`);
    return buf;
  }

  function extent(lba, len) {
    const out = Buffer.alloc(len);
    for (let i = 0, pos = 0; pos < len; i++, pos += SECTOR) {
      sector(lba + i).copy(out, pos, 0, Math.min(SECTOR, len - pos));
    }
    return out;
  }

  const pvd = sector(16);
  if (pvd[0] !== 1 || pvd.toString('latin1', 1, 6) !== 'CD001') throw new DiscError('no ISO9660 primary volume descriptor');
  const root = { lba: pvd.readUInt32LE(156 + 2), size: pvd.readUInt32LE(156 + 10), dir: true };

  function list(dir) {
    if (dir.size > MAX_DIR_BYTES) throw new DiscError('directory is too large');
    const data = extent(dir.lba, dir.size);
    const entries = [];
    let pos = 0;
    while (pos < data.length) {
      const len = data[pos];
      if (len === 0) {
        pos = (Math.floor(pos / SECTOR) + 1) * SECTOR; // records never cross a sector
        continue;
      }
      if (len < 34 || pos + len > data.length) throw new DiscError('bad directory record');
      const nameLen = data[pos + 32];
      const name = data.toString('latin1', pos + 33, pos + 33 + nameLen);
      if (!(nameLen === 1 && (name === '\0' || name === '\x01'))) {
        entries.push({
          name,
          lba: data.readUInt32LE(pos + 2),
          size: data.readUInt32LE(pos + 10),
          dir: (data[pos + 25] & 2) !== 0,
        });
      }
      pos += len;
    }
    return entries;
  }

  function lookup(p) {
    const parts = p.split(/[\\/]+/).filter(Boolean);
    if (!parts.length) throw new DiscError('empty disc path');
    let node = root;
    for (const part of parts) {
      if (!node.dir) throw new DiscError(`not a directory on the disc: ${p}`);
      const found = list(node).find((e) => key(e.name) === key(part));
      if (!found) throw new DiscError(`no such file on the disc: ${p}`);
      node = found;
    }
    return node;
  }

  const disc = {
    image,
    mode,
    /** The bytes of a file by its disc path, e.g. "MENU/SAVEMENU.MNU". */
    read(p) {
      const node = lookup(p);
      if (node.dir) throw new DiscError(`is a directory on the disc: ${p}`);
      if (node.size > MAX_FILE_BYTES) throw new DiscError(`file is too large: ${p}`);
      return extent(node.lba, node.size);
    },
    /** The disc path of the boot executable named by SYSTEM.CNF's BOOT line. */
    bootPath() {
      const cnf = disc.read('SYSTEM.CNF');
      if (cnf.length > 4096) throw new DiscError('SYSTEM.CNF is too large');
      return parseBootLine(cnf.toString('latin1'));
    },
    close() {
      closeSync(fd);
    },
  };
  return disc;
}

/** The disc path in a SYSTEM.CNF "BOOT = cdrom:\PATH;1" line. */
export function parseBootLine(text) {
  for (const raw of text.split(/[\r\n]+/)) {
    const m = /^\s*BOOT\s*=\s*cdrom0?:\s*(\S+)/i.exec(raw);
    if (m) {
      const p = m[1].replace(/^[\\/]+/, '').replace(/;\d+$/, '');
      if (!p) break;
      return p;
    }
  }
  throw new DiscError('SYSTEM.CNF has no BOOT line');
}
