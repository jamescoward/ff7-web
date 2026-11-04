// Look for host secrets: environment variables, credential files, the
// Docker socket, and a canary file the test planted on the host.
// argv[2] is the canary marker the test chose; we look for it everywhere.
import { existsSync, readdirSync, readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { attempt, report } from './lib.mjs';

const marker = process.argv[2];
const r = { env_keys: Object.keys(process.env).sort() };
r.marker_in_env = JSON.stringify(process.env).includes(marker);

// Every process's environment we can read.
r.marker_in_proc_environ = false;
for (const p of readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
  try {
    if (readFileSync(`/proc/${p}/environ`, 'latin1').includes(marker)) r.marker_in_proc_environ = true;
  } catch {
    /* not readable */
  }
}

const paths = [
  '/var/run/docker.sock', '/run/docker.sock', '/run/containerd/containerd.sock',
  '/root/.docker/config.json', '/home/runner/.docker/config.json', '/home/runner/.gitconfig',
  '/home/runner/work', '/home/runner/.aws/credentials', '/github/home', '/github/workflow/event.json',
  '/root/.aws/credentials', '/root/.config/rclone/rclone.conf', '/etc/shadow',
  '/run/secrets', '/var/run/secrets/kubernetes.io/serviceaccount/token',
];
r.readable = {};
for (const p of paths) {
  r.readable[p] = await attempt(() => {
    if (!existsSync(p)) return 'absent';
    if (lstatSync(p).isDirectory()) return readdirSync(p) && 'ok';
    readFileSync(p);
    return 'ok';
  });
}

// Walk the filesystem (not /proc or /sys) for any file or directory whose
// name contains the marker: the planted canary must not be reachable.
r.marker_in_filenames = [];
let walked = 0;
const walk = (dir, depth) => {
  if (depth > 12 || walked > 200000) return;
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const n of names) {
    walked++;
    const full = path.join(dir, n);
    if (n.includes(marker)) r.marker_in_filenames.push(full);
    if (full === '/proc' || full === '/sys') continue;
    try {
      if (lstatSync(full).isDirectory()) walk(full, depth + 1);
    } catch {
      /* gone or unreadable */
    }
  }
};
walk('/', 0);
r.walked = walked;
r.uid = process.getuid();
r.gid = process.getgid();
report(r);
