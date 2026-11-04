# Project status

_Update this when an issue closes or a blocker appears. Fine-grained progress lives in GitHub issues and PR Handoff sections; see `docs/CONTINUITY.md`._

**Current milestone:** M1, the iPhone emulator baseline and Tier 1 harness (`docs/PHASE0.md`).

**State:** Phase 0 merged (PR #2). M1 issues #3–#8 and #14 are filed. #3 is done: `core/build.sh` builds the pinned core to a reproducible Wasm archive (PR #9). #4 is done: `runner/` links it into a headless Node runner with the backend interface and deterministic JSON output. #5 is done: scenario format 1 (`harness/README.md`), `runner/scenario.js`, and the `pad-echo` homebrew, which shows injected input reaching a PS1 program. #6 is done: `tools/asset-guard/check.js` fails on disc images, saves, game executables, oversize binaries and deny-listed hashes.

**Next:** implement the M1 issues in order:
1. ~~#3 pin the toolchain and build PCSX ReARMed for Wasm~~ (done);
2. ~~#4 a minimal headless Node runner~~ (done);
3. ~~#5 the scenario format and the first homebrew test~~ (done; its baseline was merged in #13);
4. ~~#6 the asset-guard check~~ (done; CI wiring is a separate `needs-owner` PR);
5. #14 per-PR preview deployment on GitHub Pages (owner-approved approach; the PR is `needs-owner`; the owner then enables Pages from `gh-pages`); needed before #7 and #8 can get their Tier 3 checks;
6. #7 the browser wrapper with file import;
7. #8 the iPhone benchmark page.

Wiring checks into CI (`.github/workflows/`) and adding baselines (`harness/baselines/`) touch protected paths. Each goes in its own PR labelled `needs-owner`.

**Waiting on the owner (protected paths, `needs-owner`):**
- PR #16 (#14): per-PR preview deploys on GitHub Pages. Its first run deployed `gh-pages`; the owner enables Pages (Settings → Pages → `gh-pages`, root) and merges.
- PR #17: CI (`unit` + `tier1`). Passing, with the core reproduced bit for bit on GitHub's runners. After merge, make both required checks.
- PR #18: CODEOWNERS for the protected paths. Code-owner review stays off until agents have their own GitHub identity, because agent PRs are opened under the owner's account.

**Owner involvement:** the iPhone checks (Tier 3) are requested by agents through a PR comment with a preview link. Expect one short request at a time.

**Blocked / needs owner:**
- Before M1.5:
  - set up the private storage bucket and the OIDC cloud role;
  - a `main` ruleset (PR required with 0 approvals, no force push or deletion, linear history, required checks once #17 merges). The repo is now public, so this is available on the free plan;
  - a separate GitHub identity for agents (bot account or App), so code-owner review can be enforced.
- Agent sessions' egress proxy blocks github.com archive (codeload) downloads; `git` over HTTPS works. The core build avoids archive downloads (see `notes/3-core-build.md`). The proxy also blocks `*.github.io`, so agents can't load previews themselves; they check the `gh-pages` branch instead.
