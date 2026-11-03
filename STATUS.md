# Project status

_Update this when an issue closes or a blocker appears. Fine-grained progress lives in GitHub issues and PR Handoff sections; see `docs/CONTINUITY.md`._

**Current milestone:** M1, the iPhone emulator baseline and Tier 1 harness (`docs/PHASE0.md`).

**State:** Phase 0 merged (PR #2). M1 issues #3–#8 are filed. #3 is done: `core/build.sh` builds the pinned core to a reproducible Wasm archive (PR #9).

**Next:** implement the M1 issues in order:
1. ~~#3 pin the toolchain and build PCSX ReARMed for Wasm~~ (done);
2. #4 a minimal headless Node runner;
3. #5 the scenario format and the first homebrew test;
4. #6 the asset-guard check;
5. #7 the browser wrapper with file import;
6. #8 the iPhone benchmark page.

Wiring checks into CI (`.github/workflows/`) and adding baselines (`harness/baselines/`) touch protected paths. Each goes in its own PR labelled `needs-owner`.

**Owner involvement:** the iPhone checks (Tier 3) are requested by agents through a PR comment with a preview link. Expect one short request at a time.

**Blocked / needs owner:**
- Before M1.5:
  - set up the private storage bucket and the OIDC cloud role;
  - set up branch protection and CODEOWNERS.
- Agent sessions' egress proxy blocks github.com archive (codeload) downloads; `git` over HTTPS works. The core build avoids archive downloads (see `notes/3-core-build.md`).
