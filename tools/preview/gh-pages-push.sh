#!/usr/bin/env bash
# Publish DIR's working tree as the new gh-pages: a single parentless
# commit, force-pushed. Only the latest previews matter, and keeping no
# history stops the branch growing with every build. Publishing jobs share
# one concurrency group, so nothing else writes the branch meanwhile.
#
#   tools/preview/gh-pages-push.sh DIR MESSAGE
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/git-auth.sh"

dir="$1"
msg="$2"
cd "$dir"
export GIT_AUTHOR_NAME="github-actions[bot]" GIT_COMMITTER_NAME="github-actions[bot]"
export GIT_AUTHOR_EMAIL="41898282+github-actions[bot]@users.noreply.github.com"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"

git add -A
tree="$(git write-tree)"
if git rev-parse -q --verify HEAD >/dev/null && [ "$(git rev-parse 'HEAD^{tree}')" = "$tree" ]; then
  echo "gh-pages unchanged"
  exit 0
fi
commit="$(git commit-tree "$tree" -m "$msg")"
git_auth push -q --force origin "$commit:refs/heads/gh-pages"
echo "gh-pages updated: $msg"
