# Issue 75: semantic layer skeleton, address table, hash gate

## What exists
| Path | Role |
|---|---|
| `semantic/addresses.js` | The address table. Entries: name, address (or `null`), type, meaning, source, status (`hypothesis`, or `confirmed` + `scenario`), exe SHA-1. `makeTable`, `validateTable`, `ADDRESS_TABLE`, `EXE_USA_SHA1`. |
| `semantic/layer.js` | `createSemantic({ backend, exeSha1, table })` with the readers `mode()`, `fieldId()`, `playerPosition()`, `menuCursor()`, `party()`; `bootExeSha1(iso)`, `evaluateGate`, `activateSemantic`. Only `readMem` is used; there is no write path. |
| `runner/iso9660.js` | The ISO9660 reader moved out of `runner/disc.js` (it stays in `runner/` because Tier 2 and the sandbox ship only `runner/` and `harness/`; see below): `openIso(readAt, size, mode)`, `parseCue`, `parseBootLine`, `DiscError`. Uint8Array only, no Node API. |
| `runner/disc.js` | Now only Node file I/O (cue file, fd) on top of `openIso`. Same exports and behaviour; its tests are unchanged. |
| `web/js/disc-gate.js` | `gateForFiles(files)` in the worker: `FileReaderSync` over the chosen `.bin/.iso/.img`, `openIso`, hash, compare. |
| `web/js/emu-worker.js`, `backend.js` | After `loaded`, the worker posts `{ type: 'semantic', active, reason }`. `backend.semanticGate` and `opts.onSemantic` expose it. No UI. |

## Reader results
`{ value, confirmed }`, or `{ value: null, confirmed: false, reason }` with reason `inactive` (gate off, nothing is read), `no address`, or `read failed`. `confirmed` is true only if every address the reader used is `confirmed`. Unconfirmed values are still returned; callers decide whether to trust them. Readers are async so one layer works with the runner's sync `readMem` and the browser's promise one.

## Seeded hypotheses (all `hypothesis`)
Only two addresses exist in the repo: `g_GameState` s16 at 0x8009C560 and `g_PrevGameState` s16 at 0x800965EC (decomp `9411173`, via `notes/36-disc-boot.md`). Values field 1, battle 2, world 3, menu 5; movie has no candidate (#76). Field ID, position, menu cursor and party slots are entries with `address: null`: the repo only has savemap offsets (`notes/32-save-format.md`, the saved copy), not the RAM location. Their readers answer `no address`. #77 and #78 supply addresses. Nothing was invented.

## How the browser gets the shared module
`web/` is published as-is, and `tools/preview/lib.js` refuses symlinks, and the preview/CI workflows are protected paths. So the browser can import only files under `web/`. Decision: `semantic/*.js` and `runner/iso9660.js` are the sources and `web/js/semantic/` holds byte-identical copies, made by `node semantic/sync-web.js`.

Why the disc reader is in `runner/`, not `semantic/`: the Tier 2 build (`.github/workflows/tier2-build.yml`) and the sandbox test upload only `runner/` and parts of `harness/` as the work directory. A first version put it in `semantic/iso9660.js`; `runner/disc.js` then failed to import inside the sandbox (CI `private-eval-tests` on PR #83). The same limit applies to any later runner code that wants to import `semantic/` (for example #76 using the readers in Tier 2): it needs either a copy under `runner/` or a `needs-owner` change to the workflow. `runner/test/unit/semantic-sync.test.js` (in CI's unit job) fails when they drift. Edit `semantic/`, then run the sync script. Alternative considered: make `web/js/semantic/` the source (no copies), rejected because the owner decided the layer lives in `semantic/`.

## Hash gate
The layer is active only if SHA-1 of the file named by SYSTEM.CNF's BOOT line equals the table's `exe` (USA SCUS_941.63, `a95e8b16...`, already published in `notes/36-disc-boot.md`). The hash is computed in the worker with Web Crypto and compared; it is never posted, stored or logged, and only `{ active, reason }` leaves. Limits:
- Needs a raw image (`.bin/.iso/.img`). `.chd`, `.pbp` and bare `.exe` leave the layer off (reason says so). A cue is not needed (owner decision: no cue files); the bin is read.
- Web Crypto needs a secure context (https or localhost); otherwise the layer stays off.
- A Greatest Hits or other revision has another exe hash and stays off until it gets its own table (open question for the owner).

## Open questions
- The layer is not wired to the live backend in the app yet (that is #79's overlay and M3). The worker only reports the gate.
- A later issue may want the layer in the worker (sync RAM) instead of over `readMem` messages.

## Tests
`runner/test/unit/semantic.test.js` (table rules, readers on synthetic RAM with hypothesis and confirmed tables, the gate over `openDisc` and over `openIso`), `runner/test/unit/semantic-sync.test.js`, `web/test/semantic-gate.test.js` (gate in a Chromium/WebKit worker on synthetic discs, and the worker's verdict after load).
