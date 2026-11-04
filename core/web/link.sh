#!/usr/bin/env bash
# Link the core archive (core/build.sh) with the browser libretro frontend
# into a Web Worker module: web/core/core.mjs + core.wasm.
#
#   core/web/link.sh
#
# The output lives in web/core/ (not committed) so that web/ is the whole
# static site: tools/preview/build.js copies it as-is. This script sits under
# core/ rather than web/ because the preview allows only site file types.
#
# Environment overrides: CORE_SRC_DIR, CORE_DIST_DIR (as in core/build.sh),
# WEB_CORE_DIR (default web/core).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$HERE/.."
REPO="$CORE_DIR/.."
# shellcheck source=../pins.env
source "$CORE_DIR/pins.env"
SRC_DIR="${CORE_SRC_DIR:-$CORE_DIR/.src}"
CORE_DIST="${CORE_DIST_DIR:-$CORE_DIR/dist}"
OUT="${WEB_CORE_DIR:-$REPO/web/core}"
ARCHIVE="$CORE_DIST/pcsx_rearmed_libretro.a"
LIBRETRO_INCLUDE="$SRC_DIR/pcsx_rearmed/deps/libretro-common/include"

log() { printf '[core/web/link] %s\n' "$*" >&2; }
die() { log "error: $*"; exit 1; }

[ -f "$ARCHIVE" ] || die "missing $ARCHIVE; run core/build.sh"
[ -f "$LIBRETRO_INCLUDE/libretro.h" ] || die "missing libretro.h; run core/build.sh fetch"
# shellcheck disable=SC1091
source "$SRC_DIR/emsdk/emsdk_env.sh" >/dev/null 2>&1
case "$(emcc --version | head -n1)" in
  *" $EMSDK_VERSION "*) ;;
  *) die "emcc is not the pinned $EMSDK_VERSION" ;;
esac

EXPORTS=(
  fe_init fe_set_option fe_load_game fe_run_frame fe_reset fe_unload
  fe_set_pad
  fe_fb_data fe_fb_width fe_fb_height fe_fb_pitch fe_fb_format
  fe_audio_ptr fe_audio_count fe_audio_clear fe_audio_dropped
  fe_ram_ptr fe_ram_size fe_card_ptr fe_card_size
  fe_fps fe_sample_rate
  malloc free
)
exports="$(printf '"_%s",' "${EXPORTS[@]}")"

mkdir -p "$OUT"
log "linking $OUT/core.mjs"
# - ENVIRONMENT=worker: the core runs in a dedicated module Worker, so a
#   long frame never blocks touch input or drawing.
# - WORKERFS reads the chosen File objects in place (FileReaderSync on
#   slices): a 700 MB disc image is never copied into the heap.
# - 256 MB is the iPhone Safari heap ceiling (CLAUDE.md), as in the runner.
emcc -O2 -Wall -Werror -I"$LIBRETRO_INCLUDE" \
  "$HERE/frontend.c" "$ARCHIVE" \
  -o "$OUT/core.mjs" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=worker \
  -sINITIAL_MEMORY=64MB -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=256MB \
  -sSTACK_SIZE=1MB \
  -sFORCE_FILESYSTEM=1 -lworkerfs.js \
  -sEXPORTED_FUNCTIONS="[${exports%,}]" \
  -sEXPORTED_RUNTIME_METHODS='["FS","WORKERFS","HEAPU8","HEAP16","stringToNewUTF8"]'

core_sha="$(sha256sum "$ARCHIVE" | cut -d' ' -f1)"
wasm_sha="$(sha256sum "$OUT/core.wasm" | cut -d' ' -f1)"
cat >"$OUT/BUILD_INFO.json" <<EOF
{
  "pcsx_rearmed_commit": "$PCSX_REARMED_COMMIT",
  "emsdk_version": "$EMSDK_VERSION",
  "core_archive_sha256": "$core_sha",
  "wasm_sha256": "$wasm_sha"
}
EOF
# The GPL text travels with the binary (preview sites allow .txt).
cp "$CORE_DIST/COPYING.pcsx_rearmed" "$OUT/COPYING.pcsx_rearmed.txt"
log "wrote $OUT/core.wasm ($wasm_sha, $(stat -c %s "$OUT/core.wasm") bytes)"
