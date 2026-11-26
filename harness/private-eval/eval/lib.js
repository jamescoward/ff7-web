// Tier 2 trusted eval: the logic behind .github/workflows/tier2-eval.yml
// (issue #35). Trusted code: it always runs from `main`.
//
// Every decision the workflow makes is a function here, tested in
// test/eval.test.js against sample event payloads and fake artifacts:
//
//   gate        which runs may touch the disc: same-repo PRs, by people
//               with write access, from a successful build of this repo's
//               own tier2-build workflow (never forks)
//   artifact    exactly one build artifact, under a size cap, unpacked into
//               a fresh empty directory, holding only regular files and
//               directories (no links, devices or FIFOs), with every
//               execute bit removed: nothing in it is ever run on the host
//   expect      the scenario names and metric keys the summary may hold,
//               read from the artifact's tier 2 scenario files *before* the
//               disc is fetched (validator, #34)
//   shards      the scenarios split over SHARDS eval jobs, each under the
//               sandbox time limit; a snapshot chain (#74) stays in one
//               shard (#269)
//   evaluate    the untrusted build runs only inside the sandbox (#33), and
//               only the validator's summary comes out
//   cleanup     the disc, the output mount and the build are removed when
//               the job ends, even on failure
//   merge       the shards' summaries become one, re-checked field by field
//   check run   the `tier2` check holds the summary and nothing else
//
// Nothing here prints file contents from the artifact or the sandbox.
// Error messages are fixed codes.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { releaseOutput, runSandbox } from '../sandbox/sandbox.js';
import {
  LIMIT_NAMES, loadExpect, MAX_METRICS, MAX_SCENARIOS, METRIC_RE, NAME_RE, REASONS, STATUSES,
} from '../validate/validate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const VALIDATE_JS = path.resolve(HERE, '../validate/validate.js');

/** The build workflow whose artifact this job runs. */
export const BUILD_WORKFLOW_PATH = '.github/workflows/tier2-build.yml';
export const BUILD_WORKFLOW_FILE = 'tier2-build.yml';
export const ARTIFACT_NAME = 'tier2-build';

/** Compressed artifact cap (checked from the API before downloading). */
export const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;
/** Unpacked caps. */
export const MAX_WORK_BYTES = 512 * 1024 * 1024;
export const MAX_WORK_ENTRIES = 8192;
export const MAX_WORK_DEPTH = 24;

/** Where tier 2 scenarios live inside the artifact. */
export const SCENARIO_DIR = 'harness/scenarios';
export const MAX_SCENARIO_FILES = 256;
export const MAX_SCENARIO_BYTES = 64 * 1024;

/**
 * The command run inside the sandbox, with /work (the artifact) as its
 * working directory. The entry point itself is untrusted PR code; this
 * contract (argument names, /out/results.json) is what the trusted side fixes.
 */
export const SANDBOX_COMMAND = ['node', 'runner/tier2.js', '--disc', '/disc/disc.bin', '--out', '/out'];
export const SANDBOX_LIMITS = { timeoutS: 1200, memoryMiB: 2048, cpus: 2, pids: 64, outMiB: 4, tmpMiB: 64 };

/**
 * Eval jobs per run (#269). Each runs its share of the scenarios in its own
 * sandbox, under SANDBOX_LIMITS. .github/workflows/tier2-eval.yml has the
 * same count in the eval job's matrix and its summary_<i> outputs
 * (test/workflows.test.js checks they agree).
 */
export const SHARDS = 2;

/** Repository permissions that allow a run (the API's `permission` field). */
export const WRITE_PERMISSIONS = ['admin', 'write'];

/** Fixed error codes: the only words besides the validator's that reach the check. */
export const ERRORS = [
  'artifact-rejected', 'bad-scenario', 'disc-missing', 'sandbox-failed', 'validator-failed', 'internal',
];

export class Tier2Error extends Error {
  constructor(code) {
    super(code);
    if (!ERRORS.includes(code)) throw new Error(`unknown error code ${code}`);
    this.code = code;
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const skip = (reason) => ({ run: false, reason });

// ---------------------------------------------------------------- gate

/**
 * Decide from a `workflow_run` event payload whether this run may go on.
 * Returns { run: false, reason } or
 *         { run: true, pr, headSha, buildRunId, actors: [login...] }.
 * The actors still need a permission check (permissionAllows).
 */
export function gateWorkflowRun(payload, repository) {
  if (!isObj(payload) || !isObj(payload.workflow_run) || !isObj(payload.repository)) return skip('bad-payload');
  const run = payload.workflow_run;
  if (payload.repository.full_name !== repository) return skip('other-repository');
  if (payload.action !== 'completed') return skip('not-completed');
  if (String(run.path ?? '').split('@')[0] !== BUILD_WORKFLOW_PATH) return skip('other-workflow');
  if (run.event !== 'pull_request') return skip('not-a-pull-request');
  if (run.conclusion !== 'success') return skip('build-not-successful');
  if (!isObj(run.head_repository) || run.head_repository.full_name !== repository) return skip('fork');
  if (run.head_repository.id !== payload.repository.id) return skip('fork');
  if (!Array.isArray(run.pull_requests) || run.pull_requests.length !== 1) return skip('no-single-pull-request');
  const pr = run.pull_requests[0];
  if (!isObj(pr) || !isObj(pr.head) || !isObj(pr.base)) return skip('bad-payload');
  if (pr.head.repo?.id !== payload.repository.id || pr.base.repo?.id !== payload.repository.id) return skip('fork');
  if (pr.head.sha !== run.head_sha) return skip('head-moved');
  if (!/^[0-9a-f]{40}$/.test(run.head_sha ?? '')) return skip('bad-payload');
  if (!Number.isInteger(pr.number) || pr.number < 1 || !Number.isInteger(run.id)) return skip('bad-payload');
  const actors = [...new Set([run.actor?.login, run.triggering_actor?.login])];
  if (!actors.every((a) => typeof a === 'string' && a.length > 0)) return skip('bad-payload');
  return { run: true, pr: pr.number, headSha: run.head_sha, buildRunId: run.id, actors };
}

/**
 * Decide for a `workflow_dispatch` (re-check an existing PR). `prDoc` is the
 * pull request from the REST API; `ref` is the ref the workflow ran from.
 * Returns the same shape as gateWorkflowRun, with buildRunId: null (found
 * afterwards with pickBuildRun).
 */
export function gateDispatch({ ref, input, actor }, prDoc, repository) {
  if (ref !== 'refs/heads/main') return skip('not-main');
  if (typeof input !== 'string' || !/^[1-9][0-9]{0,8}$/.test(input)) return skip('bad-input');
  if (!isObj(prDoc) || prDoc.number !== Number(input)) return skip('bad-payload');
  if (prDoc.state !== 'open') return skip('pull-request-not-open');
  if (!isObj(prDoc.head?.repo) || prDoc.head.repo.full_name !== repository) return skip('fork');
  if (!isObj(prDoc.base?.repo) || prDoc.base.repo.full_name !== repository) return skip('other-repository');
  if (prDoc.head.repo.id !== prDoc.base.repo.id) return skip('fork');
  if (!/^[0-9a-f]{40}$/.test(prDoc.head.sha ?? '')) return skip('bad-payload');
  const actors = [...new Set([actor, prDoc.user?.login])];
  if (!actors.every((a) => typeof a === 'string' && a.length > 0)) return skip('bad-payload');
  return { run: true, pr: prDoc.number, headSha: prDoc.head.sha, buildRunId: null, actors };
}

/** From GET /repos/{repo}/collaborators/{user}/permission: may this user trigger a run? */
export function permissionAllows(doc) {
  return isObj(doc) && WRITE_PERMISSIONS.includes(doc.permission);
}

/**
 * For a dispatch: the newest successful pull_request run of the build
 * workflow, from this repository, for `headSha`. `runs` is the API's
 * workflow_runs list. Returns the run id or null.
 */
export function pickBuildRun(runs, headSha, repository) {
  if (!Array.isArray(runs)) return null;
  const ok = runs.filter((r) => isObj(r)
    && r.head_sha === headSha
    && r.event === 'pull_request'
    && r.conclusion === 'success'
    && String(r.path ?? '').split('@')[0] === BUILD_WORKFLOW_PATH
    && r.head_repository?.full_name === repository
    && Number.isInteger(r.id));
  ok.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id);
  return ok.length ? ok[0].id : null;
}

/**
 * From GET /repos/{repo}/actions/runs/{id}/artifacts: exactly one live
 * artifact named ARTIFACT_NAME, under the size cap. Returns { id } or
 * { reason }.
 */
export function pickArtifact(artifacts) {
  if (!Array.isArray(artifacts)) return { reason: 'bad-payload' };
  const named = artifacts.filter((a) => isObj(a) && a.name === ARTIFACT_NAME);
  if (named.length !== 1) return { reason: named.length ? 'several-artifacts' : 'no-artifact' };
  const a = named[0];
  if (a.expired) return { reason: 'artifact-expired' };
  if (!Number.isInteger(a.size_in_bytes) || a.size_in_bytes <= 0 || a.size_in_bytes > MAX_ARTIFACT_BYTES) {
    return { reason: 'artifact-too-large' };
  }
  if (!Number.isInteger(a.id)) return { reason: 'bad-payload' };
  return { id: a.id };
}

// ---------------------------------------------------------------- job layout

/** Every path the job uses, under one root ($RUNNER_TEMP/tier2). */
export function layout(root) {
  const r = path.resolve(root);
  return {
    root: r,
    work: path.join(r, 'work'),
    discDir: path.join(r, 'disc'),
    disc: path.join(r, 'disc', 'disc.bin'),
    out: path.join(r, 'out'),
    expect: path.join(r, 'expect.json'),
    report: path.join(r, 'sandbox-report.json'),
    summary: path.join(r, 'summary.json'),
  };
}

/** Create the root and an empty work directory; refuses if either exists. */
export function prepare(root) {
  const L = layout(root);
  if (existsSync(L.root)) throw new Tier2Error('internal');
  mkdirSync(L.root, { mode: 0o700, recursive: true });
  mkdirSync(L.work, { mode: 0o700 });
  mkdirSync(L.discDir, { mode: 0o700 });
  return L;
}

// ---------------------------------------------------------------- artifact

/** Top-level directories a build must have; without them it can't be a tier2-build artifact. */
export const WORK_TOP_DIRS = ['harness', 'runner'];

/**
 * Check the unpacked artifact: only regular files and directories, within
 * the caps, with runner/ and harness/ at the top. Then clear every execute
 * bit on files (0644) and make directories 0755, so the sandbox user can
 * read them and nothing in the tree is executable on the host.
 * Returns { files, bytes, digest }: the digest covers every path and file
 * content, so a second job can tell it has the same tree.
 * Throws Tier2Error('artifact-rejected').
 */
export function checkWork(dir) {
  const reject = () => {
    throw new Tier2Error('artifact-rejected');
  };
  const top = lstatSync(dir, { throwIfNoEntry: false });
  if (!top || !top.isDirectory()) reject();
  let entries = 0;
  let bytes = 0;
  const files = [];
  const dirs = [dir];
  const walk = (d, depth) => {
    if (depth > MAX_WORK_DEPTH) reject();
    for (const name of readdirSync(d)) {
      if (++entries > MAX_WORK_ENTRIES) reject();
      const p = path.join(d, name);
      const st = lstatSync(p);
      if (st.isDirectory()) {
        dirs.push(p);
        walk(p, depth + 1);
      } else if (st.isFile()) {
        if (st.nlink !== 1) reject();
        bytes += st.size;
        if (bytes > MAX_WORK_BYTES) reject();
        files.push(p);
      } else {
        reject();
      }
    }
  };
  walk(dir, 0);
  if (files.length === 0) reject();
  for (const top of WORK_TOP_DIRS) {
    if (!lstatSync(path.join(dir, top), { throwIfNoEntry: false })?.isDirectory()) reject();
  }
  for (const f of files) chmodSync(f, 0o644);
  for (const d of dirs) chmodSync(d, 0o755);
  return { files: files.length, bytes, digest: treeDigest(dir, files) };
}

/** SHA-256 over every file's relative path and content hash, in sorted order. */
export function treeDigest(dir, files) {
  const h = createHash('sha256');
  for (const rel of files.map((f) => path.relative(dir, f)).sort()) {
    const fh = createHash('sha256').update(readFileSync(path.join(dir, rel))).digest('hex');
    h.update(`${rel}\0${fh}\n`);
  }
  return h.digest('hex');
}

/**
 * Build the validator's --expect document from the artifact's tier 2
 * scenario files. A scenario file is tier 2 when its `tier` is 2; its name
 * must match its file name, and its optional `metrics` array lists the
 * metric keys it may report. Called after checkWork, before the disc is
 * fetched: everything it reads was written without access to the disc.
 * Returns { format: 1, scenarios: { name: [keys] } }; scenarios may be empty.
 */
export function buildExpect(work, { shard = 0, shards = 1 } = {}) {
  const bad = () => {
    throw new Tier2Error('bad-scenario');
  };
  if (!Number.isInteger(shards) || shards < 1 || !Number.isInteger(shard) || shard < 0 || shard >= shards) {
    throw new Tier2Error('internal');
  }
  const links = [];
  const dir = path.join(work, SCENARIO_DIR);
  const st = lstatSync(dir, { throwIfNoEntry: false });
  const scenarios = {};
  if (!st) return { format: 1, scenarios };
  if (!st.isDirectory()) bad();
  const names = readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
  if (names.length > MAX_SCENARIO_FILES) bad();
  for (const file of names) {
    const p = path.join(dir, file);
    const fst = lstatSync(p);
    if (!fst.isFile() || fst.size > MAX_SCENARIO_BYTES) bad();
    let doc;
    try {
      doc = JSON.parse(readFileSync(p, 'utf8'));
    } catch {
      bad();
    }
    if (!isObj(doc) || doc.tier !== 2) continue;
    if (typeof doc.name !== 'string' || !NAME_RE.test(doc.name) || `${doc.name}.json` !== file) bad();
    const keys = doc.metrics ?? [];
    if (!Array.isArray(keys) || keys.length > MAX_METRICS) bad();
    if (!keys.every((k) => typeof k === 'string' && METRIC_RE.test(k)) || new Set(keys).size !== keys.length) bad();
    scenarios[doc.name] = [...keys].sort();
    links.push({ name: doc.name, ...chainLinks(doc) });
  }
  if (Object.keys(scenarios).length > MAX_SCENARIOS) bad();
  const mine = new Set(shardOf(links, shards)[shard]);
  const picked = Object.fromEntries(Object.entries(scenarios).filter(([name]) => mine.has(name)));
  const doc = { format: 1, scenarios: picked };
  if (Object.keys(picked).length) loadExpect(doc);
  return doc;
}

// ---------------------------------------------------------------- shards

/**
 * What ties a tier 2 scenario to others in a run (#74), read the way
 * runner/tier2.js reads it: `keeps` is the snapshot name it keeps its end
 * state under, `after` the snapshot name it boots from (a format 2 boot with
 * no disc or fixture source). Either is null. Only names matter here; the
 * runner does the rest.
 */
export function chainLinks(doc) {
  const f2 = isObj(doc) && doc.format === 2 && isObj(doc.boot);
  const hasSource = f2 && (doc.boot.disc !== undefined || doc.boot.fixture !== undefined);
  const after = f2 && !hasSource && typeof doc.boot.from === 'string' ? doc.boot.from : null;
  const keeps = f2 && typeof doc.snapshot === 'string' ? doc.snapshot : null;
  return { after, keeps };
}

/**
 * Split scenarios into `shards` lists of names (#269). links:
 * [{ name, after, keeps }]. A scenario that boots from a snapshot goes in
 * the same shard as every scenario that keeps a snapshot of that name, so
 * a chain never crosses shards (the runner keeps snapshots in memory for
 * one run only). Whole groups go, largest first (then by first name), to
 * the shard with the fewest scenarios so far (then the lowest index).
 * Deterministic; each list is sorted by name.
 */
export function shardOf(links, shards) {
  const parent = new Map(links.map((l) => [l.name, l.name]));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const union = (a, b) => {
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };
  const keepers = new Map();
  for (const l of links) if (l.keeps !== null) keepers.set(l.keeps, [...(keepers.get(l.keeps) ?? []), l.name]);
  for (const l of links) for (const k of (l.after !== null ? keepers.get(l.after) ?? [] : [])) union(l.name, k);
  const groups = new Map();
  for (const l of links) groups.set(find(l.name), [...(groups.get(find(l.name)) ?? []), l.name]);
  const ordered = [...groups.values()].map((g) => g.sort())
    .sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1));
  const out = Array.from({ length: shards }, () => []);
  for (const g of ordered) {
    let best = 0;
    for (let i = 1; i < shards; i++) if (out[i].length < out[best].length) best = i;
    out[best].push(...g);
  }
  return out.map((names) => names.sort());
}

/** The sandbox command for an expect file's scenarios: the contract plus --only (#269). */
export function sandboxCommand(expect) {
  return [...SANDBOX_COMMAND, '--only', Object.keys(expect.scenarios).sort().join(',')];
}

// ---------------------------------------------------------------- evaluate

/** The summary posted to the check run and printed in the log. */
export function makeSummary({ result, error = null, validator = null }) {
  return { format: 1, ok: result === 'pass' || result === 'no-scenarios', result, error, validator };
}

/** Run the validator as root (the sandbox's /out is 0700, uid 65534). */
function runValidator(L) {
  const args = [VALIDATE_JS, '--out', L.out, '--expect', L.expect, '--sandbox-report', L.report];
  const r = process.getuid() === 0
    ? spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 20 })
    : spawnSync('sudo', ['-n', process.execPath, ...args], { encoding: 'utf8', maxBuffer: 1 << 20 });
  if (r.status !== 0) throw new Tier2Error('validator-failed');
  const lines = r.stdout.split('\n').filter(Boolean);
  if (lines.length !== 1) throw new Tier2Error('validator-failed');
  try {
    return JSON.parse(lines[0]);
  } catch {
    throw new Tier2Error('validator-failed');
  }
}

/**
 * Run the artifact in the sandbox against the disc and validate the output.
 * The expect file must already be written (buildExpect). Returns the
 * summary; never throws for a failure of the untrusted program.
 */
export async function evaluate(root, { command, limits = SANDBOX_LIMITS, image } = {}) {
  const L = layout(root);
  const expect = JSON.parse(readFileSync(L.expect, 'utf8'));
  command ??= sandboxCommand(expect);
  if (Object.keys(expect.scenarios).length === 0) return makeSummary({ result: 'no-scenarios' });
  const d = lstatSync(L.disc, { throwIfNoEntry: false });
  if (!d || !d.isFile() || d.size === 0) return makeSummary({ result: 'error', error: 'disc-missing' });
  let report;
  try {
    report = await runSandbox({ work: L.work, disc: L.disc, out: L.out, command, limits, image });
  } catch {
    return makeSummary({ result: 'error', error: 'sandbox-failed' });
  }
  writeFileSync(L.report, JSON.stringify(report));
  try {
    const v = runValidator(L);
    return makeSummary({ result: v.ok ? 'pass' : 'fail', validator: v });
  } catch (e) {
    return makeSummary({ result: 'error', error: e instanceof Tier2Error ? e.code : 'internal' });
  } finally {
    try {
      releaseOutput(L.out);
    } catch {
      /* cleanup() tries again at the end of the job */
    }
  }
}

// ---------------------------------------------------------------- merge

const RESULTS = ['pass', 'fail', 'error', 'no-scenarios'];
const isCount = (v) => Number.isInteger(v) && v >= 0 && v <= MAX_SCENARIOS;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * A shard's summary, re-checked field by field before it is merged: it came
 * from another job, through job outputs. Anything not in the shape
 * makeSummary and the validator produce becomes an `internal` error summary,
 * so no other text can reach the check.
 */
export function checkShardSummary(s) {
  const err = makeSummary({ result: 'error', error: 'internal' });
  if (!isObj(s) || s.format !== 1 || !RESULTS.includes(s.result) || typeof s.ok !== 'boolean') return err;
  if (s.error !== null && !ERRORS.includes(s.error)) return err;
  if (s.validator === null) {
    return s.result === 'pass' || s.result === 'fail' ? err : makeSummary({ result: s.result, error: s.error });
  }
  const v = s.validator;
  if (!isObj(v) || v.format !== 1 || typeof v.ok !== 'boolean' || !['accepted', 'rejected'].includes(v.output)) return err;
  if (v.reason !== null && !REASONS.includes(v.reason)) return err;
  if (!Array.isArray(v.limits_hit) || !v.limits_hit.every((x) => LIMIT_NAMES.includes(x))) return err;
  const c = v.counts;
  if (!isObj(c) || !['pass', 'fail', 'error', 'missing'].every((k) => isCount(c[k]))) return err;
  if (!Array.isArray(v.scenarios) || v.scenarios.length > MAX_SCENARIOS) return err;
  const scenarios = [];
  for (const x of v.scenarios) {
    if (!isObj(x) || typeof x.name !== 'string' || !NAME_RE.test(x.name) || !STATUSES.includes(x.status)) return err;
    const out = { name: x.name, status: x.status };
    if (x.metrics !== undefined) {
      if (!isObj(x.metrics)) return err;
      const keys = Object.keys(x.metrics);
      if (keys.length > MAX_METRICS || !keys.every((k) => METRIC_RE.test(k) && isNum(x.metrics[k]))) return err;
      out.metrics = Object.fromEntries(keys.sort().map((k) => [k, x.metrics[k]]));
    }
    scenarios.push(out);
  }
  const validator = {
    format: 1, ok: v.ok, output: v.output, reason: v.reason, limits_hit: [...v.limits_hit],
    counts: { pass: c.pass, fail: c.fail, error: c.error, missing: c.missing }, scenarios,
  };
  return makeSummary({ result: s.result, error: s.error, validator });
}

/**
 * One summary from the shards' summaries (#269), each checked with
 * checkShardSummary first; a missing one (null) is an internal error.
 * Result: error if any shard errored; else fail if any failed; else pass,
 * or no-scenarios when no shard had any. Counts add up, scenarios are
 * sorted by name, limits are joined, and the first rejected shard's reason
 * is kept.
 */
export function mergeSummaries(list) {
  const shards = list.map((s) => checkShardSummary(s ?? null));
  const errored = shards.find((s) => s.result === 'error');
  const vs = shards.map((s) => s.validator).filter(Boolean);
  const validator = vs.length === 0 ? null : {
    format: 1,
    ok: vs.every((v) => v.ok),
    output: vs.every((v) => v.output === 'accepted') ? 'accepted' : 'rejected',
    reason: vs.find((v) => v.reason !== null)?.reason ?? null,
    limits_hit: LIMIT_NAMES.filter((x) => vs.some((v) => v.limits_hit.includes(x))),
    counts: Object.fromEntries(['pass', 'fail', 'error', 'missing'].map((k) => [k, vs.reduce((a, v) => a + v.counts[k], 0)])),
    scenarios: vs.flatMap((v) => v.scenarios).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
  };
  if (errored) return makeSummary({ result: 'error', error: errored.error ?? 'internal', validator });
  if (shards.some((s) => s.result === 'fail')) return makeSummary({ result: 'fail', validator });
  if (shards.every((s) => s.result === 'no-scenarios')) return makeSummary({ result: 'no-scenarios' });
  return makeSummary({ result: 'pass', validator });
}

// ---------------------------------------------------------------- cleanup

/**
 * Remove the disc, release the output mount, and remove everything under
 * the root. Never throws; returns what happened to each part
 * ('removed' | 'absent' | 'failed').
 */
export function cleanup(root) {
  const L = layout(root);
  const result = {};
  const step = (key, fn) => {
    try {
      result[key] = fn();
    } catch {
      result[key] = 'failed';
    }
  };
  step('disc', () => {
    if (!existsSync(L.discDir)) return 'absent';
    rmSync(L.discDir, { recursive: true, force: true });
    if (existsSync(L.discDir)) throw new Error('still there');
    return 'removed';
  });
  step('out', () => {
    if (!existsSync(L.out)) return 'absent';
    releaseOutput(L.out);
    rmSync(L.out, { recursive: true, force: true });
    if (existsSync(L.out)) throw new Error('still there');
    return 'removed';
  });
  step('root', () => {
    if (!existsSync(L.root)) return 'absent';
    rmSync(L.root, { recursive: true, force: true });
    if (existsSync(L.root)) throw new Error('still there');
    return 'removed';
  });
  return result;
}

// ---------------------------------------------------------------- check run

export const CHECK_NAME = 'tier2';

/**
 * The check run's conclusion and output for a summary. Everything in it is
 * fixed text, or values from the summary (itself fixed vocabulary, expected
 * names and keys, statuses and checked numbers).
 */
export function checkRunOutput(summary) {
  const ok = isObj(summary) && summary.ok === true;
  const result = isObj(summary) && typeof summary.result === 'string' ? summary.result : 'error';
  const titles = {
    pass: 'Tier 2 passed',
    'no-scenarios': 'No tier 2 scenarios in this build',
    fail: 'Tier 2 failed',
    error: 'Tier 2 could not run',
  };
  const lines = [`**Result:** ${result}`];
  const v = isObj(summary) ? summary.validator : null;
  if (isObj(v) && isObj(v.counts)) {
    const c = v.counts;
    lines.push(`**Scenarios:** ${c.pass} pass, ${c.fail} fail, ${c.error} error, ${c.missing} missing`);
    if (v.output === 'rejected') lines.push(`**Output rejected:** ${v.reason}`);
    if (Array.isArray(v.limits_hit) && v.limits_hit.length) lines.push(`**Limits hit:** ${v.limits_hit.join(', ')}`);
  }
  if (isObj(summary) && summary.error) lines.push(`**Error:** ${summary.error}`);
  lines.push('', 'Validated summary (the only data that leaves the sandbox):', '', '```json', JSON.stringify(summary, null, 2), '```');
  return {
    conclusion: ok ? 'success' : 'failure',
    output: { title: titles[result] ?? titles.error, summary: lines.join('\n') },
  };
}


