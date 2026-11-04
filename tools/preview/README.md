# tools/preview — per-PR preview sites on GitHub Pages

`.github/workflows/preview.yml` publishes every same-repo PR to `https://<owner>.github.io/<repo>/pr-<n>/` and the latest `main` to `…/main/`. Agents put the PR link in Tier 3 iPhone-check requests (`docs/AUTOMATION.md`). Forks are never deployed.

| File | What |
|---|---|
| `build.js` | Assembles one site: a copy of `web/` when it exists, otherwise a placeholder page, plus `preview.json` (slot, commit). Fails on file types off the allow-list, dotfiles, symlinks, or a missing `index.html`. |
| `publish.js` | `place` / `remove` a slot in a gh-pages working tree, then rewrites the root `index.html` (list of live previews) and `.nojekyll`. Touches nothing else. |
| `gh-pages-checkout.sh` | Clones `gh-pages`, or starts it on the first run. `--existing-only` for cleanup. |
| `gh-pages-push.sh` | Publishes the tree as one parentless commit, force-pushed: no history, so the branch doesn't grow with every build. Publishing jobs share one concurrency group. |
| `pr-comment.sh` | Creates or updates the single preview-link comment on a PR. |
| `lib.js` | The shared logic, tested in `test/`. |

## Workflow
1. **build** (read-only token): asset guard on the repo, `build.js`, asset guard on the site, then upload it as a one-day artifact.
2. **deploy** (write token): place the site in `gh-pages`, asset guard on the whole branch tree, push, then comment the link.
3. **cleanup** (on PR close, using the default branch's tools): remove `pr-<n>/` and update the comment.

The asset guard allows binaries up to 2 MiB in the site, because the browser build will include the core (`core.wasm`, about 0.9 MB). All its other rules apply unchanged.

When the browser wrapper (#7) lands, `web/` is copied as-is. If it needs a build step (for example the Wasm core), extend `build.js` and the build job. Only the build job should run build tools.

## Local use and tests
```sh
node tools/preview/build.js --out /tmp/site --slot pr-1 --sha "$(git rev-parse HEAD)"
node --test tools/preview
```
The tests run the git scripts against a local bare repository (`PREVIEW_REMOTE_URL`), so they need no network or token.

## Moving to Cloudflare Pages
GitHub Pages can't set COOP/COEP headers. When the core needs threads (`SharedArrayBuffer`), replace the deploy and cleanup jobs with Cloudflare Pages, which has per-branch previews and a `_headers` file. That needs an account and an API-token secret from the owner. `build.js` and the build job stay as they are.
