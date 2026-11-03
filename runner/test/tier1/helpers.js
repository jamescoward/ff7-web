import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildExe } from '../../synth/vblank-counter.js';

/** Write the synthetic EXE to a fresh temp dir; returns { exe, cleanup }. */
export function synthExe() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ff7-runner-'));
  const exe = path.join(dir, 'vblank-counter.exe');
  writeFileSync(exe, buildExe());
  return { exe, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
