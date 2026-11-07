// Read files from a PS1 disc image through a positional reader. Original
// project code, GPL-2.0-or-later.
//
// Shared by the Node runner (runner/disc.js adds the file I/O) and the
// browser worker (which reads the player's own disc file in place). Nothing
// here uses a Node API: bytes are Uint8Array, and the image is reached only
// through readAt(offset, length) -> Uint8Array, which must be synchronous
// (a Node fd, or FileReaderSync in a worker). Nothing knows about any
// particular game.
//
// Supported: ISO9660 on MODE1/2048, MODE1/2352 or MODE2/2352 (XA form 1, the
// PS1 data track). Only the first track is read, which is where a PS1
// disc's file system lives.

/**
 * A disc that can't be read. `step` says how far opening it got:
 * "cue" (the cue sheet), "image" (opening the image), "volume" (the file
 * system), or "file" (a file on a readable disc).
 */
export class DiscError extends Error {
  constructor(message, step = 'file', reason = 0) {
    super(message);
    this.step = step;
    this.reason = reason;
  }
}

/**
 * Why opening a disc failed, as a number (DiscError.reason): a scenario
 * can report it as the metric disc_error. 0 means no error.
 */
export const DISC_ERRORS = {
  cue_read: 1, // the cue sheet can't be read, or is too large
  cue_file: 2, // no FILE line
  cue_track: 3, // no TRACK line after the FILE
  cue_mode: 4, // the first track's mode is not supported
  image_missing: 5, // the image the cue names is not next to it
  image_read: 6, // the image can't be opened or read
  volume: 7, // no ISO9660 file system
};

export const SECTOR = 2048;
export const RAW = 2352;
/** Largest file read() returns; PS1 executables and overlays are far smaller. */
export const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_DIR_BYTES = 1024 * 1024;

export const MODES = {
  'MODE1/2048': { size: SECTOR, offset: 0 },
  'MODE1/2352': { size: RAW, offset: 16 },
  'MODE2/2352': { size: RAW, offset: 24 },
};

const latin1 = (bytes, from, to) => {
  let s = '';
  for (let i = from; i < to; i++) s += String.fromCharCode(bytes[i]);
  return s;
};
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/**
 * Parse a cue sheet's text. Returns { file, mode } for the first FILE and
 * its first TRACK. The file name is returned as written; callers resolve it
 * against the cue's directory.
 */
export function parseCue(text) {
  let file = null;
  let mode = null;
  for (const raw of text.replace(/^﻿/, '').replace(/^\xEF\xBB\xBF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    let m;
    if (!file && (m = /^FILE\s+(?:"([^"]+)"|(\S+))\s+\S+$/i.exec(line))) {
      file = m[1] ?? m[2];
    } else if (file && !mode && (m = /^TRACK\s+\d+\s+(\S+)$/i.exec(line))) {
      mode = m[1].toUpperCase();
    }
  }
  if (!file) throw new DiscError('cue sheet has no FILE line', 'cue', DISC_ERRORS.cue_file);
  if (!mode) throw new DiscError('cue sheet has no TRACK line', 'cue', DISC_ERRORS.cue_track);
  if (!MODES[mode]) throw new DiscError(`unsupported first track mode ${mode}`, 'cue', DISC_ERRORS.cue_mode);
  return { file, mode };
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

const errCode = (e) => e?.code ?? 'error';

/** Guess the sector layout of a bare image from its size and first sector. */
export function sniffMode(readAt, size) {
  if (size % RAW === 0) {
    const head = readAt(0, 16);
    const sync = head[0] === 0 && head[11] === 0 && head.subarray(1, 11).every((b) => b === 0xff);
    if (sync) return head[15] === 1 ? 'MODE1/2352' : 'MODE2/2352';
    // Raw images may start with an empty sector 0 without a sync pattern;
    // the volume descriptor at sector 16 settles it.
    const pvd = readAt(16 * RAW, 16);
    if (pvd[0] === 0 && pvd[11] === 0) return pvd[15] === 1 ? 'MODE1/2352' : 'MODE2/2352';
  }
  if (size % SECTOR === 0) return 'MODE1/2048';
  throw new DiscError('image size is not a whole number of 2048 or 2352 byte sectors', 'volume', DISC_ERRORS.volume);
}

/** Name compare key: upper case, version (";1") and a trailing dot removed. */
const key = (name) => name.toUpperCase().replace(/;\d+$/, '').replace(/\.$/, '');

/**
 * Open an ISO9660 volume on an image reached through readAt.
 * `mode` is a MODES key, or null to detect it from the image.
 * Returns { mode, read(path) -> Uint8Array, bootPath() }. Errors are DiscError.
 * The caller owns whatever readAt reads from (closing it).
 */
export function openIso(readAt, size, mode = null) {
  try {
    mode ??= sniffMode(readAt, size);
  } catch (e) {
    if (e instanceof DiscError) throw e;
    throw new DiscError(`cannot read the disc image (${errCode(e)})`, 'image', DISC_ERRORS.image_read);
  }
  const { size: sectorSize, offset } = MODES[mode];
  const sectors = Math.floor(size / sectorSize);

  function sector(lba) {
    if (!Number.isInteger(lba) || lba < 0 || lba >= sectors) throw new DiscError(`sector ${lba} is outside the image`);
    let buf;
    try {
      buf = readAt(lba * sectorSize + offset, SECTOR);
    } catch (e) {
      throw new DiscError(`cannot read sector ${lba} (${errCode(e)})`);
    }
    if (buf.length !== SECTOR) throw new DiscError(`short read at sector ${lba}`);
    return buf;
  }

  function extent(lba, len) {
    const out = new Uint8Array(len);
    for (let i = 0, pos = 0; pos < len; i++, pos += SECTOR) {
      out.set(sector(lba + i).subarray(0, Math.min(SECTOR, len - pos)), pos);
    }
    return out;
  }

  let pvd;
  try {
    pvd = sector(16);
  } catch (e) {
    throw new DiscError(e.message, 'volume', DISC_ERRORS.volume);
  }
  if (pvd[0] !== 1 || latin1(pvd, 1, 6) !== 'CD001') {
    throw new DiscError('no ISO9660 primary volume descriptor', 'volume', DISC_ERRORS.volume);
  }
  const root = { lba: u32(pvd, 156 + 2), size: u32(pvd, 156 + 10), dir: true };

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
      const name = latin1(data, pos + 33, pos + 33 + nameLen);
      if (!(nameLen === 1 && (name === '\0' || name === '\x01'))) {
        entries.push({
          name,
          lba: u32(data, pos + 2),
          size: u32(data, pos + 10),
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

  const iso = {
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
      const cnf = iso.read('SYSTEM.CNF');
      if (cnf.length > 4096) throw new DiscError('SYSTEM.CNF is too large');
      return parseBootLine(latin1(cnf, 0, cnf.length));
    },
  };
  return iso;
}
