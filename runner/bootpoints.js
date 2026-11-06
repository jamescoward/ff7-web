// Boot points for scenario format 2 (#37): named places a scenario starts
// from. Original project code, GPL-2.0-or-later.
//
// A boot point is a fixed input script played from power-on to a fixed
// frame T. The Tier 2 runner (runner/tier2.js) boots each boot point that
// its scenarios name once per run, keeps one in-memory snapshot there
// (backend.saveState), and restores it for every scenario. A scenario run
// on its own (runner/scenario.js) boots the boot point itself.
//
// Each entry:
//   source  what is booted: { disc: N } or { fixture: NAME }. A scenario's
//           boot must name the same source.
//   script  format 2 script steps (harness/schema/scenario.schema.json,
//           $defs/scriptStep), played from power-on. Frames are counted
//           from 1; T is their total. Waits here are { frames } only: a
//           boot point must end on a fixed frame.
//   verify  optional check at frame T that the boot point was reached:
//           { addr, len, equals: HEX } or { addr, len, equalsDiscFile:
//           { path, offset } } (the bytes are compared inside the run and
//           never reported). If it fails, scenarios from this boot point
//           fail at boot_stage 5.
//   card    optional "blank": a blank, formatted memory card in slot 1 from
//           power-on (runner/synth/blank-card.js, original code; held in
//           core memory, never a file). Snapshots don't hold the card, so
//           every scenario from this boot point, or from a chain rooted
//           in it, gets the same blank card (#74).
//   note    provenance.
//
// "power-on" is reserved: no boot point, the scenario starts at power-on.
//
// Chains of named snapshots (#74) start from a boot point and continue
// through scenarios' scripts; see runner/format2.js.

/** Steps that hold `buttons` for `hold` frames every `every` frames, from frame `first`, `count` times. */
function repeatPress({ first, every, hold, count, buttons }) {
  const steps = [{ wait: { frames: first - 1 } }];
  for (let i = 0; i < count; i++) {
    if (i > 0) steps.push({ wait: { frames: every - hold } });
    steps.push({ buttons, frames: hold });
  }
  return steps;
}

/** Total frames of a boot point script (waits must be { frames }). */
export function scriptFrames(script) {
  return script.reduce((n, s) => n + (s.wait ? s.wait.frames : s.frames ?? 1), 0);
}

// FF7 disc 1 at the title screen. The press script is #36's
// (harness/scenarios/disc-boot-smoke.json): Start for 4 frames every 120
// frames from frame 300, which skips the pre-title logos and intro. #36
// measured the title module's code resident from frame 1231 with that
// script (Tier 2, 2026-11-05, notes/36-disc-boot.md). Here the presses stop
// after the one at frames 1140-1143, the last before 1231, so frames 1-1250
// get exactly the input of #36's run up to that point, and T is 1250.
const TITLE_SCRIPT = [
  ...repeatPress({ first: 300, every: 120, hold: 4, count: 8, buttons: ['start'] }),
  { wait: { frames: 1250 - 1143 } },
];

export const BOOT_POINTS = Object.freeze({
  title: Object.freeze({
    source: { disc: 1 },
    script: TITLE_SCRIPT,
    // #36's title detector: the first 4 KiB of the title module's code in
    // the SAVEMENU overlay (MENU/SAVEMENU.MNU file offset 0x2B58, linked at
    // 0x801D2B58), as the disc holds them. Addresses and offsets from
    // Xeeynamo/ff7-decomp config/us.yaml and src/main at 9411173, reference
    // only; demonstrated on Tier 2 by #36. Not a new address claim.
    verify: { addr: 0x801d2b58, len: 4096, equalsDiscFile: { path: 'MENU/SAVEMENU.MNU', offset: 0x2b58 } },
    note: 'FF7 disc 1, title screen; #36 press script, T = 1250',
  }),
  // The same, with a blank formatted memory card in slot 1, as the browser
  // build always has (web/js/backend.js sets pcsx_rearmed_memcard1). #74
  // found that with no card the picture stays still after T and ignores
  // Circle; this tests whether a card changes that (hypothesis). Same
  // script, T and verify as "title".
  'title-card': Object.freeze({
    source: { disc: 1 },
    card: 'blank',
    script: TITLE_SCRIPT,
    verify: { addr: 0x801d2b58, len: 4096, equalsDiscFile: { path: 'MENU/SAVEMENU.MNU', offset: 0x2b58 } },
    note: 'FF7 disc 1, title screen with a blank memory card; #36 press script, T = 1250',
  }),
  // Homebrew boot point for Tier 1 tests and the format 2 example: pad-echo
  // after 30 frames, having seen Cross held on frames 10-20.
  'pad-echo-ready': Object.freeze({
    source: { fixture: 'pad-echo' },
    script: [{ wait: { frames: 9 } }, { buttons: ['cross'], frames: 11 }, { wait: { frames: 10 } }],
    // "PADE": the program has started (harness/fixtures/pad-echo.js MARKER).
    verify: { addr: 0x800f0004, len: 4, equals: '50414445' },
    note: 'pad-echo homebrew, frame 30 (Tier 1)',
  }),
  // The same with a blank card in slot 1, for Tier 1 tests of the card path.
  'pad-echo-ready-card': Object.freeze({
    source: { fixture: 'pad-echo' },
    card: 'blank',
    script: [{ wait: { frames: 9 } }, { buttons: ['cross'], frames: 11 }, { wait: { frames: 10 } }],
    verify: { addr: 0x800f0004, len: 4, equals: '50414445' },
    note: 'pad-echo homebrew with a blank memory card, frame 30 (Tier 1)',
  }),
});

export const POWER_ON = 'power-on';

// A boot from a generated save (#38: boot { disc: 1, save, slot: 1 }) starts
// from this boot point unless it names another with a card: the title
// screen with a memory card in slot 1, whose blank card is replaced by the
// generated one when the snapshot is restored.
export const SAVE_BOOT_POINT = 'title-card';
