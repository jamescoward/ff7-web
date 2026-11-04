# #33: Tier 2 sandbox and attack tests

`harness/private-eval/sandbox/sandbox.js` runs an untrusted build in a Docker container and prints one trusted JSON report. The attack tests are in `harness/private-eval/sandbox/test/`. Everything here is Tier 1: the "disc" is 1 MiB of random bytes.

## Design

| Property | How | Evidence (test) |
|---|---|---|
| No network | `--network none` | `network`: only `lo`; DNS, UDP 8.8.8.8:53, HTTP by name, HTTPS by IP, TCP, IPv6, `169.254.169.254` and the Docker bridge gateway all fail |
| No raw sockets | `--cap-drop ALL`, `no-new-privileges` | `raw sockets`: perl's `socket()` for raw IP, raw ICMP and `AF_PACKET` all get EPERM; `network`: CapEff and CapBnd are 0, NoNewPrivs is 1 |
| No host environment | Docker passes no host variables unless `-e`/`--env-file`, and `createArgs` has none | `credentials`: a `SECRET_<canary>` set in the host process is absent from `process.env` and every readable `/proc/*/environ`; the environment keys are exactly the image's |
| No credential files | Only `/work`, `/disc/disc.bin` and `/out` are bind-mounted | `credentials`: the Docker and containerd sockets, `~/.docker`, `~/.aws`, `/home/runner/*`, `/github/*`, `/run/secrets` and the Kubernetes token are absent, `/etc/shadow` is EACCES, and a canary file planted on the host is not found by a walk of the filesystem |
| Disc read-only | Bind mount with `readonly` | `filesystem`: the disc is world-writable on the host, so only the mount can stop the write; `open(r+)` gives EROFS and the host hash is unchanged |
| Root read-only | `--read-only` | `filesystem`: 16 targets fail, and of every mount `/proc/mounts` lists as `rw`, only `/out` and `/tmp` accept a file |
| One output directory, capped | A host tmpfs (`size`, `nr_inodes=1024`, `noexec,nosuid,nodev`, owned by uid 65534), bind-mounted at `/out` | `output cap (bytes/files)`: ENOSPC, `limits_hit` has `"output"`, host-side usage ≤ cap |
| Output frozen after the run | The host remounts it read-only before anyone reads it; every process ends with the container | `after the run`: a detached child's write 1.5 s after exit never lands; a host write gets EROFS |
| Memory | `--memory` = `--memory-swap` | `memory`: exit 137, `limits_hit` is `["memory"]` (Docker's OOM flag plus the cgroup's `oom_kill`) |
| Processes | `--pids-limit` | `processes`: EAGAIN inside, and `limits_hit` has `"pids"`, read from the cgroup's `pids.events` (`max`) |
| Wall time | Host-side timer, then `docker kill` (SIGKILL) | `time`: SIGTERM is ignored and the program is killed anyway; `exit_code` is null and `limits_hit` is `["time"]` |
| Nothing printed from inside | `--log-driver none`; the CLI prints only its report | `stdout and stderr`: a marker the program prints to both appears nowhere in the CLI's output |
| Pinned | Image by digest in `pins.json`; the Docker server version goes in every report | `pins` |
| Same results | — | `normal Tier 1 scenario`: `pad-echo-buttons` output is byte-identical inside and outside |

Other settings: uid/gid 65534; `--ipc none` (no `/dev/shm`); `--init` (reaps zombies); `nofile=256`; no core dumps; `--cpus`; `/tmp` is a private noexec tmpfs, discarded at exit and never read by the host. The runner needs `/tmp` for the fixture file.

`/dev/mqueue` is listed as `rw`, but creating a file there fails with EINVAL, and with `--ipc none` it belongs to the container's own IPC namespace.

**CPU:** a CPU-spinning program is bounded by the wall-time limit and slowed by `--cpus`. There is no separate "cpu" entry in `limits_hit`.

## Report

```json
{"format":1,"exit_code":0,"limits_hit":[],"limit_counters":["memory","pids"],
 "output_bytes":4096,"elapsed_s":1,"docker_server":"29.9.2","image":"…@sha256:4b15…79da"}
```

- `limits_hit` ⊆ `["memory","output","pids","time"]`, sorted.
- `limit_counters` lists which cgroup counters the host could read. If one is missing, a hit on that limit can't be reported. The `processes` test fails in that case.

## Measured here

- **Host:** this agent container, Docker 29.9.2. Run as root. cgroup v1 (hybrid), cgroupfs driver. **No seccomp or AppArmor profile active** (`docker info` lists no security options).
- **Command:** `SANDBOX_REQUIRE=1 SANDBOX_IMAGE_REPO=mirror.gcr.io/library/node node --test harness/private-eval/sandbox/test/sandbox.test.js`
- **Result:** 15 pass, 0 fail, 0 skipped, about 21 s (14 tests on three runs before the raw-socket test was added; 15 after).
- **Clean-up:** no tmpfs mounts and no containers left afterwards.
- **Without Docker:** 3 pass and 12 skip. With `SANDBOX_REQUIRE=1` the file fails.

Docker Hub answered 429 to this session, so the image came from Google's Docker Hub mirror (`mirror.gcr.io/library/node`). The pinned manifest-list digest is the same, and Docker checks it on pull.

## Not verified (for #35)

- **GitHub's runner.** `ubuntu-24.04` has cgroup v2 (systemd driver), plus Docker's default seccomp profile and AppArmor. The cgroup v2 paths in `cgroupFiles` are written but not exercised. #35 must run this suite there with `SANDBOX_REQUIRE=1` before the sandbox carries the disc. The extra seccomp/AppArmor layers can only tighten things; the cgroup lookup is the real unknown.
- **Short programs and the counters.** `limit_counters` is empty when the program exits before the host has found its cgroup (the reviewer saw this on #46). A pids hit by a very short program then goes unreported, though the limit still applies. Memory is still covered by Docker's OOM flag.
- **The output flag.** `"output"` means less than 64 KiB is left, so a legitimate run that writes close to the cap is flagged too.
- **Kernel isolation.** This is a standard runc container, which shares the host kernel, so a kernel exploit would escape it. A stronger runtime (gVisor `runsc`) is a later option. Accepted for now, given what can leak: the job holds only the disc, and its credentials never enter the container.

## Notes for #34 (validator) and #35 (workflow)

- **Symlinks.** `/out` can contain symlinks pointing anywhere on the host. The validator must use `lstat` / `O_NOFOLLOW` and reject anything that isn't a regular file or directory.
- **Permissions.** Files in `/out` belong to uid 65534 and the root of `/out` is mode 0700. The validator must run as root (`sudo`) or as uid 65534. A file the program made unreadable counts as a failed result.
- **Clean-up.** Call `sandbox.js release --out DIR` after validation (`if: always()`).
- **What gets printed.** `elapsed_s` and `output_bytes` are timing and size side channels. Publish only pass/fail, and `limits_hit` if needed (the accepted low-bandwidth residual risk).
- **Mirrors.** `SANDBOX_IMAGE_REPO` lets the workflow use a mirror if Docker Hub rate-limits the runner. The digest pin still applies.
