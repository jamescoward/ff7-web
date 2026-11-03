#!/usr/bin/env bash
# Link the core archive (core/build.sh) with the headless libretro frontend
# into a Node Wasm module: runner/dist/core.mjs + core.wasm.
#
#   runner/build.sh
#
# Environment overrides: CORE_SRC_DIR, CORE_DIST_DIR (as in core/build.sh),
# RUNNER_DIST_DIR (default runner/dist).
set -euo pipefail

RUNNER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$RUNNER_DIR/../core"
# shellcheck source=../core/pins.env
source "$CORE_DIR/pins.env"
SRC_DIR="${CORE_SRC_DIR:-$CORE_DIR/.src}"
CORE_DIST="${CORE_DIST_DIR:-$CORE_DIR/dist}"
OUT="${RUNNER_DIST_DIR:-$RUNNER_DIR/dist}"
ARCHIVE="$CORE_DIST/pcsx_rearmed_libretro.a"
LIBRETRO_INCLUDE="$SRC_DIR/pcsx_rearmed/deps/libretro-common/include"

log() { printf '[runner/build] %s\n' "$*" >&2; }
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
  fe_init fe_set_option fe_load_game fe_run_frame fe_reset fe_unload fe_deinit
  fe_set_pad fe_input_state
  fe_fb_data fe_fb_width fe_fb_height fe_fb_pitch fe_fb_format fe_fb_dupes
  fe_ram_ptr fe_ram_size fe_audio_frames fe_input_polls fe_fps
  malloc free
)
exports="$(printf '"_%s",' "${EXPORTS[@]}")"

mkdir -p "$OUT"
log "linking $OUT/core.mjs"
# 256 MB is the iPhone Safari heap ceiling (CLAUDE.md); the runner keeps to it
# so headless results transfer. NODEFS lets disc images be read from the host
# without copying them into the heap.
emcc -O2 -Wall -Werror -I"$LIBRETRO_INCLUDE" \
  "$RUNNER_DIR/frontend.c" "$ARCHIVE" \
  -o "$OUT/core.mjs" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=node \
  -sINITIAL_MEMORY=64MB -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=256MB \
  -sSTACK_SIZE=1MB \
  -sFORCE_FILESYSTEM=1 -lnodefs.js \
  -sEXPORTED_FUNCTIONS="[${exports%,}]" \
  -sEXPORTED_RUNTIME_METHODS='["FS","NODEFS","HEAPU8","stringToNewUTF8","UTF8ToString"]'

# Record what was linked, for provenance in every run's output.
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
cp "$CORE_DIST/COPYING.pcsx_rearmed" "$OUT/" 2>/dev/null || true
log "wrote $OUT/core.wasm ($wasm_sha)"
