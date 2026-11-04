// Shared by the hostile test programs: record what each attempt did.
// These programs are deliberately malicious-looking; they only run inside
// the sandbox, and only to prove its limits hold (issue #33).
import { writeFileSync } from 'node:fs';

/** Run fn with a deadline; return "ok", an error code, or "timeout". */
export async function attempt(fn, ms = 3000) {
  let timer;
  try {
    const r = await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'timeout' })), ms);
      }),
    ]);
    return r === undefined ? 'ok' : r;
  } catch (e) {
    return e.code || e.name || 'error';
  } finally {
    clearTimeout(timer);
  }
}

export function report(result) {
  writeFileSync('/out/result.json', JSON.stringify(result));
}
