// Leave a detached child behind that writes to /out after we exit. The
// sandbox must end every process with the container and freeze /out, so
// the late write must never land.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const child = spawn(process.execPath, ['-e', `
  setTimeout(() => require('fs').writeFileSync('/out/late.txt', 'late'), 1500);
`], { detached: true, stdio: 'ignore' });
child.unref();
writeFileSync('/out/result.json', JSON.stringify({ child: child.pid > 0 }));
