#!/usr/bin/env bash
# Reproducible build of the PCSX ReARMed libretro core as a Wasm static archive.
#
#   core/build.sh fetch   # network: clone pinned upstream + install pinned emsdk
#   core/build.sh build   # offline: patch, compile, write core/dist/
#   core/build.sh         # both
#
# Environment overrides:
#   CORE_SRC_DIR   where upstream sources and emsdk live (default core/.src)
#   CORE_DIST_DIR  output directory (default core/dist)
#   JOBS           parallel make jobs (default: nproc)
set -euo pipefail

CORE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=pins.env
source "$CORE_DIR/pins.env"

SRC_DIR="${CORE_SRC_DIR:-$CORE_DIR/.src}"
DIST_DIR="${CORE_DIST_DIR:-$CORE_DIR/dist}"
JOBS="${JOBS:-$(nproc 2>/dev/null || echo 2)}"
PCSX_DIR="$SRC_DIR/pcsx_rearmed"
EMSDK_DIR="$SRC_DIR/emsdk"
ARCHIVE_NAME=pcsx_rearmed_libretro_emscripten.bc

log() { printf '[core/build] %s\n' "$*" >&2; }
die() { log "error: $*"; exit 1; }

fetch() {
  mkdir -p "$SRC_DIR"

  if [ ! -d "$PCSX_DIR/.git" ]; then
    git init -q "$PCSX_DIR"
  fi
  if [ "$(git -C "$PCSX_DIR" rev-parse -q --verify HEAD 2>/dev/null)" != "$PCSX_REARMED_COMMIT" ]; then
    log "fetching pcsx_rearmed @ $PCSX_REARMED_COMMIT"
    git -C "$PCSX_DIR" fetch -q --depth 1 "$PCSX_REARMED_URL" "$PCSX_REARMED_COMMIT"
    git -C "$PCSX_DIR" checkout -q --force FETCH_HEAD
  fi
  # The libretro build needs no submodules (frontend/libpicofe is for the
  # standalone frontend only), so none are fetched.

  if [ ! -d "$EMSDK_DIR/.git" ]; then
    log "cloning emsdk"
    git clone -q "$EMSDK_URL" "$EMSDK_DIR"
  fi
  git -C "$EMSDK_DIR" fetch -q --tags origin
  local tag_commit
  tag_commit="$(git -C "$EMSDK_DIR" rev-parse "refs/tags/$EMSDK_VERSION^{commit}")"
  [ "$tag_commit" = "$EMSDK_COMMIT" ] ||
    die "emsdk tag $EMSDK_VERSION is $tag_commit, expected $EMSDK_COMMIT"
  git -C "$EMSDK_DIR" checkout -q --force "$EMSDK_COMMIT"
  log "installing emsdk $EMSDK_VERSION"
  (cd "$EMSDK_DIR" && ./emsdk install "$EMSDK_VERSION" >/dev/null && ./emsdk activate "$EMSDK_VERSION" >/dev/null)
}

build() {
  [ -d "$PCSX_DIR/.git" ] && [ -x "$EMSDK_DIR/emsdk" ] || die "sources missing; run: core/build.sh fetch"
  [ "$(git -C "$PCSX_DIR" rev-parse HEAD)" = "$PCSX_REARMED_COMMIT" ] ||
    die "pcsx_rearmed is not at $PCSX_REARMED_COMMIT; run: core/build.sh fetch"

  # shellcheck disable=SC1091
  source "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1
  local emcc_version
  emcc_version="$(emcc --version | head -n1)"
  case "$emcc_version" in
    *" $EMSDK_VERSION "*) ;;
    *) die "emcc reports '$emcc_version', expected $EMSDK_VERSION" ;;
  esac

  log "resetting upstream tree and applying patches"
  git -C "$PCSX_DIR" checkout -q --force "$PCSX_REARMED_COMMIT" -- .
  local patch
  for patch in "$CORE_DIR"/patches/*.patch; do
    [ -e "$patch" ] || continue
    log "  $(basename "$patch")"
    git -C "$PCSX_DIR" apply --whitespace=nowarn "$patch"
  done

  # Upstream embeds __DATE__/__TIME__; pin them to the commit time so the
  # archive is bit-for-bit reproducible.
  SOURCE_DATE_EPOCH="$(git -C "$PCSX_DIR" log -1 --format=%ct HEAD)"
  export SOURCE_DATE_EPOCH

  log "building (interpreter CPU, no dynarec, no threads, HLE BIOS)"
  emmake make -C "$PCSX_DIR" -f Makefile.libretro platform=emscripten clean >/dev/null 2>&1
  # Upstream's emscripten platform already sets DYNAREC= (none),
  # USE_RTHREADS=0 and USE_ASYNC_*=0; they are repeated here so the intent is
  # explicit and a future upstream default change cannot flip them silently.
  emmake make -C "$PCSX_DIR" -f Makefile.libretro platform=emscripten \
    DYNAREC= USE_RTHREADS=0 USE_ASYNC_CDROM=0 USE_ASYNC_GPU=0 USE_ASYNC_SPU=0 \
    HAVE_PHYSICAL_CDROM=0 USE_MINIZ=1 \
    -j"$JOBS" >"$SRC_DIR/build.log" 2>&1 ||
    { tail -n 40 "$SRC_DIR/build.log" >&2; die "make failed (full log: $SRC_DIR/build.log)"; }

  mkdir -p "$DIST_DIR"
  cp "$PCSX_DIR/$ARCHIVE_NAME" "$DIST_DIR/pcsx_rearmed_libretro.a"
  cp "$PCSX_DIR/COPYING" "$DIST_DIR/COPYING.pcsx_rearmed"
  local sha
  sha="$(sha256sum "$DIST_DIR/pcsx_rearmed_libretro.a" | cut -d' ' -f1)"
  cat >"$DIST_DIR/BUILD_INFO.json" <<EOF
{
  "pcsx_rearmed_url": "$PCSX_REARMED_URL",
  "pcsx_rearmed_commit": "$PCSX_REARMED_COMMIT",
  "emsdk_version": "$EMSDK_VERSION",
  "emsdk_commit": "$EMSDK_COMMIT",
  "emcc": "$emcc_version",
  "patches": [$(cd "$CORE_DIR/patches" && ls ./*.patch 2>/dev/null | sed 's#^\./##; s/.*/"&"/' | paste -sd, -)],
  "archive": "pcsx_rearmed_libretro.a",
  "archive_sha256": "$sha"
}
EOF
  log "wrote $DIST_DIR/pcsx_rearmed_libretro.a ($sha)"
}

case "${1:-all}" in
  fetch) fetch ;;
  build) build ;;
  all) fetch; build ;;
  *) die "usage: $0 [fetch|build|all]" ;;
esac
