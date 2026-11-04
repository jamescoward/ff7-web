# Issue #6: asset guard notes

2026-11-04, Node 22.23.4.

## Decisions
- **Zero dependencies**, like `runner/`.
- **The file list comes from git** (`ls-files --cached --others --exclude-standard`), not a directory walk. The repo check then ignores `core/.src/` (≈360 MB of upstream source and emsdk) and build outputs, but still sees force-added ignored files and untracked files before they are committed. Walk mode exists for non-git trees: the tests' temp trees, and the assembled preview site for #14.
- **Content sniffing** as well as extensions: a `PS-X EXE` header, raw CD sync, and ISO9660 at sector 16 (cooked, raw mode 1, raw mode 2 form 1). A renamed disc image or game executable is still caught. The project's own homebrew EXEs are generated at test time and never committed, so they don't conflict.
- **Archives** (`.zip .7z .rar`) are forbidden too, because they could hide any of the above; `.gitignore` already excluded them.
- **Allow-listing** pins a SHA-256 and overrides only the size and content rules. Forbidden extensions, disc-executable names and deny-listed hashes can't be allow-listed.
- **The deny-list is a hook, empty in the repo.** Computing FF7 file hashes needs the disc, which agents never handle (CLAUDE.md). Private lists come in through `--denylist` / `ASSET_GUARD_DENYLIST`.
- `node --test tools/asset-guard` (the issue's acceptance command): Node 22 resolves a directory argument as a module, not a test folder. So `package.json` `main` points to `test/all.js`, which imports the test files.

## Measured
- The current tree in git mode: 54 files checked, 0 violations, exit 0. Tracked files are all under 15 KB.
- 50 tests pass, all on synthetic temp trees (every forbidden extension in two cases; names; the three content signatures; size limits at and over the edge; the allow-list pass, mismatch and stale cases; the deny-list by name-independent hash; git vs walk mode; CLI exit codes and JSON).

## For #14 (preview deploy)
- A walk of `runner/` flags `dist/core.wasm` (861,701 bytes) as `oversize-binary`. The preview site will contain the core, so the preview workflow should either pass `--max-binary-bytes` just above the core's size, or allow-list the reproducible `core.wasm` hash for that run. Both keep the content and extension rules in force.
- CI wiring (`.github/workflows/`) is protected and goes in a separate `needs-owner` PR.
