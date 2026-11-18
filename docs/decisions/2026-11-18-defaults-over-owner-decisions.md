# Decision: agents pick defaults instead of waiting for the owner

- **Date:** 2026-11-18
- **Decided by:** the owner, in a chat session with the second implementer. The words, paraphrased closely: "I'm really happy to burn extra tokens if it avoids a decision, as I won't be checking in much. I'm happy for you to pick sensible defaults and leave a decision record." And: "I'm not as bothered about landscape mode, so I'm happy for you to make decisions on that."
- **Applies:** from now on, and during Trip mode in particular. The owner can narrow or withdraw it at any time.

## What agents may now decide themselves
When an issue would otherwise be parked with `needs-owner` for a **reversible choice**, the agent picks a sensible default, records it (below), and carries on. This covers:

1. **UI and layout choices**, especially in **landscape**. Portrait is the primary layout. Landscape choices are the agent's to make, as long as the classic pad keeps working and every Tier 1 iPhone-profile check passes.
2. **Feature design behind an off-by-default Labs flag**: labels, placement, which of several reasonable options to build. The Tier 3 check on the owner's return is the review.
3. **Fresh attempt budgets.** When an issue has stopped at 3 of 3 failed attempts and reported its blockers (as `CLAUDE.md` requires), a later run may grant it **one** fresh budget of 3 attempts. The new attempts must take a materially different approach from the reported ones, and the run records the decision. A second fresh budget for the same issue still needs the owner. Spending tokens is preferred to parking an issue.
4. **Planning and allocation**: splitting issues, ordering work, choosing which existing Tier 2 scenarios to extend, and filing follow-ups as `status:ready` instead of `needs-owner` when the only open question is a choice of this kind.

## What still needs the owner
- Protected paths (`.github/`, `CLAUDE.md`, `docs/SECURITY.md`, `harness/private-eval/`, `harness/baselines/`): a separate `needs-owner` PR, as before.
- The trust boundary and security: what runs in the sandbox, what leaves it, the leakage bound (for example #147).
- Licences and new third-party dependencies with licence questions.
- Anything that contradicts `CLAUDE.md`. That includes weakening tests, editing baselines, and writing game memory without an issue allowing it.
- Accounts, money and external services.

When unsure whether a choice is reversible, treat it as needing the owner.

## How a default is recorded
1. A comment on the issue, starting with **`Decision (agent default, 2026-11-18 delegation):`**. It gives:
   - the options considered;
   - the choice and why;
   - how to reverse it (for example, the flag, file or commit to change).
2. A line in the next weekly digest on #123, under "Decisions taken by default", linking that comment.

Recording on the issue (not in a shared file) avoids merge conflicts between the two implementers.
