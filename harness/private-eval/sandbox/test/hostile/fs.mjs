// Try to write everywhere except the output directory, including the disc.
// Then try to create a file on every mount the kernel says is read-write.
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { attempt, report } from './lib.mjs';

const tryWrite = (file) =>
  attempt(() => {
    writeFileSync(file, 'x');
    return 'ok';
  });

const r = { targets: {}, rw_mounts: {} };
for (const f of [
  '/x', '/etc/x', '/etc/passwd', '/work/x', '/disc/x', '/usr/local/bin/x', '/var/tmp/x',
  '/home/x', '/root/x', '/dev/x', '/dev/shm/x', '/run/x', '/sys/fs/cgroup/x', '/out/../escape',
  '/proc/sys/kernel/hostname', '/proc/sysrq-trigger',
]) {
  r.targets[f] = await tryWrite(f);
}
r.targets['/disc/disc.bin (open r+)'] = await attempt(() => {
  const fd = openSync('/disc/disc.bin', 'r+');
  writeSync(fd, Buffer.from([0]), 0, 1, 0);
  closeSync(fd);
  return 'ok';
});
r.targets['mkdir /work/d'] = await attempt(() => {
  mkdirSync('/work/d');
  return 'ok';
});

// Every mount listed read-write: try to create a file at its root.
for (const line of readFileSync('/proc/mounts', 'utf8').trim().split('\n')) {
  const [, mnt, type, opts] = line.split(' ');
  if (!opts.split(',').includes('rw')) continue;
  r.rw_mounts[mnt] = { type, write: await tryWrite(path.join(mnt, `.probe-${process.pid}`)) };
}
// The allowed places, for comparison.
r.targets['/out/ok'] = await tryWrite('/out/ok');
r.targets['/tmp/ok'] = await tryWrite('/tmp/ok');
report(r);
