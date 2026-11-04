# runner/savegen: save descriptions to memory cards

`generateCard(baseline, description)` turns a baseline savemap (0x10F4 bytes) and a save description (`harness/schema/save.schema.json`, examples in `harness/saves/`) into a 128 KiB PS1 memory card held in memory. It writes the description's values, sets FF7's checksum, wraps the savemap in a save block with a blank icon and an ASCII title, and fills in the directory entry.

- `layout.js`: offsets and card-format constants, each with its source.
- `checksum.js`: the savemap checksum (a hypothesis until Tier 2 confirms it).
- `index.js`: validation and generation.

The full offset table, sources and open hypotheses are in `notes/32-save-format.md`. Tests: `node --test runner/test/unit/savegen.test.js`, Tier 1, with a synthetic baseline.

Policy: `docs/SECURITY.md`, "Generated save boot points". Never commit a generated card. The baseline comes from the caller: a synthetic pattern in Tier 1, the disc's new-game data inside the Tier 2 sandbox.
