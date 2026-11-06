// Input segments for scenario format 2 (#74): named, reusable lists of
// script steps, included in a script with { "segment": NAME }. Original
// project code, GPL-2.0-or-later.
//
// A segment is a file segments/<name>.json beside the scenario files
// (harness/scenarios/segments/), matching $defs/segment in
// harness/schema/scenario.schema.json. Segments are expanded before a
// scenario runs: the result is the plain list of steps the scenario would
// have written out. A missing, invalid or recursive segment is a load error
// (ScenarioError). The trusted Tier 2 side reads only *.json directly in
// harness/scenarios/, so segment files are never taken for scenarios.

import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { validate } from './schema.js';
import { ScenarioError } from './scenario.js';

/** Steps a script may hold once its segments are expanded. */
export const MAX_EXPANDED_STEPS = 16384;
/** Largest segment file read, as for scenario files. */
export const MAX_SEGMENT_BYTES = 64 * 1024;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The segments directory for a scenario file: segments/ beside it. */
export const segmentsDirFor = (scenarioFile) => path.join(path.dirname(path.resolve(scenarioFile)), 'segments');

/** The schema rooted at $defs/segment (same $defs, so its $refs resolve). */
function segmentSchema(schema) {
  const { oneOf: _o, type: _t, ...rest } = schema;
  return { ...rest, $ref: '#/$defs/segment' };
}

/** Read and check one segment file; throws ScenarioError. */
function readSegment(name, dir, schema) {
  if (!NAME_RE.test(name)) throw new ScenarioError(`segment "${name}": not a valid segment name`);
  if (!dir) throw new ScenarioError(`no segment named "${name}": no segments directory`);
  const file = path.join(dir, `${name}.json`);
  let doc;
  try {
    const st = lstatSync(file);
    if (!st.isFile()) throw new Error('not a regular file');
    if (st.size > MAX_SEGMENT_BYTES) throw new Error(`larger than ${MAX_SEGMENT_BYTES} bytes`);
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') throw new ScenarioError(`no segment named "${name}" (segments/${name}.json)`);
    throw new ScenarioError(`segment "${name}": ${e.message}`);
  }
  const errors = validate(segmentSchema(schema), doc);
  if (errors.length) throw new ScenarioError(`segment "${name}" does not match the schema:\n  ${errors.join('\n  ')}`);
  if (doc.name !== name) throw new ScenarioError(`segment "${name}": its name is "${doc.name}"; it must equal the file name`);
  return doc;
}

/**
 * Expand { segment } steps, recursively. `steps` already matched the
 * schema. Returns a new list with no segment steps; throws ScenarioError on
 * a missing, invalid or recursive segment, or when the expansion holds more
 * than MAX_EXPANDED_STEPS steps.
 */
export function expandSegments(steps, { dir, schema }) {
  const cache = new Map();
  const out = [];
  const walk = (list, stack) => {
    for (const s of list) {
      if (!Object.hasOwn(s, 'segment')) {
        if (out.length >= MAX_EXPANDED_STEPS) throw new ScenarioError(`the script holds more than ${MAX_EXPANDED_STEPS} steps once its segments are expanded`);
        out.push(s);
        continue;
      }
      const name = s.segment;
      if (stack.includes(name)) throw new ScenarioError(`segment recursion: ${[...stack, name].join(' -> ')}`);
      if (!cache.has(name)) cache.set(name, readSegment(name, dir, schema));
      walk(cache.get(name).steps, [...stack, name]);
    }
  };
  walk(steps, []);
  return out;
}
