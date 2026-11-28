// Test helpers for the browser wrapper: a static server for web/, and
// Playwright browsers. These files run under Node only.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CORE_BUILT = existsSync(path.join(WEB, 'core', 'core.wasm'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

/** Serve web/ on a free localhost port, like the static preview host. */
export function serveWeb() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(WEB, path.normalize(rel));
    if (!file.startsWith(WEB + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() });
    });
  });
}

/**
 * Playwright, resolved from the project or the global install
 * (createRequire honours NODE_PATH, which ESM import does not).
 */
export function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require('playwright');
  } catch {
    return null;
  }
}

/** Browsers to test: WEB_BROWSERS="chromium,webkit" (the default). */
export const BROWSERS = (process.env.WEB_BROWSERS ?? 'chromium,webkit')
  .split(',').map((s) => s.trim()).filter(Boolean);

/**
 * Launch `name`, or return { skip: reason } when it isn't installed here.
 * A skip is reported by node:test, never counted as a pass. With
 * WEB_REQUIRE_BROWSERS=1 (CI) a missing browser is an error instead.
 */
export async function launch(pw, name) {
  const missing = (reason) => {
    if (process.env.WEB_REQUIRE_BROWSERS === '1') throw new Error(reason);
    return { skip: reason };
  };
  if (!pw) return missing('playwright is not installed');
  const type = pw[name];
  if (!type) return missing(`unknown browser ${name}`);
  if (!existsSync(type.executablePath())) return missing(`${name} is not installed for this Playwright`);
  return { browser: await type.launch() };
}

/** Poll `fn` until it returns a truthy value or the timeout passes. */
export async function until(fn, { timeout = 10_000, interval = 50, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}
