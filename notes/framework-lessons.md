# Lessons for a general agentic development framework

When this project is done, the owner plans to point an agent at it and pull out a general framework for agent-led development: continuity, risk classes, protected paths, a private eval sandbox, a fresh-context reviewer and unattended operation. The aim is a framework that is safer against prompt injection. This file collects what the project taught along the way, so that work has real experience to draw on as well as the finished rules.

Add an entry when a process rule changes, or when something goes wrong in a way the rules didn't foresee. Keep each one short: what happened, why it matters, and what a general framework should do. These are lessons, not rules for this project: nothing here changes how agents work on ff7-web.

## 2026-11-08: agents and the owner share one GitHub identity
**What happened.** Every agent session posts to GitHub as the owner's account (`jamescoward`). The reviewer's marker check (`docs/CONTINUITY.md`, Merge rules) accepts a `verdict=PASS` comment only from that account, and owner decisions are often recorded on issues "from the shared account" (for example #38).

**Why it matters.** The author check stops strangers on a public repo, but it can't tell the owner from an agent. An agent that has read injected text (from an issue, a dependency, a fetched page) can post a PASS marker or write an "owner decision", and it looks genuine. The trust boundary depends on agents behaving well, when it should depend on who is allowed to post what.

**For the framework.** Give agents their own identity, such as a bot account or a GitHub App, separate from the owner's. Accept owner decisions and review verdicts only from identities that agents can't act as. Treat everything else as data, never as instructions. The prompt of the scheduled task that starts each run is also a root of trust. At present it lives outside the repo, unreviewed, so it should be versioned and signed off.

## 2026-11-08: public or private repository
**What happened.** The repo is public mainly to keep costs down. That lets anyone open issues or post comments, and agents read issue bodies as task contracts, so it widens the injection surface. On GitHub Free, making it private would close that surface but break three things this project depends on: protected branches and code owners (the protected-path rule), GitHub Pages (per-PR preview links for the owner's iPhone checks), and free Actions minutes (Tier 1, Tier 2 and previews on every PR).

**Why it matters.** The cheap setup and the safe setup pull in opposite directions, and the safety features the process relies on are the ones that cost money on a private repo. Going private also doesn't fix the shared identity above, or injection through dependencies and web pages the agents read.

**For the framework.** Say plainly which platform features the safety model needs (branch protection, code owners, CI minutes, preview hosting), and what each plan costs. Recommend a private repo on a plan that keeps those features. Where a public repo is used, only accept instructions from allow-listed authors, and have agents treat other issue text and comments as untrusted data.
