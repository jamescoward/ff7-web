// Write more output than the cap allows. argv[2]: "bytes" (one big file)
// or "files" (many small files, to hit the inode cap).
import { writeFileSync, appendFileSync } from 'node:fs';
import { report } from './lib.mjs';

report({ started: true });
const mode = process.argv[2] || 'bytes';
let n = 0;
let code = 'none';
try {
  if (mode === 'bytes') {
    const chunk = Buffer.alloc(1 << 20, 0x41);
    for (;;) {
      appendFileSync('/out/fill.bin', chunk);
      n++;
    }
  } else {
    for (;;) {
      writeFileSync(`/out/f${n}`, 'x');
      n++;
    }
  }
} catch (e) {
  code = e.code;
}
// The directory is full, so this tiny write may fail too; the host's report
// is the authority.
try {
  writeFileSync('/out/result.json', JSON.stringify({ mode, n, code }));
} catch {
  /* full */
}
