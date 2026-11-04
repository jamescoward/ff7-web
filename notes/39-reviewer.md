# 39: reviewer subagent

## Design
- **Definition:** `.claude/agents/reviewer.md`. Opus, read-only tools (Bash, Read, Grep, Glob, GitHub read tools, add issue comment). No Edit or Write.
- **Why a comment, not a status:** agent sessions run on the owner's subscription with no API key or repo secret, so they can't set commit statuses or checks. A PR comment needs only the GitHub MCP tools. Branch protection can't require it; the merge rule in `docs/CONTINUITY.md` does.
- **Marker:** first line of the comment, `<!-- ff7-web-reviewer verdict=PASS sha=<40-char head sha> -->` (or `verdict=FAIL`). The marker is machine-readable and invisible when rendered.
- **One comment per run:** old comments are never edited. The latest marked comment counts.
- **Fresh context:** the reviewer reads the diff, linked issue and PR body itself, treats them as untrusted, and re-runs the fast checks.

## How to start it
- Normal: a session starts the `reviewer` subagent with "Review PR #<n>" before merging.
- If `.claude/agents/` isn't loaded: start a general-purpose subagent on Opus, with the body of the agent file as the prompt plus the PR number.
- Dry run: give it a local branch name and the issue contract; it returns the verdict text and posts nothing.
- The owner can do the same on any PR.

## How the merge rule reads it
Latest PR comment starting with `<!-- ff7-web-reviewer `: needs `verdict=PASS` and `sha=` equal to the head commit being merged. A later push needs a new review.

## Future option
A workflow on `main` that turns the marked comment into a `reviewer` commit status, so branch protection can require it. It lives under `.github/` (protected), so it needs its own PR and the owner's review.

## Dry runs
| Dry run | Branch | Expected verdict | Actual verdict | Finding named |
|---|---|---|---|---|
| 1. Deliberate edit to a protected path | TBD (parent session) | FAIL, names the protected path | TBD (parent session) | TBD (parent session) |
| 2. A claim with no test behind it | TBD (parent session) | FAIL, names the claim | TBD (parent session) | TBD (parent session) |
| 3. A clean change | TBD (parent session) | PASS | TBD (parent session) | TBD (parent session) |
