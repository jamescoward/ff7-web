// Asset guard: find files that must never be in this repository (disc
// images, save states, memory cards, game executables, large unexplained
// binaries, known game files). Original project code, GPL-2.0-or-later.
//
// This is defence in depth (docs/SECURITY.md), not proof of absence. It
// reads file names, sizes, the first bytes, and SHA-256 hashes. It never
// prints file contents.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, lstatSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ALLOWLIST = path.join(HERE, 'allowlist.json');
export const DEFAULT_DENYLIST = path.join(HERE, 'denylist.json');

/** Extensions that are refused outright; no allow-list entry overrides them. */
export const FORBIDDEN_EXTENSIONS = Object.freeze({
  disc: ['.bin', '.cue', '.iso', '.img', '.chd', '.pbp', '.ecm', '.mdf', '.mds', '.ccd', '.sub', '.toc', '.nrg', '.cdi'],
  'save or memory card': ['.mcr', '.mcd', '.mc', '.srm', '.sav', '.gme', '.vmp', '.psv', '.vm1', '.state'],
  archive: ['.zip', '.7z', '.rar'],
});
const EXT_CATEGORY = new Map(
  Object.entries(FORBIDDEN_EXTENSIONS).flatMap(([cat, exts]) => exts.map((e) => [e, cat])),
);
// Numbered save-state slots, as RetroArch names them (game.state1, ...).
const STATE_SLOT = /\.state\d+$/i;
// PS1 disc executable names (SLUS_007.00 and similar), with or without the dot.
const DISC_EXE_NAME = /^(SLUS|SCUS|SLES|SCES|SLPS|SLPM|SCPS|SIPS|SLED|SCED|PAPX)[_-]?\d{3}\.?\d{2}(;1)?$/i;

export const DEFAULTS = Object.freeze({
  maxBinaryBytes: 256 * 1024, // any file with a NUL in its first 8 KiB
  maxFileBytes: 2 * 1024 * 1024, // any file at all
});

const SNIFF_BYTES = 0x9320 + 8; // enough to see ISO9660 in a raw 2352-byte-sector image

/** Content signatures of PS1 programs and CD images. */
function sniff(head) {
  const at = (off, s) => head.length >= off + s.length && head.toString('latin1', off, off + s.length) === s;
  if (at(0, 'PS-X EXE')) return 'PS-X EXE program';
  // Raw CD sector sync: 00 FF*10 00.
  if (head.length >= 12 && head[0] === 0 && head[11] === 0 && head.subarray(1, 11).every((b) => b === 0xff)) {
    return 'raw CD sector data';
  }
  // ISO9660 primary volume descriptor at sector 16, cooked (2048) or raw (2352, mode 2 form 1 offset 24).
  if (at(0x8001, 'CD001') || at(16 * 2352 + 24 + 1, 'CD001') || at(16 * 2352 + 16 + 1, 'CD001')) {
    return 'ISO9660 filesystem image';
  }
  return null;
}

function readHead(abs, n) {
  const fd = openSync(abs, 'r');
  try {
    const buf = Buffer.alloc(n);
    const got = readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, got);
  } finally {
    closeSync(fd);
  }
}

const sha256File = (abs) => createHash('sha256').update(readFileSync(abs)).digest('hex');

function loadJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

/**
 * Load the allow-list: { path -> entry }. Every entry must pin a SHA-256 and
 * record why the file is allowed, its licence and origin.
 */
export function loadAllowlist(p = DEFAULT_ALLOWLIST) {
  const doc = loadJson(p);
  const map = new Map();
  for (const [i, e] of (doc.files ?? []).entries()) {
    for (const k of ['path', 'sha256', 'licence', 'origin', 'reason']) {
      if (typeof e[k] !== 'string' || !e[k]) throw new Error(`${p}: files[${i}] needs "${k}"`);
    }
    if (!/^[0-9a-f]{64}$/.test(e.sha256)) throw new Error(`${p}: files[${i}].sha256 is not a SHA-256`);
    if (map.has(e.path)) throw new Error(`${p}: ${e.path} is listed twice`);
    map.set(e.path, e);
  }
  return map;
}

/** Load deny-listed hashes from one or more files: { sha256: [...] }. */
export function loadDenylist(paths) {
  const set = new Set();
  for (const p of paths) {
    const doc = loadJson(p);
    for (const h of doc.sha256 ?? []) {
      if (!/^[0-9a-f]{64}$/i.test(h)) throw new Error(`${p}: bad SHA-256 ${h}`);
      set.add(h.toLowerCase());
    }
  }
  return set;
}

/** Files git would commit: tracked, plus untracked files that aren't ignored. */
export function gitFiles(root) {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--deduplicate'], {
    cwd: root,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.toString('utf8').split('\0').filter(Boolean).filter((f) => existsSync(path.join(root, f)));
}

/** Every file under root except .git/. Symlinks are listed, not followed. */
export function walkFiles(root) {
  const files = [];
  const visit = (rel) => {
    for (const ent of readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (ent.name !== '.git') visit(r);
      } else {
        files.push(r);
      }
    }
  };
  visit('');
  return files.sort();
}

export function isGitRoot(root) {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return path.resolve(top.trim()) === path.resolve(root);
  } catch {
    return false;
  }
}

/**
 * Check a list of repository-relative files. Returns
 * { checked, violations: [{ path, rule, detail }] }, sorted by path.
 */
export function checkFiles(root, files, opts = {}) {
  const limits = { ...DEFAULTS, ...opts.limits };
  const allow = opts.allowlist ?? new Map();
  const deny = opts.denylist ?? new Set();
  const violations = [];
  const add = (p, rule, detail) => violations.push({ path: p, rule, detail });

  for (const rel of [...files].sort()) {
    const abs = path.join(root, rel);
    const base = path.posix.basename(rel.replaceAll('\\', '/'));
    const lower = base.toLowerCase();
    const ext = path.extname(lower);

    if (EXT_CATEGORY.has(ext)) add(rel, 'forbidden-extension', `${ext} (${EXT_CATEGORY.get(ext)})`);
    else if (STATE_SLOT.test(lower)) add(rel, 'forbidden-extension', 'numbered save-state slot');
    if (DISC_EXE_NAME.test(base)) add(rel, 'disc-executable-name', 'named like a PS1 disc executable');

    const st = lstatSync(abs);
    if (st.isSymbolicLink() || !st.isFile()) continue; // git stores the link text only

    let hash = null;
    const getHash = () => (hash ??= sha256File(abs));
    if (deny.size && deny.has(getHash())) add(rel, 'deny-listed-hash', 'matches a known game file');

    const entry = allow.get(rel);
    const allowed = entry && entry.sha256 === getHash();
    if (entry && !allowed) add(rel, 'allowlist-hash-mismatch', 'file changed since it was allow-listed');

    const head = readHead(abs, Math.min(st.size, SNIFF_BYTES));
    const signature = sniff(head);
    const binary = head.subarray(0, 8192).includes(0);
    if (!allowed) {
      if (signature) add(rel, 'content-signature', signature);
      if (st.size > limits.maxFileBytes) add(rel, 'oversize-file', `${st.size} bytes > ${limits.maxFileBytes}`);
      else if (binary && st.size > limits.maxBinaryBytes) {
        add(rel, 'oversize-binary', `${st.size} bytes > ${limits.maxBinaryBytes}`);
      }
    }
  }
  return { checked: files.length, violations };
}

/** Check a tree: git's file list when root is a git work tree, else a walk. */
export function checkTree(root, opts = {}) {
  const mode = opts.mode ?? (isGitRoot(root) ? 'git' : 'walk');
  const files = mode === 'git' ? gitFiles(root) : walkFiles(root);
  const result = { mode, ...checkFiles(root, files, opts) };
  // In the repository itself, an allow-list entry for a file that no longer
  // exists is stale: report it, so the list stays honest.
  if (mode === 'git') {
    const present = new Set(files);
    for (const p of (opts.allowlist ?? new Map()).keys()) {
      if (!present.has(p)) result.violations.push({ path: p, rule: 'allowlist-stale', detail: 'allow-listed file is not in the tree' });
    }
  }
  return result;
}
