# #290: semantic/ purity guard and the address table as JSON

Two cheap steps the owner asked for (2026-11-26) so `semantic/` stays reusable by a later native frontend (`docs/ARCHITECTURE_SURVEY.md` §8). No runtime behaviour changes.

## Purity guard
`runner/test/unit/semantic-purity.test.js` reads every `semantic/*.js` module except the Node tool `sync-web.js` and fails when one:
- imports anything other than a sibling `./*.js` module (Node built-ins, packages, parent directories and dynamic `import()` all fail);
- names a DOM, Worker, Node, timer, clock, storage or network API in code. Comments and strings are blanked first, and property names (`o.window`) and object keys don't count.

Exceptions are listed in the test with a reason, and an exception that no longer occurs fails the test. The one today is `layer.js` using Web Crypto (`globalThis.crypto.subtle`) to hash the boot executable for the disc gate. A native frontend would swap in its own SHA-1.

Limit (a hypothesis, not tested against every case): the scanner treats regular-expression literals as code, so a quote inside a regex literal could hide code after it. `semantic/` has none today.

## Address table as JSON
`tools/semantic-json/export.js` writes `semantic/addresses.json` from `semantic/addresses.js`: every export that JSON can hold (`ADDRESS_TABLE` with provenance, `TYPES`, layout and enum constants). `_leftOut` names the functions it leaves out. Addresses are plain numbers. `--check` reports drift, and `runner/test/unit/semantic-json.test.js` fails when the file is out of date and checks that every entry round-trips.

`sync-web.js` copies only `.js` files, so the JSON is not shipped to `web/`.

After changing `addresses.js`, run `node tools/semantic-json/export.js`.
