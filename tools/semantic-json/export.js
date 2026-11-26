#!/usr/bin/env node
// Write semantic/addresses.json from semantic/addresses.js (#290), so code in
// another language (a later native frontend, docs/ARCHITECTURE_SURVEY.md §8)
// can read the address table without a JS engine.
//
//   node tools/semantic-json/export.js           write semantic/addresses.json
//   node tools/semantic-json/export.js --check   exit 1 if it is missing or differs
//
// The JSON holds every export of addresses.js that JSON can represent:
// ADDRESS_TABLE (with each entry's provenance), TYPES and the layout and enum
// constants. Functions (makeTable, validateTable) are left out. Addresses are
// plain JSON numbers (all are below 2^32). Facts only, as in addresses.js;
// nothing from the game. Original project code, GPL-2.0-or-later.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as addresses from '../../semantic/addresses.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OUT = path.resolve(HERE, '../../semantic/addresses.json');

/** Is v made only of JSON values (no functions, undefined, NaN, Infinity)? */
function jsonable(v) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(jsonable);
  if (typeof v === 'object') return Object.values(v).every(jsonable);
  return false;
}

/** The exports JSON can carry, by name in sorted order, and the ones it can't. */
export function exportsOf(mod) {
  const kept = {};
  const left = [];
  for (const name of Object.keys(mod).sort()) {
    if (jsonable(mod[name])) kept[name] = mod[name];
    else left.push(name);
  }
  return { kept, left };
}

/** The file's text: deterministic, two-space indent, trailing newline. */
export function render(mod = addresses) {
  const { kept, left } = exportsOf(mod);
  const doc = {
    _about: 'Generated from semantic/addresses.js by tools/semantic-json/export.js (#290); do not edit. See addresses.js for the field meanings and provenance rules.',
    _leftOut: left,
    ...kept,
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** True when semantic/addresses.json matches addresses.js. */
export function upToDate() {
  try {
    return readFileSync(OUT, 'utf8') === render();
  } catch {
    return false;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    if (!upToDate()) {
      console.error('semantic/addresses.json is out of date: run node tools/semantic-json/export.js');
      process.exit(1);
    }
  } else {
    writeFileSync(OUT, render());
  }
}
