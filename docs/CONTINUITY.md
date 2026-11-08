# Continuity: picking up where the last agent left off

Agents on this project can stop at any moment: subscription quota runs out, a session times out, or a container is reclaimed. Assume every session will be cut off mid-task. **Nothing important may live only in a chat transcript or a container.** A fresh agent with no context must be able to resume from the repository and GitHub alone, within a few minutes.

## Where state lives

| What | Where | Updated |
|---|---|---|
| Direction, milestones, decisions | `docs/PHASE0.md`, `docs/ARCHITECTURE_SURVEY.md`, `docs/decisions/` | When a decision is made |
| Project snapshot: current milestone, what's next, blockers | `STATUS.md` (root) | When an issue closes or a blocker appears |
| Work queue | GitHub issues, labelled by status | Continuously |
| In-flight work | The issue's branch, plus its PR's **Handoff** section | At every checkpoint |
| Research notes, findings, dead ends | `notes/` in the repo, committed on the working branch | As they're produced |

Never rely on the scratchpad, `/tmp`, local-only branches, or uncommitted files. Containers are ephemeral.

## Issue labels
- `status:ready`: a task contract is complete; anyone may start it.
- `status:in-progress`: claimed. The claim is the linked PR, or a claim comment if there is no PR yet.
- `status:blocked`: the reason and what would unblock it are in the latest comment.
- `needs-owner`: needs the owner (protected paths, account setup).
- `needs-owner-device`: waiting for the owner's iPhone check (Tier 3, `docs/AUTOMATION.md`). Don't wait on it; take other work.
- `model:sonnet`: the implementation goes to a Sonnet subagent (see Model delegation). Only the owner adds or removes it, or an agent when the owner asks.

## Session-start protocol (every new agent, in order)
1. Read `CLAUDE.md`, `STATUS.md` and this file.
2. **Finish in-flight work before starting anything new.** List open PRs. For `needs-owner-device` PRs, check whether the owner has replied: act on the result (fix, or remove the label and merge), and otherwise leave them alone. For each other PR not labelled `needs-owner`, read its Handoff section, check out the branch and continue from **Next step**. If its Handoff says it's complete and checks are green, merge it (see Merge rules).
3. Otherwise, look for `status:in-progress` issues with no push or comment for more than 6 hours. These are abandoned claims: take them over, comment that you're resuming, and continue on the existing branch. Don't start again from scratch.
4. Otherwise, take the oldest `status:ready` issue in the current milestone. Comment a claim, relabel it `status:in-progress`, and create the branch `issue-<n>-<slug>`. If it's labelled `model:sonnet`, follow Model delegation below.
5. If there are no ready issues, act as planner: break the next milestone step into issues using the task template, then take the first one.

## Checkpointing (while working)
Checkpoint whenever a meaningful step is done, and at least every 30–45 minutes of work:

1. **Commit and push** to the issue branch, even if the work is incomplete. Commit messages say what changed and why.
2. **Open the PR at the first push** (title prefix `[WIP]`) and link the issue (`Closes #n`).
3. **Update the PR's Handoff section**, rewriting it rather than appending:
   - **Done:** what works, with evidence (commands and results).
   - **Next step:** the single next concrete action, specific enough to start immediately.
   - **Open questions and dead ends:** what was tried and why it failed, so it isn't repeated.
   - **How to run:** exact commands to build and test.
4. Put longer findings in `notes/<issue>-<topic>.md` on the branch, not in the PR body.

Keep tasks small enough that a typical one finishes in a single session. If an issue turns out bigger, split it: finish and merge a coherent slice, and file the rest as new issues.

## Finishing an issue
1. Remove `[WIP]` from the title. Complete the PR report (`CLAUDE.md`) and set the Handoff's next step to "merge".
2. Wait for the required checks. Fix failures within the attempt budget.
3. Merge (see Merge rules) and close the issue.
4. Update `STATUS.md` if the milestone picture changed: in the same PR, or as a small follow-up.

## Model delegation
The session's own model (Opus) owns every issue: it claims it, reviews the work, and merges. For issues labelled **`model:sonnet`**, it hands the implementation to a Sonnet subagent:

1. **Brief.** Start a subagent with `model: sonnet`. Give it:
   - the full issue contract (outcome, allowed paths, acceptance, attempt budget);
   - `CLAUDE.md`;
   - the branch to work on;
   - the instruction to commit and push at checkpoints, but not to open, update or merge the PR.

   It can't see this conversation, so the brief must stand on its own.
2. **Check.** When it reports back, the Opus session reads the diff and re-runs the acceptance commands itself. A subagent's "tests pass" is a claim, not evidence.
3. **Review.** Start the reviewer subagent (`.claude/agents/reviewer.md`) on Opus with fresh context (see `docs/AUTOMATION.md`). It posts its verdict as a marked PR comment. Fix its blocking findings: in the same Sonnet subagent if it's still running, otherwise yourself. Then run the review again.
4. **Report.** The PR report names the model that implemented the work. The Opus session owns the PR, the Handoff, the merge, and every claim in the report.
5. **Record.** Add a row to `notes/model-delegation.md`:
   - the issue;
   - the model;
   - attempts used;
   - the reviewer's blocking findings;
   - fixes Opus had to make;
   - the outcome.

   This record decides whether more issues get the label.

**Fall back to Opus**, and say so on the issue, when the Sonnet subagent:
- uses up the attempt budget;
- touches a path outside the contract;
- weakens or skips a test.

**Never label** issues that change the trust boundary or touch protected paths: the sandbox, the validator, Tier 2 workflows, and `docs/SECURITY.md`.

Subagents use the same subscription quota as the session. Delegation saves cost per task, but it adds no capacity. Work on one delegated issue at a time, unless the owner has allowed extra branches and worktrees for parallel work.

## Risk classes
Every PR is one of two classes. The class is decided by the paths it touches, and is stated in the PR body's first line (`Class: full` or `Class: light`).

- **Full:** anything that touches the trust boundary or game data, or changes existing tests:
  - the sandbox, the validator and the Tier 2 entry point and workflows (`harness/private-eval/`, `runner/tier2.js`, `harness/schema/`, tier 2 files in `harness/scenarios/`);
  - the emulator core build (`core/`) and the backend interface (`runner/backend.js`, `runner/frontend.c`);
  - any PR that modifies or deletes an existing test, or adds a baseline;
  - any protected path (these also need the owner, as before).
- **Light:** everything else. Examples: `web/` UI work, `notes/`, `STATUS.md`, non-protected docs, and new Tier 1-only tests and tools.

| | Full | Light |
|---|---|---|
| Tier 1 green | required | required |
| Tier 2 green | required where configured | required where configured |
| Tier 3 (owner's iPhone) | when it changes the core, renderer, audio, input or touch UX | the same |
| Reviewer agent PASS | required | not required |
| PR report | all six sections (`CLAUDE.md`) | short: objective and issue link, tests run, claims not verified |
| Handoff section | required | only if the work spans more than one session |

When unsure, use full. Allowed paths in an issue contract should include what the work will plausibly need, for example `harness/schema/` for any task that adds scenario fields. That way a small non-protected addition doesn't stall on approval. A non-protected path outside the contract may still be added if the PR says so in its first section, and the PR is then full class.

## Merge rules
Agents may merge their own PRs when **all** of these hold:

- every check its class requires passes (see Risk classes): Tier 1, Tier 2 where configured, and the owner's Tier 3 iPhone check when the PR changes the core, renderer, audio, input or touch UX;
- for full-class PRs, the reviewer agent's verdict is PASS for the commit being merged:
  - find the latest PR comment whose first line starts with `<!-- ff7-web-reviewer ` and whose author is the account agent sessions post as (currently the owner's, `jamescoward`). The repo is public, so a marker comment from anyone else doesn't count;
  - it must say `verdict=PASS`, and its `sha=` must equal the PR's current head commit;
  - any push after the review needs a new review;
  - a verdict is a comment, not a commit status (see `notes/39-reviewer.md`);
- the PR doesn't touch protected paths (`.github/`, `CLAUDE.md`, `docs/SECURITY.md`, `harness/private-eval/`, `harness/baselines/`);
- the title has no `[WIP]` and the PR report its class requires is complete;
- no test was skipped, weakened or deleted, and no baseline was edited, to get green.

Use squash-merge. PRs that touch protected paths get the `needs-owner` label and wait for the owner. Until the CI checks exist (before M1's harness lands), the "required checks" are the commands listed in the PR report, and they must have been run and pass.

## Trip mode (2026-11-09 to 2026-12-05)
The owner is away and checks nothing until they return (owner decision, 2026-11-06). Scheduled sessions keep working under these extra rules. They apply while this section is here; the owner removes it on return.

1. **Pause switch.** Before anything else, list open issues with the label `agents-paused`. If there is one, exit without changing anything.
2. **One implementer at a time.** If an open PR or a `status:in-progress` issue got a push or comment in the last 90 minutes from another session, assume that session is still working: don't touch its branch. Take other ready work that doesn't overlap, or exit.
3. **Per-run budget.** Finish in-flight work (protocol step 2), then take at most one new issue, then stop. Checkpoint early: the weekly quota is shared by every run, and a run that stops cleanly costs less than one that is cut off.
4. **Tier 3 is deferred, not skipped.** A PR that would need the owner's iPhone check may merge when all of these hold:
   - the new behaviour is behind a Labs flag (#105) that is **off by default**, or behind an existing off-by-default toggle such as Debug;
   - Tier 1 passes, including the iPhone-profile checks (#106) once they exist, with the flag on and off;
   - the classic pad and drag-to-walk tests pass unchanged;
   - every other merge rule for its class holds.

   Label it `tier3-deferred` and add one line to the trip log issue (#123): the PR, its flag, and a ≤5-item checklist. A change to the core, renderer, audio or input path that can't be put behind a flag: don't start it. If one is unavoidable, leave its PR open with `needs-owner-device` and record it in the digest.
5. **Don't @-mention the owner** in comments, and don't request reviews. The owner reads everything on return.
6. **Owner-only items wait.** Leave `needs-owner` PRs and issues alone, work around them where the contract allows, and list them in the digest.
7. **Planning.** When no issue is ready, plan from `docs/PHASE0.md` and `notes/m3-m4-issue-drafts.md` (protocol step 5). A new issue is `status:ready` only if it needs no owner decision; otherwise file it as `status:blocked` plus `needs-owner`, with the question in the body. Never plan work outside the milestones.
8. **Weekly digest.** On Wednesdays the digest run comments on #123: merged PRs, work in flight, blocked items and why, the ready-queue length, and any signs of trouble (repeated failures, runs cut off, attempt budgets used up). End with a short list headed "Process friction (candidates for `notes/framework-lessons.md`)": rule gaps, rules that conflicted, or workarounds seen that week, one line each with a link, or "none". List them only; don't edit `notes/framework-lessons.md`, which the owner curates (owner, 2026-11-08).
9. **Two lanes while a second subscription runs** (2026-11-08 16:00 to 2026-11-25 UTC; owner, 2026-11-06, end date corrected 2026-11-08). A second scheduled implementer, on another subscription, takes the **UI lane** first: #105, #106, #113, #114, #115, #116, #118, #119, and follow-ups filed from them. Its runs start at 00:13, 08:13 and 16:13 UTC. During that window, the main implementer takes only the **game-state lane** (M2, the Tier 2 issues, #120, #121), and leaves UI-lane issues and their PRs alone, even ready ones, unless a UI-lane claim has been abandoned for more than 6 hours (protocol step 3).
   - **Overflow (owner, 2026-11-08).** When no UI-lane issue is ready or in flight, the second implementer may take one ready game-state issue that nothing blocks and no one has claimed, preferring #130, #117 and #112 in that order. It claims the issue first (protocol step 3), so the main implementer then leaves it alone. It never takes #81, #111, #120 or #121, which stay with the main implementer, and it keeps rule 2 (no branch another session touched in the last 90 minutes). Tier 2 runs are shared, so it batches hypotheses as usual.
   - **After 2026-11-25** the second subscription has ended: the main implementer takes any ready issue, in either lane. A UI-lane or overflow claim the second implementer left open counts as abandoned from then on.
   - A lane issue already claimed by the other implementer stays with it.
10. **Hand-off before the subscription ends.** The last scheduled run (2026-12-04) brings `STATUS.md` up to date for the owner's return, finishes or checkpoints in-flight work, and posts a final digest.

## Running out of quota
There is no warning, which is why checkpoints are frequent and the Handoff is always current. If a session notices it is close to its limits, it checkpoints immediately rather than starting a new step.

## Resuming automatically
A recurring scheduled Claude Code session (for example every few hours, roughly matching quota resets) can start with: *"Follow the session-start protocol in docs/CONTINUITY.md."* Each run picks up wherever the last one stopped. Only one implementer runs at a time, to avoid two agents editing the same branch.
