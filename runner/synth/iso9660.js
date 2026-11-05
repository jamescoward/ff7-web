// Synthetic ISO9660 disc images for Tier 1 tests of disc boot (#36).
// Original project code, GPL-2.0-or-later; it contains no game data.
//
// buildIso({ files, mode, volumeId }) returns a Buffer holding an image
// with the given files: { "SYSTEM.CNF": bytes, "DIR/NAME.EXT": bytes, ... }
// (one directory level). mode is "MODE2/2352" (default; XA form 1 sectors,
// the PS1 data track layout), "MODE1/2352" or "MODE1/2048". Raw sectors get
// a sync pattern, an MSF header and a form 1 subheader; EDC/ECC are zero,
// which emulators do not check. cueFor(binName, mode) is the matching cue.

const SECTOR = 2048;

const bcd = (n) => ((Math.floor(n / 10) << 4) | n % 10);

function bothEndian32(buf, off, v) {
  buf.writeUInt32LE(v, off);
  buf.writeUInt32BE(v, off + 4);
}
function bothEndian16(buf, off, v) {
  buf.writeUInt16LE(v, off);
  buf.writeUInt16BE(v, off + 2);
}

function dirRecord(name, lba, size, isDir) {
  const nameBuf = Buffer.from(name, 'latin1');
  let len = 33 + nameBuf.length;
  if (len % 2) len++;
  const r = Buffer.alloc(len);
  r[0] = len;
  bothEndian32(r, 2, lba);
  bothEndian32(r, 10, size);
  r.set([126, 1, 1, 0, 0, 0, 0], 18); // 2026-01-01 00:00:00 UTC
  r[25] = isDir ? 2 : 0;
  bothEndian16(r, 28, 1);
  r[32] = nameBuf.length;
  nameBuf.copy(r, 33);
  return r;
}

/** Pack records into whole sectors; a record never crosses a sector. */
function packDir(records) {
  const sectors = [];
  let cur = Buffer.alloc(0);
  for (const r of records) {
    if (cur.length + r.length > SECTOR) {
      sectors.push(cur);
      cur = Buffer.alloc(0);
    }
    cur = Buffer.concat([cur, r]);
  }
  sectors.push(cur);
  return Buffer.concat(sectors.map((s) => Buffer.concat([s, Buffer.alloc(SECTOR - s.length)])));
}

const sectorsFor = (n) => Math.max(1, Math.ceil(n / SECTOR));

export function buildIso({ files, mode = 'MODE2/2352', volumeId = 'FF7WEB_TEST' }) {
  // Group files by directory (root = '').
  const dirs = new Map([['', []]]);
  for (const [p, bytes] of Object.entries(files)) {
    const parts = p.split('/');
    if (parts.length > 2) throw new Error(`only one directory level: ${p}`);
    const [dir, name] = parts.length === 2 ? parts : ['', parts[0]];
    if (!dirs.has(dir)) {
      dirs.set(dir, []);
      dirs.get('').push({ name: dir, dir: true });
    }
    dirs.get(dir).push({ name: `${name};1`, bytes: Buffer.from(bytes) });
  }

  // Layout: 0-15 system area, 16 PVD, 17 terminator, 18 path table,
  // then directories (one sector each, enough for test images), then files.
  let lba = 19;
  const dirLba = new Map();
  for (const d of dirs.keys()) dirLba.set(d, lba++);
  const fileLba = new Map();
  for (const entries of dirs.values()) {
    for (const e of entries) {
      if (e.dir) continue;
      fileLba.set(e, lba);
      lba += sectorsFor(e.bytes.length);
    }
  }
  const total = lba;
  const user = Buffer.alloc(total * SECTOR);

  const dirSize = SECTOR;
  for (const [d, entries] of dirs) {
    const self = dirLba.get(d);
    const parent = dirLba.get('');
    const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : 1));
    const recs = [dirRecord('\0', self, dirSize, true), dirRecord('\x01', parent, dirSize, true)];
    for (const e of sorted) {
      recs.push(e.dir ? dirRecord(e.name, dirLba.get(e.name), dirSize, true) : dirRecord(e.name, fileLba.get(e), e.bytes.length, false));
    }
    const packed = packDir(recs);
    if (packed.length > SECTOR) throw new Error('test directory exceeds one sector');
    packed.copy(user, self * SECTOR);
  }
  for (const [e, at] of fileLba) e.bytes.copy(user, at * SECTOR);

  // Path table (L): root only is enough for readers that walk directories.
  const pt = user.subarray(18 * SECTOR);
  pt[0] = 1;
  pt.writeUInt32LE(dirLba.get(''), 2);
  pt.writeUInt16LE(1, 6);

  const pvd = user.subarray(16 * SECTOR, 17 * SECTOR);
  pvd[0] = 1;
  pvd.write('CD001', 1, 'latin1');
  pvd[6] = 1;
  pvd.fill(0x20, 8, 72);
  pvd.write('PLAYSTATION', 8, 'latin1');
  pvd.write(volumeId, 40, 'latin1');
  bothEndian32(pvd, 80, total);
  bothEndian16(pvd, 120, 1);
  bothEndian16(pvd, 124, 1);
  bothEndian16(pvd, 128, SECTOR);
  bothEndian32(pvd, 132, 10);
  pvd.writeUInt32LE(18, 140);
  dirRecord('\0', dirLba.get(''), dirSize, true).copy(pvd, 156);
  pvd.fill(0x20, 190, 813);
  pvd[881] = 1;
  const term = user.subarray(17 * SECTOR, 18 * SECTOR);
  term[0] = 255;
  term.write('CD001', 1, 'latin1');
  term[6] = 1;

  if (mode === 'MODE1/2048') return user;
  const raw = mode === 'MODE2/2352';
  if (!raw && mode !== 'MODE1/2352') throw new Error(`unsupported mode ${mode}`);
  const out = Buffer.alloc(total * 2352);
  for (let i = 0; i < total; i++) {
    const s = out.subarray(i * 2352, (i + 1) * 2352);
    s.fill(0xff, 1, 11);
    const abs = i + 150;
    s[12] = bcd(Math.floor(abs / 4500));
    s[13] = bcd(Math.floor(abs / 75) % 60);
    s[14] = bcd(abs % 75);
    s[15] = raw ? 2 : 1;
    const dataOff = raw ? 24 : 16;
    if (raw) s.set([0, 0, 8, 0, 0, 0, 8, 0], 16); // form 1, data
    user.copy(s, dataOff, i * SECTOR, (i + 1) * SECTOR);
  }
  return out;
}

export const cueFor = (binName, mode = 'MODE2/2352') => `FILE "${binName}" BINARY\n  TRACK 01 ${mode}\n    INDEX 01 00:00:00\n`;
