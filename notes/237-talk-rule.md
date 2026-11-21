# #237: confirm the field talk rule at the mds7st1 window-1 talk

Follow-up to #112 (talk rule stated from the reference, entries `fieldTalkOff`, `fieldTalkRange` and `fieldZ` left as hypotheses) and #224 (save-boot-19a: in mds7st1, hold Down 300 frames, press Circle, and window 1 opens a plain message).

## What is known before attempt 1
From `notes/168-choice-cursor.md`, on the same save and walk:
- g_FieldModelCount reads 10 (models 0-9).
- Models 1-3 have TalkOff set; models 4-6 have TalkOff clear but are out of range (near sign 1) after the down walk.
- Models 7-9 were not watched.

So if the talk comes from a model, under the stated rule it is 7, 8 or 9.

## Attempt 1 plan (one push, 3 scenarios: 98 → 101 of 128)
All three use `harness/saves/disc1-mds7st1.json` and `runner/test/unit/talk-rule-scenarios.js`.
- `save-boot-21a-talk-rule-unwatched`: the down walk, stopping before Circle. For models 7-9 it reports the `near` sign against TalkRange_k + SolidRange_0 (n7..n9), the raw TalkOff values (off7..off9) and the player model (pm). It fails by design where a model is not within range.
- `save-boot-21b-talk-rule-height`: the same state. It reports the height part (h7..h9) through the `near` check, with the z coordinates at shift 19, both y coordinates at the same location, and the range set to g_IsFieldLoading (asserted to be 2). A −1 implies |dz| < 256 field units (`talk-rule.test.js` checks that this is sufficient). It also reports the near sign for models 1-3 and a rerun match.
- `save-boot-21c-talk-rule-control`: Down for 150 frames, then Circle and a 60-frame wait. It expects windows 0-3 to read 0, reports n7..n9 (expected outside) and a rerun match.

What decides attempt 2:
- **Exactly one k in 7-9 with n −1, off 0 and h −1, and the control passes.** The rule's distance, TalkOff and height parts are borne out. Attempt 2 turns 21a/21b into passing acceptance scenarios for that k (and drops the others), repeats the run, and confirms the entries.
- **No model within range.** The talk is not a model's (a field line, or a model index ≥ 10 is impossible with cnt 10). Record that and close with the entries still hypotheses, as the contract says.
- **Several within range.** Facing decides. Attempt 2 adds the player's Dir and the direction to each candidate.
