# tools/asset-guard — keep game data out of the repository

Defence in depth for `docs/SECURITY.md`: a check that fails when the tree holds something that looks like game data. It is not proof of absence. It reads names, sizes, the first ~37 KB of each file and SHA-256 hashes, and it never prints file contents.

```sh
node tools/asset-guard/check.js            # the repository: files git would commit
node tools/asset-guard/check.js --root site --walk --max-binary-bytes 2000000   # any directory
node --test tools/asset-guard              # tests (synthetic temp trees only)
```

Exit status: `0` clean, `1` violations (one line per file and rule; `--json` for machine output), `2` usage or configuration error.

## Which files
- **git mode** (default when `--root` is a work-tree root): tracked files, including force-added ignored ones, plus untracked files that aren't ignored. So it also catches a file before it is committed.
- **walk mode** (`--walk`, or a directory that isn't a work tree): every file except under `.git/`, for example an assembled preview site. Symlinks are listed but not followed.

## Rules
| Rule | Fails on | Allow-list overrides? |
|---|---|---|
| `forbidden-extension` | disc images (`.bin .cue .iso .img .chd .pbp .ecm .mdf .mds .ccd .sub .toc .nrg .cdi`), saves and memory cards (`.mcr .mcd .mc .srm .sav .gme .vmp .psv .vm1 .state .stateN`), archives that could hide them (`.zip .7z .rar`) | no |
| `disc-executable-name` | names like `SLUS_007.00`, `SCES-12345` | no |
| `deny-listed-hash` | a file whose SHA-256 is on a deny-list | no |
| `content-signature` | a `PS-X EXE` header, raw CD sector sync, or an ISO9660 volume descriptor (cooked or raw), under any name | yes |
| `oversize-binary` | a file with a NUL in its first 8 KiB that is over 256 KiB (`--max-binary-bytes`) | yes |
| `oversize-file` | any file over 2 MiB (`--max-file-bytes`) | yes |
| `allowlist-hash-mismatch` | an allow-listed file whose content changed | — |
| `allowlist-stale` | an allow-list entry for a file that no longer exists (git mode) | — |

## Allow-list (`allowlist.json`)
Each entry pins `path` and `sha256` and records `licence`, `origin` and `reason`. Changing the file invalidates the entry. Adding an entry is a reviewable change like any other: say in the PR where the file comes from.

## Deny-list hook
`denylist.json` is empty in the public repository, because computing hashes of game files needs game data, which agents never handle. Private lists are added without committing them:

- `--denylist FILE` (repeatable), or
- `ASSET_GUARD_DENYLIST=/path/a.json:/path/b.json` (separated by the platform's path delimiter).

Each file is `{ "sha256": ["<hex>", ...] }`. The trusted private-eval job, or the owner, can keep such a list next to the disc in private storage.

## Licence
Original project code, GPL-2.0-or-later. No dependencies: Node built-ins only.
