# Game data and CI security

Personal hobby project with public source. The owner's legally obtained FF7 (USA) disc is used for testing; nothing derived from it is ever published.

## Never in the repository, issues, PRs, logs or artifacts
- Disc images, extracted game files, BIOS images.
- Memory cards, save states, RAM dumps. This includes cards *generated* from a save description (see below): they are produced at test time and never committed.
- Screenshots, video or audio captured from the game.
- Code generated or decompiled from the game's executables.
- Credentials of any kind.

The `.gitignore` and the asset-guard CI check are defence in depth, not proof of absence. If game data ever lands in Git history, a later delete is not enough: purge the history and rotate any exposed credentials.

## Generated save boot points
Test scenarios may start from a memory card that the harness **generates at test time** from a short, human-readable save description (field, position, party, story progress, and so on). The descriptions and the generator may be committed, because they contain no bytes taken from the game:

- **Allowed in the repo:** save descriptions written as JSON, the generator, and its tests. Field IDs, coordinates, flags and other values are plain numbers that the author chose.
- **Never in the repo:** generated card files, and any card or save block made by the game itself, including the owner's own saves. Real cards may be used only by the owner on their own devices.
- **Original bytes only:** the generator must not embed the game's save icon, its location-name text, or any other content copied from the game or a real save. It writes original placeholders, such as a blank icon and an ASCII label.
- **Layout and checksum are facts:** take them from public documentation, cited in `notes/`. Copy no code from save editors or decompilations, whatever their licence.
- Writing a generated card into the emulator's card slot counts as input, not as a write to game memory.

## Where private data lives
- **Private object storage** (S3-compatible, encrypted at rest):
  - the disc image;
  - save-state fixtures, referenced by opaque ID;
  - private baselines.
- **The owner's own devices**, for manual play and feel testing.

## Trust boundary for automated testing
Agents may write code that runs against game data, provided that code runs only inside the private eval sandbox described in `docs/AUTOMATION.md`:

1. **Credentials are a read-only storage token, scoped to the disc bucket.** It is held as secrets of the GitHub environment `tier2-private`, whose deployment branches are limited to `main`. Only workflow jobs running from `main` that name that environment can read it: today only the Tier 2 eval job, which uses it to download the disc. The PR's own build archive is unpacked in a separate job without secrets. The eval job unpacks only that job's re-upload, so it still relies on the artifact tool's path checks (`notes/35-tier2-workflows.md`). PR code never sees credentials, and PR-triggered workflows get no secrets. (Owner decision, 2026-11-04: R2 doesn't accept GitHub OIDC tokens natively; see #35.)
2. **The untrusted code runs in a container with no network.** The disc is mounted read-only, with resource and time limits.
3. **The only output is JSON validated by trusted code from `main`** against a fixed schema of pass/fail, numbers and small integers. Nothing else from the sandbox is printed or uploaded.
4. **No game data in the GitHub Actions cache or artifacts.** Both can be reached from PR workflows.
5. **Protected by CODEOWNERS and branch protection; owner review required:**
   - `.github/`
   - `CLAUDE.md`
   - `docs/SECURITY.md`
   - `harness/private-eval/`
   - `harness/baselines/`

**Accepted residual risk:** low-bandwidth leakage through scenario pass/fail results. This is mitigated by limits on scenarios per run and summary-only reporting.

## Third-party services
Device clouds, hosted previews and similar services receive only original code and homebrew test programs, never game data.

## Browser runtime
- Users import their own files locally, through `<input type=file>`. No game data is sent to any server.
- Saves are kept locally and are exportable, because browser storage can be evicted.
- Service workers and caches must never package or upload game files.

## Legal caveat
Bring-your-own-files and private testing do not automatically settle copyright, trademark or licence questions. Public branding uses no Square Enix or Sony names or logos beyond plain description. Third-party licences (GPL-2.0 for PCSX ReARMed, and others) are preserved.
