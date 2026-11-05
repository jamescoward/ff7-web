#!/usr/bin/env node
// Tier 2 trusted eval CLI, called by .github/workflows/tier2-eval.yml.
// Trusted code from `main`; the logic and its tests are in lib.js and test/.
//
//   tier2.js gate          decide whether this run may go on (writes step outputs)
//   tier2.js prepare       --root DIR   create the job's directories (empty)
//   tier2.js check-work    --root DIR   check the unpacked artifact, write expect.json
//   tier2.js evaluate      --root DIR   sandbox + validator; writes and prints the summary
//   tier2.js cleanup       --root DIR   remove the disc, the output mount and the build
//   tier2.js check-start   --sha SHA    create the in-progress `tier2` check run
//   tier2.js check-finish  --id ID --root DIR   complete it from summary.json
//
// `gate` reads GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, GITHUB_REPOSITORY,
// GITHUB_REF, GITHUB_ACTOR and, for workflow_dispatch, TIER2_PR. The API
// calls use GITHUB_TOKEN and GITHUB_API_URL.
//
// Output: step outputs go to GITHUB_OUTPUT; the log gets one line per
// command, made of fixed words, numbers, and (from `evaluate`) the summary.
// Exit status: 0 done (read the outputs), 1 a step failed, 2 usage error.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  buildExpect, checkRunOutput, checkWork, CHECK_NAME, BUILD_WORKFLOW_FILE, cleanup, evaluate, gateDispatch,
  gateWorkflowRun, layout, makeSummary, permissionAllows, pickArtifact, pickBuildRun, prepare, Tier2Error,
} from './lib.js';

function setOutputs(obj) {
  const lines = Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines}\n`);
}

export async function api(method, route, body) {
  const base = process.env.GITHUB_API_URL || 'https://api.github.com';
  const res = await fetch(`${base}${route}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'x-github-api-version': '2022-11-28',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  // Only the status is reported: response bodies are never printed.
  if (!res.ok) throw new Error(`GitHub API ${method} ${route.split('?')[0]}: HTTP ${res.status}`);
  return res.status === 204 ? null : res.json();
}

async function gate() {
  const env = process.env;
  const repo = env.GITHUB_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? '')) throw new Error('GITHUB_REPOSITORY missing');
  let g;
  if (env.GITHUB_EVENT_NAME === 'workflow_run') {
    g = gateWorkflowRun(JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')), repo);
  } else if (env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    const input = env.TIER2_PR ?? '';
    const prDoc = /^[1-9][0-9]{0,8}$/.test(input) ? await api('GET', `/repos/${repo}/pulls/${input}`) : null;
    g = gateDispatch({ ref: env.GITHUB_REF, input, actor: env.GITHUB_ACTOR }, prDoc, repo);
    if (g.run) {
      const q = `head_sha=${g.headSha}&event=pull_request&status=success&per_page=20`;
      const runs = await api('GET', `/repos/${repo}/actions/workflows/${BUILD_WORKFLOW_FILE}/runs?${q}`);
      g.buildRunId = pickBuildRun(runs?.workflow_runs, g.headSha, repo);
      if (g.buildRunId === null) g = { run: false, reason: 'no-successful-build' };
    }
  } else {
    g = { run: false, reason: 'unsupported-event' };
  }
  if (g.run) {
    for (const login of g.actors) {
      if (!/^[A-Za-z0-9-]{1,39}$/.test(login)) {
        g = { run: false, reason: 'not-a-collaborator' };
        break;
      }
      let perm = null;
      try {
        perm = await api('GET', `/repos/${repo}/collaborators/${login}/permission`);
      } catch {
        perm = null; // 404 for non-collaborators: fail closed
      }
      if (!permissionAllows(perm)) {
        g = { run: false, reason: 'not-a-collaborator' };
        break;
      }
    }
  }
  if (g.run) {
    const list = await api('GET', `/repos/${repo}/actions/runs/${g.buildRunId}/artifacts?per_page=100`);
    const a = pickArtifact(list?.artifacts);
    if (a.reason) g = { run: false, reason: a.reason, pr: g.pr, headSha: g.headSha };
    else g.artifactId = a.id;
  }
  setOutputs({
    run: String(g.run),
    reason: g.reason ?? '',
    pr: g.pr ?? '',
    head_sha: g.headSha ?? '',
    build_run_id: g.buildRunId ?? '',
    artifact_id: g.artifactId ?? '',
  });
  console.log(g.run ? `gate: run (PR #${g.pr}, build run ${g.buildRunId})` : `gate: skip (${g.reason})`);
  return 0;
}

function checkWorkCmd(root) {
  const L = layout(root);
  let n = 0;
  try {
    const { files, bytes } = checkWork(L.work);
    const expect = buildExpect(L.work);
    writeFileSync(L.expect, JSON.stringify(expect));
    n = Object.keys(expect.scenarios).length;
    console.log(`check-work: ${files} files, ${bytes} bytes, ${n} tier 2 scenarios`);
  } catch (e) {
    const code = e instanceof Tier2Error ? e.code : 'internal';
    writeFileSync(L.summary, JSON.stringify(makeSummary({ result: 'error', error: code })));
    console.log(`check-work: rejected (${code})`);
  }
  setOutputs({ scenarios: n });
  return 0;
}

async function evaluateCmd(root) {
  const L = layout(root);
  if (!existsSync(L.summary)) writeFileSync(L.summary, JSON.stringify(await evaluate(root)));
  console.log(readFileSync(L.summary, 'utf8'));
  return 0;
}

async function checkStart(sha) {
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error('--sha must be a commit id');
  const repo = process.env.GITHUB_REPOSITORY;
  const run = await api('POST', `/repos/${repo}/check-runs`, {
    name: CHECK_NAME,
    head_sha: sha,
    status: 'in_progress',
    output: { title: 'Tier 2 running', summary: 'Running the build in the sandbox.' },
  });
  setOutputs({ check_id: run.id });
  console.log(`check-start: ${run.id}`);
  return 0;
}

async function checkFinish(id, root) {
  if (!/^[0-9]+$/.test(id ?? '')) throw new Error('--id must be a number');
  const L = layout(root);
  let summary;
  try {
    summary = JSON.parse(readFileSync(L.summary, 'utf8'));
  } catch {
    summary = makeSummary({ result: 'error', error: 'internal' });
  }
  const { conclusion, output } = checkRunOutput(summary);
  await api('PATCH', `/repos/${process.env.GITHUB_REPOSITORY}/check-runs/${id}`, {
    status: 'completed',
    conclusion,
    output,
  });
  console.log(`check-finish: ${conclusion}`);
  return 0;
}

async function main(argv) {
  const usage = 'usage: tier2.js gate | prepare|check-work|evaluate|cleanup --root DIR | check-start --sha SHA | check-finish --id ID --root DIR';
  const [verb, ...rest] = argv;
  let values;
  try {
    ({ values } = parseArgs({ args: rest, options: { root: { type: 'string' }, sha: { type: 'string' }, id: { type: 'string' } } }));
  } catch {
    console.error(usage);
    return 2;
  }
  const needRoot = ['prepare', 'check-work', 'evaluate', 'cleanup', 'check-finish'];
  if (needRoot.includes(verb) && !values.root) {
    console.error(usage);
    return 2;
  }
  try {
    switch (verb) {
      case 'gate': return await gate();
      case 'prepare':
        prepare(values.root);
        console.log('prepare: done');
        return 0;
      case 'check-work': return checkWorkCmd(values.root);
      case 'evaluate': return await evaluateCmd(values.root);
      case 'cleanup': {
        const r = cleanup(values.root);
        console.log(`cleanup: ${JSON.stringify(r)}`);
        return Object.values(r).includes('failed') ? 1 : 0;
      }
      case 'check-start': return await checkStart(values.sha);
      case 'check-finish': return await checkFinish(values.id, values.root);
      default:
        console.error(usage);
        return 2;
    }
  } catch (e) {
    // Messages here are our own (API status codes, fixed codes); never file contents.
    console.error(`error: ${e instanceof Tier2Error ? e.code : e.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
