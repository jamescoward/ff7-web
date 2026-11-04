# Issue #14: preview deploy notes

2026-11-04. The owner chose GitHub Pages from a `gh-pages` branch for now, with Cloudflare Pages once COOP/COEP is needed.

## Decisions
- **Branch-based Pages, one folder per PR.** The Actions "deploy-pages" source publishes one site at a time, so per-PR folders would overwrite each other.
- **No history on gh-pages:** each publish is one parentless commit, force-pushed. A history of ~1 MB Wasm builds per PR push would bloat the repository. Deploy and cleanup share the `gh-pages-publish` concurrency group, so the force-push can't race.
- **Least privilege:** build has a read-only token; deploy and cleanup have `contents: write` + `pull-requests: write`. Same-repo PRs only, so no one gains access they don't already have. Cleanup uses the default branch's tools.
- **The asset guard runs three times:** repo, built site, final gh-pages tree. The site binary limit is raised to 2 MiB for the future `core.wasm` (861,701 bytes, `notes/6-asset-guard.md`).
- **Actions are pinned to commit SHAs** (lightweight tags, checked with `git ls-remote` on 2026-11-04): checkout v7.0.1 `3d3c42e5…`, setup-node v7.1.0 `949feb24…`, upload-artifact v7.0.2 `cf430e03…`, download-artifact v8.0.2 `90008279…`. All run on node24 and were released 2026-07-17 to 2026-10-07.
- `git-auth.sh` passes the token as an `http.extraheader` (as actions/checkout does), never in a URL, and masks the base64 form.

## Not done locally
- `actionlint` couldn't be run: running the downloaded binary was blocked in the agent sandbox. The YAML parses (PyYAML), and the expressions were reviewed by hand. The real check is the workflow run on the PR itself.
