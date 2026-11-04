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

## Merge rules
Agents may merge their own PRs when **all** of these hold:

- every required check passes: Tier 1, Tier 2 where configured, the reviewer agent, and the owner's Tier 3 iPhone check when the PR changes the core, renderer, audio, input or touch UX;
- the reviewer agent's verdict is PASS for the commit being merged:
  - find the latest PR comment whose first line starts with `<!-- ff7-web-reviewer `;
  - it must say `verdict=PASS`, and its `sha=` must equal the PR's current head commit;
  - any push after the review needs a new review;
  - a verdict is a comment, not a commit status (see `notes/39-reviewer.md`);
- the PR doesn't touch protected paths (`.github/`, `CLAUDE.md`, `docs/SECURITY.md`, `harness/private-eval/`, `harness/baselines/`);
- the title has no `[WIP]` and the PR report is complete;
- no test was skipped, weakened or deleted, and no baseline was edited, to get green.

Use squash-merge. PRs that touch protected paths get the `needs-owner` label and wait for the owner. Until the CI checks exist (before M1's harness lands), the "required checks" are the commands listed in the PR report, and they must have been run and pass.

## Running out of quota
There is no warning, which is why checkpoints are frequent and the Handoff is always current. If a session notices it is close to its limits, it checkpoints immediately rather than starting a new step.

## Resuming automatically
A recurring scheduled Claude Code session (for example every few hours, roughly matching quota resets) can start with: *"Follow the session-start protocol in docs/CONTINUITY.md."* Each run picks up wherever the last one stopped. Only one implementer runs at a time, to avoid two agents editing the same branch.
