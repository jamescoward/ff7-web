// A small JSON Schema (draft 2020-12) validator for the harness's own
// schemas. Original project code, GPL-2.0-or-later.
//
// It implements only the keywords listed in KEYWORDS, with standard
// semantics, and throws on any other keyword, so a schema can never rely on
// a check that is silently skipped. $ref supports local "#/$defs/<name>"
// references only. This avoids a third-party dependency for a few hundred
// bytes of schema.

const ANNOTATIONS = new Set(['$schema', '$id', 'title', 'description']);
const KEYWORDS = new Set([
  ...ANNOTATIONS, '$defs', '$ref', 'type', 'const', 'enum',
  'properties', 'required', 'additionalProperties', 'propertyNames', 'minProperties', 'maxProperties',
  'items', 'minItems', 'maxItems', 'uniqueItems',
  'pattern', 'minLength', 'maxLength', 'minimum', 'maximum', 'oneOf',
]);

const typeOf = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v; // string, boolean, object
};
const isType = (v, t) => {
  const actual = typeOf(v);
  return actual === t || (t === 'number' && actual === 'integer');
};

const ptr = (path) => (path.length ? `/${path.join('/')}` : '(root)');

/** Deep equality for JSON values. */
function jsonEqual(a, b) {
  if (a === b) return true;
  if (typeOf(a) !== typeOf(b) || typeof a !== 'object' || a === null) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]));
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && jsonEqual(a[k], b[k]));
}

/** Throw if the schema uses a keyword this validator does not implement. */
export function checkSchemaKeywords(schema, where = '#') {
  if (typeof schema === 'boolean') return;
  if (typeOf(schema) !== 'object') throw new Error(`schema at ${where} is not an object`);
  for (const [k, v] of Object.entries(schema)) {
    if (!KEYWORDS.has(k)) throw new Error(`unsupported schema keyword "${k}" at ${where}`);
    if (k === '$defs' || k === 'properties') {
      for (const [name, sub] of Object.entries(v)) checkSchemaKeywords(sub, `${where}/${k}/${name}`);
    } else if (k === 'oneOf') {
      v.forEach((sub, i) => checkSchemaKeywords(sub, `${where}/oneOf/${i}`));
    } else if (k === 'items' || k === 'additionalProperties' || k === 'propertyNames') {
      checkSchemaKeywords(v, `${where}/${k}`);
    } else if (k === '$ref' && !/^#\/\$defs\/[^/]+$/.test(v)) {
      throw new Error(`unsupported $ref "${v}" at ${where}: only #/$defs/<name>`);
    }
  }
}

/**
 * Validate `value` against `root`. Returns a list of error strings, empty
 * when valid.
 */
export function validate(root, value) {
  checkSchemaKeywords(root);
  const errors = [];
  walk(root, value, [], errors, root);
  return errors;
}

function walk(schema, v, path, errors, root) {
  if (schema === true) return;
  if (schema === false) {
    errors.push(`${ptr(path)}: not allowed`);
    return;
  }
  const err = (msg) => errors.push(`${ptr(path)}: ${msg}`);

  if (schema.$ref) {
    const name = schema.$ref.slice('#/$defs/'.length);
    const target = root.$defs?.[name];
    if (target === undefined) throw new Error(`unresolved $ref ${schema.$ref}`);
    walk(target, v, path, errors, root);
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => isType(v, t))) {
      err(`expected ${types.join(' or ')}, got ${typeOf(v)}`);
      return; // later keywords would only add noise
    }
  }
  if ('const' in schema && !jsonEqual(v, schema.const)) err(`must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((e) => jsonEqual(v, e))) {
    err(`must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  }

  if (typeof v === 'string') {
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(v)) {
      err(`${JSON.stringify(v)} does not match ${schema.pattern}`);
    }
    const len = [...v].length;
    if (schema.minLength !== undefined && len < schema.minLength) err(`shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && len > schema.maxLength) err(`longer than ${schema.maxLength}`);
  }
  if (typeof v === 'number') {
    if (schema.minimum !== undefined && v < schema.minimum) err(`must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && v > schema.maximum) err(`must be <= ${schema.maximum}`);
  }

  if (Array.isArray(v)) {
    if (schema.minItems !== undefined && v.length < schema.minItems) err(`needs at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && v.length > schema.maxItems) err(`allows at most ${schema.maxItems} items`);
    if (schema.uniqueItems && v.some((x, i) => v.findIndex((y) => jsonEqual(x, y)) !== i)) err('items must be unique');
    if (schema.items !== undefined) v.forEach((x, i) => walk(schema.items, x, [...path, i], errors, root));
  }

  if (typeOf(v) === 'object') {
    const keys = Object.keys(v);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) {
      err(`needs at least ${schema.minProperties} properties`);
    }
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) {
      err(`allows at most ${schema.maxProperties} properties`);
    }
    for (const r of schema.required ?? []) if (!Object.hasOwn(v, r)) err(`missing required property "${r}"`);
    const props = schema.properties ?? {};
    for (const k of keys) {
      if (schema.propertyNames !== undefined) walk(schema.propertyNames, k, [...path, k], errors, root);
      if (Object.hasOwn(props, k)) walk(props[k], v[k], [...path, k], errors, root);
      else if (schema.additionalProperties !== undefined) {
        if (schema.additionalProperties === false) err(`unknown property "${k}"`);
        else walk(schema.additionalProperties, v[k], [...path, k], errors, root);
      }
    }
  }

  if (schema.oneOf) {
    const results = schema.oneOf.map((sub) => {
      const e = [];
      walk(sub, v, path, e, root);
      return e;
    });
    const passing = results.filter((e) => e.length === 0).length;
    if (passing !== 1) {
      if (passing === 0) {
        // Report the branch with the fewest errors: usually the intended one.
        const best = results.reduce((a, b) => (b.length < a.length ? b : a));
        err(`matches none of the ${schema.oneOf.length} allowed forms`);
        errors.push(...best);
      } else {
        err(`matches ${passing} of the allowed forms; expected exactly one`);
      }
    }
  }
}
