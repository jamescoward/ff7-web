# #260: item, weapon, armor and materia names, read at runtime from the owner's disc

Part 1 (game-state lane): facts, a pure decoder in `semantic/game-text.js`, Tier 1 tests on author-made fixtures, then a Tier 2 count check. Part 2 (UI lane, Labs flag `game-names`) builds the tables on the device.

**No name, decoded string or disc byte goes in the repo, issues, PRs, logs or scenario results** (`docs/SECURITY.md`, issue #260). This note holds the layout and the encoding only.

## Sources
- **wiki:** ff7-mods/ff7-flat-wiki @ `638936503b1ca08243d73846dde4299419bcf542`, the same pin that `runner/savegen/baseline.js` cites as `6389365` (HEAD on 2026-11-24).
  - `docs/FF7/Kernel/Kernel.bin.md`
  - `docs/FF7/FF_Text.md` (`docs/FF7/Text_encoding.md` is a near copy)
- **decomp:** Xeeynamo/ff7-decomp @ `33ce78c94021b2e1705785347da58a2ca30ba705`. Reference only, for layout: no code copied, and its maintainers forbid LLM-written contributions there.
  - `src/main/14C70.c`: `SysGetKernTextPtr`, `SysAppendString` and the `kernel_maps` item offsets.
  - `src/main/main_private.h`: `KernelTextBlockID`.

## Facts
### Where the names are
- `INIT/KERNEL.BIN` is a BIN-GZIP archive of 27 gzip sections, each with a 6-byte header. `runner/savegen/baseline.js` `parseBinGzip` already splits it (#38).
- The wiki numbers the sections 1–27; 0-based, they are:
  - 0–8: data tables;
  - 9–16: descriptions;
  - 17–24: names (command, magic, item, weapon, armor, accessory, materia, key item);
  - 25: battle text;
  - 26: summon attack names.
- **Names: item 19, weapon 20, armor 21, accessory 22, materia 23** (`KERNEL_NAME_SECTIONS`). The working hypothesis in the issue (KERNEL.BIN text sections) is confirmed from the source.
- The decomp's block order (`KernelTextBlockID`: descriptions 0x00–0x07, names 0x08–0x0F, battle 0x10, summons 0x11) is the same order, counted from section 9.
- Item IDs: 0–127 items, 128–255 weapons, 256–287 armor, 288–319 accessories. The decomp's `kernel_maps.itemOffsets` gives the same bounds as `semantic/inventory.js` `ITEM_KINDS`.

### Text section layout
- Entry k's offset is a u16 at section + 2k, relative to the section's start; the string is at section + offset (decomp `SysGetKernTextPtr`). Little-endian, since the PS1 is little-endian.
- A string ends with 0xFF (wiki {END}; decomp `SysAppendString` copies until 0xFF).
- **The entry count is not stated** by either source. The decoder takes it as first offset / 2, on the assumption that the table runs up to the first string. This is a hypothesis; the Tier 2 check tests it, because every offset must land past the table and inside the section.

### The encoding (wiki "FF_Text")
- 0x00–0x5E: ASCII − 0x20 (0x00 is a space).
- 0x60–0xD3: accented Latin letters and symbols, in the wiki's table, which the decoder holds verbatim.
  - 0xAA is {NOTHING}, and decodes to the empty string.
  - 0xD0 is a second space.
- Specials:
  - 0xE1 tab, 0xE2 ", ", 0xE3 '."', 0xE4 '..."', 0xE7 end of line;
  - 0xE0, 0xE8 and 0xE9 are window controls (choice, new screen); the decoder refuses them;
  - 0xEA–0xF5: character-name and party variables, decoded as `{name:N}` (the game fills them in at runtime);
  - 0xF6–0xF9: button glyphs;
  - 0xFE {FUNC}: an opcode with an argument. Only FE D2–DB (colours) are documented; they decode to nothing, and any other argument is refused;
  - 0xFF: end of the string.
- 0x5F, 0xD4–0xDF, 0xE5, 0xE6 and 0xFA–0xFD have no character, so the decoder refuses them. The wiki says D4–DF "produce odd graphical errors".
- **F9 back-reference**, in sections 10–17 and 26 (1-based) only, that is the descriptions and the battle text:
  - the next byte is YYXXXXXX;
  - it copies YY × 2 + 4 raw bytes, starting XXXXXX + 1 bytes before the F9;
  - positions are absolute raw bytes;
  - a copied FF ends the string.

  Name sections are not among them, so `nameTable` reads F9 there as a glyph unless `backrefs` is set. The Tier 2 check reports how many entries fail to decode, so an F9 used otherwise would show up there.
- Battle text (section 25) also uses EA–F0 with two argument bytes, and F8 as a box colour (wiki). That is not needed for names, so the decoder does not handle it.

## Part 1 plan
1. **Done in the first push:** `semantic/game-text.js` with `decodeFf7Text`, `nameTable`, `nameFor`, `KERNEL_NAME_SECTIONS` and `NAME_KIND_COUNTS`, synced to `web/js/semantic/`. Tests: `runner/test/unit/semantic-game-text.test.js`, on author-made strings only.
2. **Second push: the Tier 2 count check (format 2 `kernelNames`).**
   - `runner/savegen/baseline.js` gains `unpackSection` (the gunzip path `initData` already had, moved rather than copied), `kernelSection(kernel, i)` and `kernelFromDisc(discFile)`. `initData` and `baselineFromDisc` now use them, with the same errors as before.
   - `runner/kernel-names.js`: `nameCounts(kernel, kind)` gives `{ built, count, empty, failed }`, numbers only. `namesHold` passes when the table builds, no entry fails, and count is between min and max (defaults: 1 and `NAME_KIND_COUNTS[kind]`).
   - **The upper bound is the kind's ID space, not an expected count.** Count ≥ ID count, as first planned, is not a documented fact: item IDs run 0–127, but nothing says all 128 have a name entry. The reported `<kind>_n` gives the real count, and a tighter range can follow from it.
   - Format 2: `{ "kernelNames": { "kind", "min"?, "max"?, "report": { "built"?, "count"?, "empty"?, "failed"? } }, "metric" }` (schema entry added). The scenario must name `boot.disc`. The check reads INIT/KERNEL.BIN from the scenario's own disc, outside the emulated run, so its result doesn't depend on the input.
   - Scenarios `kernel-names-1-item-weapon`, `-2-armor-accessory` and `-3-materia` run one frame from the title boot point, for the Tier 2 time budget (#269). Each kind reports `_ok`, `_n`, `_empty` and `_bad`.
   - Tier 1: `runner/test/unit/kernel-names.test.js`, on a synthetic archive of author-made strings.
3. `parseBinGzip` stays in `runner/savegen/baseline.js` for now. Part 2 needs it in the browser, so move its pure part into `semantic/` then (the issue's "move, don't copy").
