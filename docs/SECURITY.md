# Game data and CI security

Personal hobby project with public source. The owner's legally obtained FF7 (USA) disc is used for testing; nothing derived from it is ever published.

## Never in the repository, issues, PRs, logs or artifacts
- Disc images, extracted game files, BIOS images.
- Memory cards, save states, RAM dumps.
- Screenshots, video or audio captured from the game.
- Code generated or decompiled from the game's executables.
- Credentials of any kind.

The `.gitignore` and the asset-guard CI check are defence in depth, not proof of absence. If game data ever lands in Git history, a later delete is not enough: purge the history and rotate any exposed credentials.

## Where private data lives
- **Private object storage** (S3-compatible, encrypted at rest):
  - the disc image;
  - save-state fixtures, referenced by opaque ID;
  - private baselines.
- **The owner's own devices**, for manual play and feel testing.

## Trust boundary for automated testing
Agents may write code that runs against game data, provided that code runs only inside the private eval sandbox described in `docs/AUTOMATION.md`:

1. **Credentials are short-lived OIDC tokens.** The cloud role trusts only the private-eval workflow file on `main`. PR code never sees credentials, and PR-triggered workflows get no secrets.
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
