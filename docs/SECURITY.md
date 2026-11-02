# Game data and CI security

## Repository boundaries
Public-capable source repository contains only original code, synthetic fixtures and legally redistributable documentation. Keep game files out of Git history, Git LFS, issue attachments, PR artifacts and public previews.

## Private data storage
Prefer a private Cloudflare R2 or S3-compatible bucket for game assets; alternatives include an encrypted local archive or private object storage with temporary scoped credentials. A private Git repo is possible but increases history, size and accidental-disclosure risks.

Suggested object layout (illustrative): `originals/`, `derived-private/`, `reference-private/`, `manifests/`. Do not place secrets in manifests.

## Critical trust boundary
Never provide storage credentials to an unreviewed pull-request workflow or agent-controlled code. Even a read-only credential allows exfiltration. A trusted runner must use a reviewed revision, tightly scoped credentials, network egress controls where feasible, short-lived access, and private outputs. Keep protected evaluation code and assets outside the agent-writable checkout. If isolation is not yet available, run private tests manually on a trusted machine.

## Browser runtime
User imports their own files locally through the File API. No game data is transmitted to a server. Save data should be exportable because browser storage can be evicted. Ensure caches/service workers never accidentally package proprietary assets.

## Prevent accidental commits
Add broad ignores for local asset directories and disc-image extensions, plus a CI check for large or suspicious binary files. These checks are defence-in-depth, not proof of absence. If assets enter Git history, removing a file in a later commit is insufficient: rotate credentials and purge history appropriately.

## Legal caveat
BYO files and private testing do not automatically resolve copyright, reverse-engineering, licence or distribution issues. Review applicable law and third-party licences before publishing. Do not distribute proprietary screenshots or extracted assets in public CI artifacts.
