#!/usr/bin/env bash
# Create or update the single preview comment on a PR. The comment is
# found by its first line, <!-- ff7-web-preview -->, and its author.
#
#   tools/preview/pr-comment.sh PR BODY [--update-only]
#
# Needs gh, GH_TOKEN and GITHUB_REPOSITORY.
set -euo pipefail
pr="$1"
body="$2"
mode="${3:-}"
marker='<!-- ff7-web-preview -->'
case "$body" in "$marker"*) ;; *) echo "error: body must start with $marker" >&2; exit 2 ;; esac

id="$(gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$pr/comments" \
  --jq ".[] | select(.user.login == \"github-actions[bot]\" and (.body | startswith(\"$marker\"))) | .id" | tail -n 1)"
if [ -n "$id" ]; then
  gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$id" -f body="$body" >/dev/null
  echo "updated preview comment $id"
elif [ "$mode" != --update-only ]; then
  gh api -X POST "repos/$GITHUB_REPOSITORY/issues/$pr/comments" -f body="$body" >/dev/null
  echo "posted preview comment"
fi
