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

## Results

### Attempt 1 (`76c1aaa`, tier2: 97 pass, 2 fail; every earlier scenario passed unchanged)
| scenario | metrics |
|---|---|
| 21a-talk-rule-unwatched (fail by design) | n7 **−1**, n8 1, n9 1, off7 0, off8 0, off9 0, pm 0, load_done 392 |
| 21b-talk-rule-height (fail by design) | h7 0, h8 0, h9 0, n1 1, n2 1, n3 1, match 1, load_done 392 |
| 21c-talk-rule-control (pass) | w1_closed 1, w0 0, w3 0, n7 1, n8 1, n9 1, match 1, load_done 392 |

Reading:
- **Model 7 is the only model in range** after the down walk: its ground distance is below its TalkRange plus the player's SolidRange. Models 8 and 9 are out of range, and so are 1–3 (which have TalkOff set, per #168) and 4–6 (#168). Models 7, 8 and 9 all read TalkOff 0. The player is model 0.
- So the stated rule (distance and TalkOff) names exactly one candidate on the route where Circle opens a message (19a). On the control route (Down 150 frames), no model is in range, and Circle opens no window.
- **Height: inconclusive.** h7..h9 are 0, so floor(z >> 19) for the player and for each model are exactly 2 apart. That makes |dz| between 128 and 384 field units, which straddles the 256 limit. All three being 0 suggests models 7–9 share a height band and the player sits in another one.

## Attempt 2 plan (`talk-rule-scenarios.js`, 3 scenarios)
- `save-boot-21a-talk-rule-talker` becomes the acceptance scenario for model 7. It checks: n7 within, off7 0, the height within 256 (shift 18, range 4, so floor values less than 4 apart in 64-unit steps), n8 and n9 outside, the player is model 0, and a rerun match. It passes only if the height part also holds.
- `save-boot-21b-talk-rule-height` (diagnostic) brackets |dz| with bounds of 32, 64, 128, 256 and 512 field units, and gives the sign of z0 − z7.
- `save-boot-21c-talk-rule-control`: unchanged.

What decides attempt 3:
- **21a passes and 21b brackets |dz| below 256.** The rule holds at the one reachable talk. The second run then confirms `fieldTalkRange` and `fieldTalkOff` (value 0), and `fieldZ` as far as this height difference goes. `nearby()` can then report `confirmed: true`.
- **|dz| ≥ 256.** Either the game's height limit is not 256 field units in these units (for example raw >> 12 is not the right scale for z), or model 7 is not the talker. Attempt 3 then checks facing, or a walk that brings model 8 or 9 into range.

### Attempt 2 (`3aed54f`, tier2: 97 pass, 2 fail; every other scenario passed unchanged)
| scenario | metrics |
|---|---|
| 21a-talk-rule-talker (fail) | n7 −1, off7_ok 1, **h7 0**, n8 1, n9 1, pm_ok 1, match 1, load_done 392 |
| 21b-talk-rule-height (fail by design) | zs 1, b32 1, b64 1, b128 1, b256 0, b512 −1, load_done 392 |
| 21c-talk-rule-control (pass) | unchanged from attempt 1 |

Reading:
- Every part of the rule holds for model 7 except the height bound. The distance, TalkOff, models 8 and 9 out of range, the player model and the rerun are the same as in attempt 1, which makes them deterministic over two runs.
- The player is higher than model 7 (zs 1). b256 0 means floor(z >> 18) values exactly 4 apart, so 192 < |dz| < 320. b128 1 and b512 −1 agree. **|dz| still straddles 256.**
- The bounds the near check could express were all sums of memory values (2 per `loading`). None of them lands on 256 at field-unit resolution, so the 256 question cannot be settled without a constant.

## Attempt 3 plan (the last)
- **Format 2: `near.plus`**, a constant (0–65535) added to the range; `range` may then be empty. This is a missing capability of the check kind (a threshold against a constant), which the contract allows with Tier 1 tests (`format2.test.js`). Only the sign still leaves the sandbox.
- `21a` asserts |dz| < 256 exactly in floored field units (shift 12, plus 256).
- `21b` brackets |dz| at 200, 224, 240, 272, 288 and 304 field units.
- `21c` is unchanged.

Outcome either way:
- **h7 −1:** the rule holds at the reachable talk, and attempt 3 is the acceptance. One more push repeats it for determinism, the entries are confirmed, and the PR merges.
- **h7 not −1:** |dz| ≥ 256 although Circle opens a message there. Then the 256 limit, the >> 12 scale for PosZ, or model 7 being the talker is wrong. The budget is used up: report on #237, keep `fieldZ` as a hypothesis, and confirm only what was shown (TalkRange and TalkOff as read, with no talk claim).
