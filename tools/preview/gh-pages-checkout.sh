#!/usr/bin/env bash
# Check out the gh-pages branch into DIR, or start an empty one if it does
# not exist yet.
#
#   tools/preview/gh-pages-checkout.sh DIR [--existing-only]
#
# --existing-only: if gh-pages doesn't exist, create nothing and report
# exists=false. Writes exists=true|false to $GITHUB_OUTPUT when set.
# Auth: $GH_TOKEN as an HTTP header (never in the URL or on disk).
# $PREVIEW_REMOTE_URL overrides the remote (tests use a local repo).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/git-auth.sh"

dir="$1"
mode="${2:-}"
out="${GITHUB_OUTPUT:-/dev/null}"

set +e
git_auth ls-remote --exit-code --heads "$REMOTE" gh-pages >/dev/null
code=$?
set -e
if [ "$code" -eq 0 ]; then
  git_auth clone -q --depth 1 --branch gh-pages "$REMOTE" "$dir"
  echo "exists=true" >>"$out"
elif [ "$code" -eq 2 ]; then
  echo "exists=false" >>"$out"
  if [ "$mode" = --existing-only ]; then
    echo "gh-pages does not exist; nothing to do"
    exit 0
  fi
  git init -q -b gh-pages "$dir"
  git -C "$dir" remote add origin "$REMOTE"
  echo "gh-pages does not exist yet; starting it"
else
  echo "error: could not query $REMOTE (git exit $code)" >&2
  exit 1
fi
