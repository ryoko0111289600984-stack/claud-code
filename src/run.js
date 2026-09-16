import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";

import { UserError } from "./errors.js";
import { info, out, step, warn } from "./log.js";
import * as git from "./git.js";
import * as github from "./github.js";
import { generateSummary, slugifyBranch } from "./summarize.js";

export async function run(options, { cwd = process.cwd() } = {}) {
  await git.assertGitRepo(cwd);

  const remote = options.remote;
  const url = await git.remoteUrl(remote, cwd);
  if (!url) {
    throw new UserError(`remote "${remote}" is not configured`, { hint: "add one with `git remote add origin <url>`, or pass --remote" });
  }
  const repo = git.parseGitHubRemote(url);
  if (!repo && !options.dryRun) {
    throw new UserError(`remote "${remote}" (${url}) is not a GitHub repository`, { hint: "jhhzzy opens pull requests on GitHub only" });
  }

  const base = options.base ?? (await git.detectBaseBranch(remote, cwd));
  if (!base) {
    throw new UserError(`could not determine the base branch for ${remote}`, { hint: "pass --base <branch>" });
  }

  const startingBranch = await git.currentBranch(cwd);
  if (startingBranch === "HEAD" && !options.branch) {
    throw new UserError("HEAD is detached", { hint: "check out a branch, or pass --branch <name>" });
  }

  const dirty = await git.hasUncommittedChanges(cwd);
  const willCommit = options.commit && dirty;
  if (dirty && !options.commit) {
    warn("working tree has uncommitted changes; --no-commit means they will not be part of this pull request");
  }

  const baseRef = await resolveBaseRef(base, remote, cwd);
  const committed = await collectCommittedChanges(baseRef, cwd);
  const patch = willCommit ? await combinedPatch(baseRef, cwd) : committed.patch;
  const files = willCommit ? await filesIncludingWorkingTree(baseRef, cwd) : committed.files;

  if (!patch && committed.commits.length === 0) {
    throw new UserError(`no changes between ${base} and the current checkout`, { hint: "commit something, or pass --base to compare against a different branch" });
  }

  const template = repo && !options.dryRun && !(options.body || options.bodyFile)
    ? await github.fetchPullRequestTemplate({ owner: repo.owner, repo: repo.repo, ref: base, token: safeToken() }).catch(() => null)
    : null;

  const explicitBody = options.body ?? (options.bodyFile ? await readFile(options.bodyFile, "utf8") : undefined);
  let summary;
  if (options.title && explicitBody !== undefined) {
    summary = { title: options.title, body: explicitBody, source: "provided" };
  } else {
    step("writing the pull request description");
    summary = await generateSummary({
      commits: committed.commits,
      files,
      stat: committed.stat,
      patch,
      branch: startingBranch === base ? "" : startingBranch,
      template,
      model: options.model,
      maxDiffBytes: options.maxDiffBytes,
      useClaude: options.useAi,
    });
    if (options.title) summary.title = options.title;
    if (explicitBody !== undefined) summary.body = explicitBody;
  }

  const head = options.branch ?? (startingBranch === base ? slugifyBranch(summary.title) : startingBranch);
  if (head === base) {
    throw new UserError(`refusing to open a pull request from ${head} into itself`, { hint: "pass --branch <name>" });
  }

  printPlan({ repo, remote, base, head, summary, willCommit, options });

  if (options.dryRun) {
    info("dry run: nothing was committed, pushed, or opened");
    return { dryRun: true, head, base, summary };
  }

  if (!(await confirm(options))) {
    info("aborted");
    return { aborted: true, head, base, summary };
  }

  if (head !== startingBranch) {
    step(`switching to ${head}`);
    if (await git.branchExists(head, cwd)) await git.checkout(head, cwd);
    else await git.createBranch(head, cwd);
  }

  if (willCommit) {
    step("committing changes");
    await git.stageAll(cwd);
    await git.commit(options.commitMessage ?? summary.title, cwd);
  }

  if (!options.push) {
    info(`not pushing (--no-push); ${head} is ready locally`);
    return { pushed: false, head, base, summary };
  }

  // Resolved before the push so a missing token fails fast, not after a branch is published.
  const token = github.resolveToken();

  step(`pushing ${head} to ${remote}`);
  await git.push(remote, head, {
    cwd,
    onRetry: ({ attempt, delay }) => warn(`push failed (attempt ${attempt}); retrying in ${delay / 1000}s`),
  });

  const existing = await github.findOpenPullRequest({ owner: repo.owner, repo: repo.repo, head, token });
  if (existing) {
    step(`updating existing pull request #${existing.number}`);
    const updated = await github.updatePullRequest({
      owner: repo.owner,
      repo: repo.repo,
      number: existing.number,
      title: summary.title,
      body: summary.body,
      token,
    });
    out(updated.html_url);
    return { pullRequest: updated, head, base, summary, updated: true };
  }

  step("opening the pull request");
  const created = await github.createPullRequest({
    owner: repo.owner,
    repo: repo.repo,
    head,
    base,
    title: summary.title,
    body: summary.body,
    draft: options.draft,
    token,
  });
  out(created.html_url);
  return { pullRequest: created, head, base, summary, updated: false };
}

/** Prefer the remote's copy of the base branch, so the diff is against what the PR will merge into. */
async function resolveBaseRef(base, remote, cwd) {
  const remoteRef = `${remote}/${base}`;
  const exists = await git.git(["rev-parse", "--verify", "--quiet", `refs/remotes/${remoteRef}`], { cwd, allowFailure: true });
  if (exists) return remoteRef;
  const local = await git.branchExists(base, cwd);
  if (local) return base;
  throw new UserError(`base branch ${base} exists neither locally nor on ${remote}`, { hint: `run \`git fetch ${remote} ${base}\`` });
}

async function collectCommittedChanges(baseRef, cwd) {
  const [commits, stat, patch, files] = await Promise.all([
    git.commitSubjects(baseRef, "HEAD", cwd),
    git.diffStat(baseRef, "HEAD", cwd),
    git.diffPatch(baseRef, "HEAD", cwd),
    git.changedFiles(baseRef, "HEAD", cwd),
  ]);
  return { commits, stat, patch, files };
}

async function combinedPatch(baseRef, cwd) {
  const [committed, working] = await Promise.all([git.diffPatch(baseRef, "HEAD", cwd), git.workingTreePatch(cwd)]);
  return [committed, working].filter(Boolean).join("\n");
}

async function filesIncludingWorkingTree(baseRef, cwd) {
  const [committed, changed, untracked] = await Promise.all([
    git.changedFiles(baseRef, "HEAD", cwd),
    git.git(["diff", "--name-only", "HEAD"], { cwd, allowFailure: true }),
    git.git(["ls-files", "--others", "--exclude-standard"], { cwd, allowFailure: true }),
  ]);
  const all = [...committed, ...(changed?.split("\n") ?? []), ...(untracked?.split("\n") ?? [])];
  return [...new Set(all.filter(Boolean))].sort();
}

function safeToken() {
  try {
    return github.resolveToken();
  } catch {
    return undefined;
  }
}

function printPlan({ repo, remote, base, head, summary, willCommit, options }) {
  const target = repo ? `${repo.owner}/${repo.repo}` : remote;
  info("");
  info(`repository : ${target}`);
  info(`base       : ${base}`);
  info(`head       : ${head}`);
  info(`commit     : ${willCommit ? "yes (all changes)" : "no"}`);
  info(`description: ${summary.source}`);
  if (options.draft) info("draft      : yes");
  info("");

  // In a dry run the generated text is the result, so it goes to stdout. Otherwise the
  // pull request URL is the result, and the preview stays on stderr so `jhhzzy | ...` works.
  const write = options.dryRun ? out : info;
  write(`# ${summary.title}`);
  write("");
  for (const line of summary.body.split("\n")) write(line);
  write("");
}

async function confirm(options) {
  if (options.yes || !process.stdin.isTTY) return true;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question("jhhzzy: push and open this pull request? [y/N] ");
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
