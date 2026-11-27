// Unit (#290): semantic/ stays platform-neutral (CLAUDE.md, "Keep FF7
// knowledge platform-neutral"; docs/ARCHITECTURE_SURVEY.md §8), so a later
// native frontend can reuse it. Every module may import only sibling
// ./*.js modules, and its code (comments and strings aside) may not name a
// DOM, Worker, Node, timer, clock, storage or network API. The exceptions
// are listed below with a reason, and a listed exception that no longer
// occurs fails the test, so the list cannot go stale.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const DIR = new URL('../../../semantic/', import.meta.url);

/** Node tools that live in semantic/ but are not part of the layer. */
const TOOLS = new Set(['sync-web.js']);

/** Platform names a module's code may not use. Case-sensitive, so WINDOW_* constants don't match. */
export const FORBIDDEN = [
  // DOM and browser globals
  'window', 'document', 'navigator', 'location', 'self', 'globalThis',
  'localStorage', 'sessionStorage', 'indexedDB', 'caches',
  // Workers and messaging
  'Worker', 'SharedWorker', 'postMessage', 'BroadcastChannel', 'MessageChannel',
  // Node
  'process', 'require', 'module', 'Buffer', '__dirname', '__filename',
  // timers and clocks (time is counted in game frames)
  'setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval',
  'requestAnimationFrame', 'queueMicrotask', 'performance', 'Date',
  // network
  'fetch', 'XMLHttpRequest', 'WebSocket',
];

/** file -> { name: reason } for the uses that are allowed. */
export const EXCEPTIONS = {
  'layer.js': {
    globalThis: 'Web Crypto (globalThis.crypto.subtle) hashes the boot executable for the disc gate (sha1Hex); a native frontend swaps in its own SHA-1',
  },
};

/**
 * The source with comments, string and template literals replaced by
 * spaces (line breaks kept). Regular-expression literals are kept as code,
 * so a quote inside one would confuse it; semantic/ has none (checked by
 * the "every module scans cleanly" test, which would then report a
 * forbidden name or an import from inside a string).
 */
export function codeOnly(src) {
  let out = '';
  let i = 0;
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    let end;
    if (c === '/' && n === '/') {
      end = src.indexOf('\n', i);
      if (end < 0) end = src.length;
    } else if (c === '/' && n === '*') {
      end = src.indexOf('*/', i + 2);
      end = end < 0 ? src.length : end + 2;
    } else if (c === '"' || c === "'" || c === '`') {
      end = i + 1;
      while (end < src.length && src[end] !== c) end += src[end] === '\\' ? 2 : 1;
      end = Math.min(end + 1, src.length);
      // keep the quotes so import specifiers stay findable by position
      out += c + blank(src.slice(i + 1, end - 1)) + (end - 1 > i ? src[end - 1] : '');
      i = end;
      continue;
    } else {
      out += c;
      i += 1;
      continue;
    }
    out += blank(src.slice(i, end));
    i = end;
  }
  return out;
}

/** Import specifiers of a module (static `import ... from 'x'`, `export ... from 'x'`, and dynamic `import(...)`). */
export function importsOf(src) {
  const specs = [];
  for (const m of src.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s*(['"])([^'"]*)\1/gm)) specs.push(m[2]);
  for (const m of src.matchAll(/^\s*import\s*(['"])([^'"]*)\1/gm)) specs.push(m[2]);
  if (/\bimport\s*\(/.test(codeOnly(src))) specs.push('import()');
  return specs;
}

/** Forbidden names the code uses, as a sorted list (property names after a dot don't count). */
export function platformNames(src) {
  const code = codeOnly(src);
  const found = new Set();
  for (const name of FORBIDDEN) {
    const re = new RegExp(`(?<![\\w$.])${name}(?![\\w$])(?!\\s*:(?!:))`);
    if (re.test(code)) found.add(name);
  }
  if (/\bimport\s*\.\s*meta\b/.test(code)) found.add('import.meta');
  return [...found].sort();
}

/** Problems with one module's source: bad imports and unexcused platform names. */
export function problems(file, src, exceptions = EXCEPTIONS) {
  const out = [];
  for (const spec of importsOf(src)) {
    if (!/^\.\/[\w-]+\.js$/.test(spec)) out.push(`imports ${spec}`);
  }
  const allowed = exceptions[file] ?? {};
  const used = platformNames(src);
  for (const name of used) if (!(name in allowed)) out.push(`uses ${name}`);
  for (const name of Object.keys(allowed)) if (!used.includes(name)) out.push(`stale exception ${name}`);
  return out;
}

const MODULES = readdirSync(DIR).filter((f) => f.endsWith('.js') && !TOOLS.has(f)).sort();

describe('semantic/ is platform-neutral', () => {
  test('there are modules to check, and the exceptions name real modules', () => {
    assert.ok(MODULES.includes('addresses.js') && MODULES.includes('layer.js') && MODULES.length >= 10);
    for (const f of Object.keys(EXCEPTIONS)) assert.ok(MODULES.includes(f), f);
  });

  for (const f of MODULES) {
    test(`${f}: only ./*.js imports, no platform APIs`, () => {
      assert.deepEqual(problems(f, readFileSync(new URL(f, DIR), 'utf8')), []);
    });
  }
});

describe('the checker catches what it should', () => {
  const bad = {
    'a timer': ['setTimeout(() => {}, 1);', 'uses setTimeout'],
    'the DOM': ['const el = document.body;', 'uses document'],
    'window': ['window.addEventListener("x", f);', 'uses window'],
    'a clock': ['const t = Date.now();', 'uses Date'],
    'performance': ['const t = performance.now();', 'uses performance'],
    'a Node import': ["import { readFileSync } from 'node:fs';", 'imports node:fs'],
    'a bare package': ["import x from 'lodash';", 'imports lodash'],
    'a parent directory': ["import { a } from '../runner/x.js';", 'imports ../runner/x.js'],
    'a re-export': ["export { a } from 'node:path';", 'imports node:path'],
    'a side-effect import': ["import 'node:process';", 'imports node:process'],
    'a dynamic import': ["const m = await import('./x.js');", 'imports import()'],
    'import.meta': ['const u = import.meta.url;', 'uses import.meta'],
    'process': ['if (process.env.X) f();', 'uses process'],
    'globalThis': ['const c = globalThis.crypto;', 'uses globalThis'],
    'a Worker': ['new Worker("w.js");', 'uses Worker'],
    'fetch': ['await fetch(url);', 'uses fetch'],
  };
  for (const [name, [src, want]] of Object.entries(bad)) {
    test(`flags ${name}`, () => assert.ok(problems('x.js', src, {}).includes(want), problems('x.js', src, {}).join('; ')));
  }

  const fine = {
    'comments and strings': '// setTimeout and document\n/* window, Date.now() */\nconst s = "process fetch"; const t = `Worker ${1}`;',
    'property names and keys': 'const o = { window: 1, Date: 2 }; o.window = o.document; o.process();',
    'longer identifiers': 'const windowState = 1, WINDOW_TXT_DONE = 2, dateOf = 3, processed = 4, selfTest = 5;',
    'sibling imports': "import { a } from './addresses.js';\nexport { b } from './planner.js';",
  };
  for (const [name, src] of Object.entries(fine)) {
    test(`allows ${name}`, () => assert.deepEqual(problems('x.js', src, {}), []));
  }

  test('an exception covers only its own file, and a stale one is reported', () => {
    const ex = { 'x.js': { globalThis: 'reason' } };
    assert.deepEqual(problems('x.js', 'globalThis.crypto;', ex), []);
    assert.deepEqual(problems('y.js', 'globalThis.crypto;', ex), ['uses globalThis']);
    assert.deepEqual(problems('x.js', 'const a = 1;', ex), ['stale exception globalThis']);
  });
});
