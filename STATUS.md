# Project status

_Update this when an issue closes or a blocker appears. Fine-grained progress lives in GitHub issues and PR Handoff sections; see `docs/CONTINUITY.md`._

**Current milestone:** M1, the iPhone emulator baseline and Tier 1 harness (`docs/PHASE0.md`).

**State:** Phase 0 research and plan are complete (PR #2). No code yet.

**Next:**
1. Planner: create M1 issues from `docs/PHASE0.md` and `docs/EXPERIMENT_01_IPHONE_BASELINE.md`. Suggested order:
   1. pin the toolchain and build PCSX ReARMed for Wasm;
   2. a minimal headless Node runner;
   3. the scenario format and the first homebrew test;
   4. the asset-guard check;
   5. the browser wrapper with file import;
   6. the iPhone benchmark page.
2. Then implement them in order.

**Blocked / needs owner:**
- Merge PR #2. It touches protected paths.
- Before M1.5:
  - set up the private storage bucket and the OIDC cloud role;
  - set up branch protection and CODEOWNERS;
  - choose between a device cloud and the Mac for Tier 3.
