// Per-PR preview site: assemble one preview, and place or remove it in a
// gh-pages working tree. Original project code, GPL-2.0-or-later.
//
// Layout of the gh-pages branch:
//   index.html        list of live previews (rewritten on every change)
//   .nojekyll         serve files as-is
//   main/             latest main
//   pr-<n>/           one folder per open PR, removed when the PR closes
// Nothing else on the branch is touched.

import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const SLOT = /^(main|pr-[1-9]\d{0,6})$/;

/** File types a preview may contain. Anything else fails the build. */
export const ALLOWED_EXTENSIONS = Object.freeze([
  '.html', '.css', '.js', '.mjs', '.map', '.wasm', '.json', '.webmanifest', '.txt',
  '.svg', '.png', '.webp', '.ico', '.woff2',
]);

export function assertSlot(slot) {
  if (!SLOT.test(slot)) throw new Error(`bad preview slot "${slot}": expected main or pr-<n>`);
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Every file under dir (relative paths), refusing symlinks and dotfiles. */
export function listSite(dir) {
  const files = [];
  const visit = (rel) => {
    for (const ent of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.name.startsWith('.')) throw new Error(`preview may not contain dotfiles: ${r}`);
      if (ent.isSymbolicLink()) throw new Error(`preview may not contain symlinks: ${r}`);
      if (ent.isDirectory()) visit(r);
      else if (ent.isFile()) files.push(r);
      else throw new Error(`preview may contain only files and folders: ${r}`);
    }
  };
  visit('');
  return files.sort();
}

/** Throw unless every file in the site has an allowed type. Returns the file list. */
export function checkSite(dir) {
  const files = listSite(dir);
  const bad = files.filter((f) => !ALLOWED_EXTENSIONS.includes(path.extname(f).toLowerCase()));
  if (bad.length) throw new Error(`preview files of a type not on the allow-list: ${bad.join(', ')}`);
  if (!files.includes('index.html')) throw new Error('preview has no index.html');
  return files;
}

function placeholderPage({ slot, sha, repo }) {
  const label = slot === 'main' ? 'main' : `PR #${slot.slice(3)}`;
  const short = sha ? sha.slice(0, 7) : 'unknown';
  const commit = repo && sha
    ? `<a href="https://github.com/${escapeHtml(repo)}/commit/${escapeHtml(sha)}">${escapeHtml(short)}</a>`
    : escapeHtml(short);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ff7-web preview</title>
<style>
  :root { color-scheme: light dark; --fg: #1b1b1f; --bg: #fafafa; --muted: #5f6368; }
  @media (prefers-color-scheme: dark) { :root { --fg: #e8e8ea; --bg: #121214; --muted: #a0a3a8; } }
  body { margin: 0; padding: 24px 16px; font: 16px/1.5 system-ui, -apple-system, sans-serif; color: var(--fg); background: var(--bg); }
  main { max-width: 40rem; margin: 0 auto; }
  p { color: var(--muted); }
  a { color: inherit; }
</style>
</head>
<body>
<main>
  <h1>ff7-web preview</h1>
  <p>${escapeHtml(label)} at commit ${commit}.</p>
  <p>This build has no browser app yet: <code>web/</code> does not exist. The browser wrapper (issue #7) will appear here.</p>
</main>
</body>
</html>
`;
}

/**
 * Assemble a preview into `out` (must not exist): a copy of `webDir` if it
 * exists, else a placeholder page, plus preview.json describing the build.
 */
export function buildSite({ out, webDir, slot, sha = '', repo = '' }) {
  assertSlot(slot);
  if (existsSync(out)) throw new Error(`output ${out} already exists`);
  let source;
  if (webDir && existsSync(webDir)) {
    listSite(webDir); // refuse symlinks and dotfiles before copying
    cpSync(webDir, out, { recursive: true });
    source = 'web/';
  } else {
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, 'index.html'), placeholderPage({ slot, sha, repo }));
    source = 'placeholder';
  }
  writeFileSync(path.join(out, 'preview.json'), `${JSON.stringify({ format: 1, slot, sha, repo, source }, null, 2)}\n`);
  return checkSite(out);
}

function slotInfo(pages, slot) {
  try {
    return JSON.parse(readFileSync(path.join(pages, slot, 'preview.json'), 'utf8'));
  } catch {
    return {};
  }
}

/** Live slots on the branch, main first, then PRs by number. */
export function listSlots(pages) {
  return readdirSync(pages, { withFileTypes: true })
    .filter((e) => e.isDirectory() && SLOT.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => (a === 'main' ? -1 : b === 'main' ? 1 : Number(a.slice(3)) - Number(b.slice(3))));
}

/** Rewrite the branch's root index.html and .nojekyll. */
export function writeIndex(pages) {
  const items = listSlots(pages).map((slot) => {
    const info = slotInfo(pages, slot);
    const label = slot === 'main' ? 'main' : `PR #${slot.slice(3)}`;
    const sha = info.sha ? ` <code>${escapeHtml(String(info.sha).slice(0, 7))}</code>` : '';
    return `    <li><a href="./${slot}/">${escapeHtml(label)}</a>${sha}</li>`;
  });
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ff7-web previews</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 24px 16px; font: 16px/1.6 system-ui, -apple-system, sans-serif; }
  main { max-width: 40rem; margin: 0 auto; }
  li a { display: inline-block; min-height: 44px; line-height: 44px; }
</style>
</head>
<body>
<main>
  <h1>ff7-web previews</h1>
  <p>Static builds of original code and homebrew only. No game data is hosted here.</p>
  <ul>
${items.length ? items.join('\n') : '    <li>No previews yet.</li>'}
  </ul>
</main>
</body>
</html>
`;
  writeFileSync(path.join(pages, 'index.html'), html);
  writeFileSync(path.join(pages, '.nojekyll'), '');
}

/** Replace a slot's folder with `site`, then rewrite the index. */
export function placeSlot({ pages, slot, site }) {
  assertSlot(slot);
  checkSite(site);
  const dest = path.join(pages, slot);
  rmSync(dest, { recursive: true, force: true });
  cpSync(site, dest, { recursive: true });
  writeIndex(pages);
}

/** Remove a slot's folder (no-op if absent), then rewrite the index. */
export function removeSlot({ pages, slot }) {
  assertSlot(slot);
  const dest = path.join(pages, slot);
  if (existsSync(dest) && !lstatSync(dest).isDirectory()) throw new Error(`${slot} is not a folder`);
  rmSync(dest, { recursive: true, force: true });
  writeIndex(pages);
}
