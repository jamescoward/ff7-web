// Spawn processes until the kernel refuses, and keep trying until killed.
// Each child is a shell that itself tries to fork forever.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

let started = 0;
let refused = null;
const bomb = () => {
  try {
    const c = spawn('/bin/sh', ['-c', 'while :; do sleep 1000 & done'], { stdio: 'ignore' });
    c.on('error', (e) => {
      refused ??= e.code;
    });
    c.on('spawn', () => started++);
  } catch (e) {
    refused ??= e.code;
  }
};
setInterval(() => {
  for (let i = 0; i < 8; i++) bomb();
  try {
    writeFileSync('/out/result.json', JSON.stringify({ started, refused }));
  } catch {
    /* the result is best effort; the host's report is the authority */
  }
}, 20);
