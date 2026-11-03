#!/usr/bin/env bash
# Verify the built core archive (core/build.sh build must have run).
#  1. The archive defines every libretro entry point the frontend needs.
#  2. The archive links into a standalone Wasm module, and calls into the
#     core work under Node (retro_api_version, retro_get_system_info,
#     retro_init/deinit). No PS1 program is loaded: that is the runner's job.
set -euo pipefail

CORE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$CORE_DIR/pins.env"
SRC_DIR="${CORE_SRC_DIR:-$CORE_DIR/.src}"
DIST_DIR="${CORE_DIST_DIR:-$CORE_DIR/dist}"
ARCHIVE="$DIST_DIR/pcsx_rearmed_libretro.a"
# shellcheck disable=SC1091
source "$SRC_DIR/emsdk/emsdk_env.sh" >/dev/null 2>&1

[ -f "$ARCHIVE" ] || { echo "missing $ARCHIVE; run core/build.sh" >&2; exit 1; }

REQUIRED=(
  retro_api_version retro_init retro_deinit
  retro_get_system_info retro_get_system_av_info
  retro_set_environment retro_set_video_refresh retro_set_audio_sample
  retro_set_audio_sample_batch retro_set_input_poll retro_set_input_state
  retro_set_controller_port_device
  retro_load_game retro_unload_game retro_run retro_reset
  retro_serialize_size retro_serialize retro_unserialize
  retro_get_memory_data retro_get_memory_size
)

NM="$(dirname "$(command -v emcc)")/../bin/llvm-nm"
[ -x "$NM" ] || NM="$EMSDK/upstream/bin/llvm-nm"
defined="$("$NM" --defined-only "$ARCHIVE" 2>/dev/null | awk '$2 ~ /^[TtDd]$/ {print $3}' | sort -u)"

missing=0
for sym in "${REQUIRED[@]}"; do
  if grep -qx "$sym" <<<"$defined"; then
    echo "ok   $sym"
  else
    echo "MISS $sym"; missing=1
  fi
done
[ "$missing" = 0 ] || { echo "FAIL: missing libretro symbols" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
exports="$(printf '"_%s",' "${REQUIRED[@]}")"
emcc "$ARCHIVE" -O2 -o "$work/core.mjs" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=node \
  -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=256MB \
  -sEXPORTED_FUNCTIONS="[${exports}\"_malloc\",\"_free\"]" \
  -sEXPORTED_RUNTIME_METHODS='["UTF8ToString","HEAPU32","addFunction"]' \
  -sALLOW_TABLE_GROWTH=1

node --input-type=module - "$work/core.mjs" <<'EOF'
const [, modPath] = process.argv.slice(1);
const { default: init } = await import(modPath);
const m = await init();
const fail = (msg) => { console.error('FAIL: ' + msg); process.exit(1); };

const api = m._retro_api_version();
if (api !== 1) fail(`retro_api_version() = ${api}, expected 1`);
console.log(`ok   retro_api_version() = ${api}`);

// struct retro_system_info { const char *library_name, *library_version,
//   *valid_extensions; bool need_fullpath, block_extract; } (wasm32: 4-byte ptrs)
const info = m._malloc(32);
m._retro_get_system_info(info);
const u32 = (p) => m.HEAPU32[p >> 2];
const name = m.UTF8ToString(u32(info));
const exts = m.UTF8ToString(u32(info + 8));
if (!/pcsx/i.test(name)) fail(`library_name = ${JSON.stringify(name)}`);
for (const e of ['bin', 'cue', 'exe']) {
  if (!exts.split('|').includes(e)) fail(`valid_extensions lacks ${e}: ${exts}`);
}
console.log(`ok   library_name = ${name}`);
console.log(`ok   valid_extensions = ${exts}`);

// retro_init requires an environment callback; answer "unsupported" to all.
const envCb = m.addFunction(() => 0, 'iii');
m._retro_set_environment(envCb);
m._retro_init();
m._retro_deinit();
console.log('ok   retro_init / retro_deinit');
EOF
echo "core check passed"
