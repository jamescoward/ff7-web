// Read files from a PS1 disc image: a cue sheet's first data track, or a
// bare .bin/.iso. Original project code, GPL-2.0-or-later.
//
// Used by the scenario runner (#36) for disc checks that run inside the
// Tier 2 sandbox: the boot executable named by SYSTEM.CNF and other files
// are read and compared there, and only pass/fail leaves. Nothing here
// knows about any particular game.
//
// The ISO9660 reader itself is runner/iso9660.js, shared with the browser
// (#75). This file keeps what needs Node: the cue's file and the descriptor.

import { closeSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import path from 'node:path';

import { DISC_ERRORS, DiscError, MAX_FILE_BYTES, openIso, parseBootLine, parseCue } from './iso9660.js';

export { DISC_ERRORS, DiscError, MAX_FILE_BYTES, parseBootLine, parseCue };

const MAX_CUE_BYTES = 64 * 1024;

/**
 * Open a disc image. `file` is a .cue (its first FILE is opened) or an
 * image. Returns { read(path), bootPath(), close(), image, mode }.
 */
export function openDisc(file) {
  let image = file;
  let mode = null;
  if (path.extname(file).toLowerCase() === '.cue') {
    let text;
    try {
      text = readFileSync(file);
    } catch (e) {
      throw new DiscError(`cannot read the cue sheet (${e.code ?? 'error'})`, 'cue', DISC_ERRORS.cue_read);
    }
    if (text.length > MAX_CUE_BYTES) throw new DiscError('cue sheet is too large', 'cue', DISC_ERRORS.cue_read);
    const cue = parseCue(text.toString('latin1'));
    // Only a file next to the cue: a cue can't point elsewhere.
    image = path.join(path.dirname(file), path.basename(cue.file.replace(/\\/g, '/')));
    mode = cue.mode;
  }
  let fd;
  try {
    fd = openSync(image, 'r');
  } catch (e) {
    const reason = e.code === 'ENOENT' ? DISC_ERRORS.image_missing : DISC_ERRORS.image_read;
    throw new DiscError(`cannot open the disc image (${e.code ?? 'error'})`, 'image', reason);
  }
  const size = fstatSync(fd).size;
  const readAt = (offset, length) => {
    const buf = Buffer.alloc(length);
    const n = readSync(fd, buf, 0, length, offset);
    return n === length ? buf : buf.subarray(0, n);
  };
  let iso;
  try {
    iso = openIso(readAt, size, mode);
  } catch (e) {
    closeSync(fd);
    throw e;
  }
  // Callers get Buffers (toString, equals); the bytes are not copied.
  const asBuffer = (u8) => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);
  return {
    image,
    mode: iso.mode,
    /** The bytes of a file by its disc path, e.g. "MENU/SAVEMENU.MNU". */
    read: (p) => asBuffer(iso.read(p)),
    /** The disc path of the boot executable named by SYSTEM.CNF's BOOT line. */
    bootPath: () => iso.bootPath(),
    close() {
      closeSync(fd);
    },
  };
}
