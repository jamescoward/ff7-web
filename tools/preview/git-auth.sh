# Sourced by the gh-pages scripts. Sets REMOTE and defines git_auth, which
# runs git with $GH_TOKEN as an HTTP auth header when a token is set. The
# token never appears in a URL, on disk or in logs.
REMOTE="${PREVIEW_REMOTE_URL:-https://github.com/${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set}.git}"
if [ -n "${GH_TOKEN:-}" ]; then
  _basic="$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)"
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::add-mask::$_basic"
  git_auth() { git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $_basic" "$@"; }
else
  git_auth() { git "$@"; }
fi
