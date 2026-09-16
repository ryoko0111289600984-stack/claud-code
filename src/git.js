import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { UserError } from "./errors.js";

const execFileAsync = promisify(execFile);

// A diff can easily exceed the default 1MB pipe buffer.
const MAX_BUFFER = 64 * 1024 * 1024;

export async function git(args, { cwd = process.cwd(), allowFailure = false } = {}) {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: MAX_BUFFER });
    return stdout.trimEnd();
  } catch (error) {
    if (allowFailure) return null;
    const detail = (error.stderr || error.message || "").trim();
    throw new UserError(`git ${args.join(" ")} failed: ${detail}`);
  }
}

export async function assertGitRepo(cwd) {
  const inside = await git(["rev-parse", "--is-inside-work-tree"], { cwd, allowFailure: true });
  if (inside !== "true") {
    throw new UserError(`not a git repository: ${cwd}`, {
      hint: "run jhhzzy from inside a git working tree",
    });
  }
}

export function currentBranch(cwd) {
  return git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
}

export async function branchExists(branch, cwd) {
  const ref = await git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], {
    cwd,
    allowFailure: true,
  });
  return ref !== null;
}

/**
 * Resolve the base branch: whatever `origin/HEAD` points at, falling back to the
 * first of main/master that exists on the remote.
 */
export async function detectBaseBranch(remote, cwd) {
  const symref = await git(["symbolic-ref", "--short", `refs/remotes/${remote}/HEAD`], {
    cwd,
    allowFailure: true,
  });
  if (symref) return symref.replace(new RegExp(`^${remote}/`), "");

  for (const candidate of ["main", "master"]) {
    const exists = await git(["rev-parse", "--verify", "--quiet", `refs/remotes/${remote}/${candidate}`], {
      cwd,
      allowFailure: true,
    });
    if (exists) return candidate;
  }
  return null;
}

export async function hasUncommittedChanges(cwd) {
  const status = await git(["status", "--porcelain"], { cwd });
  return status.length > 0;
}

export async function hasStagedChanges(cwd) {
  const staged = await git(["diff", "--cached", "--name-only"], { cwd });
  return staged.length > 0;
}

export async function stageAll(cwd) {
  await git(["add", "-A"], { cwd });
}

export async function commit(message, cwd) {
  await git(["commit", "-m", message], { cwd });
}

export async function createBranch(branch, cwd) {
  await git(["checkout", "-b", branch], { cwd });
}

export async function checkout(branch, cwd) {
  await git(["checkout", branch], { cwd });
}

export async function fetch(remote, branch, cwd) {
  await git(["fetch", remote, branch], { cwd });
}

export function remoteUrl(remote, cwd) {
  return git(["remote", "get-url", remote], { cwd, allowFailure: true });
}

/** Commits on `head` that are not on `base`, oldest first. */
export async function commitSubjects(base, head, cwd) {
  const log = await git(["log", "--no-merges", "--reverse", "--format=%s", `${base}..${head}`], {
    cwd,
    allowFailure: true,
  });
  if (!log) return [];
  return log.split("\n").filter(Boolean);
}

export async function diffStat(base, head, cwd) {
  return (await git(["diff", "--stat", `${base}...${head}`], { cwd, allowFailure: true })) ?? "";
}

export async function diffPatch(base, head, cwd) {
  return (await git(["diff", `${base}...${head}`], { cwd, allowFailure: true })) ?? "";
}

export async function changedFiles(base, head, cwd) {
  const files = await git(["diff", "--name-only", `${base}...${head}`], { cwd, allowFailure: true });
  if (!files) return [];
  return files.split("\n").filter(Boolean);
}

/** Uncommitted work, for previewing a PR before anything is committed. */
export async function workingTreePatch(cwd) {
  const tracked = (await git(["diff", "HEAD"], { cwd, allowFailure: true })) ?? "";
  const untracked = (await git(["ls-files", "--others", "--exclude-standard"], { cwd })) || "";
  const names = untracked.split("\n").filter(Boolean);
  if (names.length === 0) return tracked;
  const listed = names.map((name) => `+++ b/${name} (new file)`).join("\n");
  return `${tracked}\n${listed}`.trim();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `git push -u origin <branch>`, retrying transient network failures with
 * exponential backoff (2s, 4s, 8s, 16s).
 */
export async function push(remote, branch, { cwd = process.cwd(), attempts = 5, onRetry } = {}) {
  const delays = [2000, 4000, 8000, 16000];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await execFileAsync("git", ["push", "-u", remote, branch], { cwd, maxBuffer: MAX_BUFFER });
      return;
    } catch (error) {
      const detail = (error.stderr || error.message || "").trim();
      const last = attempt === attempts - 1;
      if (last || !isRetryablePushFailure(detail)) {
        throw new UserError(`git push failed: ${detail}`);
      }
      const delay = delays[Math.min(attempt, delays.length - 1)];
      onRetry?.({ attempt: attempt + 1, delay, detail });
      await sleep(delay);
    }
  }
}

/** Only network-ish failures are worth retrying; a rejected push will stay rejected. */
export function isRetryablePushFailure(stderr) {
  const text = stderr.toLowerCase();
  if (/\[rejected\]|non-fast-forward|permission denied|authentication failed|protected branch/.test(text)) {
    return false;
  }
  return /could not resolve host|connection (timed out|reset|refused)|network is unreachable|failed to connect|rpc failed|early eof|unexpected disconnect|ssl_error|timed out|temporary failure in name resolution|the remote end hung up/.test(
    text,
  );
}

/** Parse `owner/repo` out of any GitHub remote URL form. */
export function parseGitHubRemote(url) {
  if (!url) return null;
  const trimmed = url.trim().replace(/\.git$/, "");
  const patterns = [
    /^git@[^:]+:([^/]+)\/(.+)$/, // git@github.com:owner/repo
    /^ssh:\/\/git@[^/]+\/([^/]+)\/(.+)$/, // ssh://git@github.com/owner/repo
    /^https?:\/\/[^/]+\/([^/]+)\/(.+)$/, // https://github.com/owner/repo
    /^git:\/\/[^/]+\/([^/]+)\/(.+)$/, // git://github.com/owner/repo
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) {
      const [, owner, repo] = match;
      if (!owner || !repo || repo.includes("/")) continue;
      return { owner, repo };
    }
  }
  return null;
}
