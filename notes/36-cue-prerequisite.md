# Issue 36: cue delivery prerequisite

Issue #36 requires booting the original R2 cue/bin pair. The evaluator previously
fetched and mounted only the bin. This protected-path prerequisite must merge
before the smoke-test PR can use `/disc/disc-1.cue`.

The trusted workflow downloads `disc-1.cue` without printing or generating its
contents. The evaluator requires a regular, nonempty cue no larger than 64 KiB.
Missing or invalid files produce the existing fixed `disc-missing` error.
The sandbox mounts individual files, not their containing host directory:

- `/disc/disc-1.cue`: the original cue.
- `/disc/disc-1.bin`: its referenced image.
- `/disc/disc.bin`: a compatibility alias for the existing fixed runner command.

All three mounts are read-only. Cleanup already removes the whole staging
directory, including partial downloads. There are no changes to credentials,
network access, result validation or the command passed to existing runners.

## Validation

`TMPDIR=/workspace/scratch/933d4ac38504/tmp node --test harness/private-eval/eval/test/eval.test.js harness/private-eval/sandbox/test/sandbox.test.js`

44 passed, 17 skipped locally (Docker daemon unavailable). The existing Docker
end-to-end tests now also require both original filenames to be readable, the
bin aliases to have identical bytes, and writes to both cue and bin to fail
with EROFS. CI must run these with SANDBOX_REQUIRE=1 before merge.
No game data was downloaded or handled in this session.

## Remaining issue 36 work

- Extend scenario boot support and connect the supplied disc to the backend.
- Establish an independently sourced expected USA executable hash, comparing
  entirely within the private sandbox and returning only match/no-match.
- Establish and verify a title-screen detector; measure first arrival frame
  and unthrottled speed. A changing frame alone does not prove title arrival.
- Add synthetic disc/parser tests and the clean no-disc acceptance test.
- Run the real scenario through Tier 2 after this prerequisite merges.

This PR does not close #36 or claim a real-disc boot has passed.
