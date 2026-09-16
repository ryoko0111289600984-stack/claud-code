import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";

import { UserError } from "../src/errors.js";
import { run } from "../src/run.js";

const execFileAsync = promisify(execFile);

let workdir;
let repo;

const git = (args, cwd = repo) => execFileAsync("git", args, { cwd });

before(async () => {
  workdir = await mkdtemp(path.join(tmpdir(), "jhhzzy-"));
  const origin = path.join(workdir, "origin.git");
  repo = path.join(workdir, "repo");

  await execFileAsync("git", ["init", "--bare", "--initial-branch=main", origin]);
  await execFileAsync("git", ["init", "--initial-branch=main", repo]);
  await git(["config", "user.email", "test@example.com"]);
  await git(["config", "user.name", "Test"]);
  // A GitHub-shaped URL so the remote parses, with a local path as the push target.
  await git(["remote", "add", "origin", origin]);
  await git(["remote", "set-url", "--push", "origin", origin]);

  await writeFile(path.join(repo, "README.md"), "# demo\n");
  await git(["add", "-A"]);
  await git(["commit", "-m", "Initial commit"]);
  await git(["push", "-u", "origin", "main"]);
});

after(async () => {
  if (workdir) await rm(workdir, { recursive: true, force: true });
});

test("a dry run on a feature branch summarizes the committed changes", async () => {
  await git(["checkout", "-b", "feature/retry"]);
  await writeFile(path.join(repo, "retry.js"), "export const retry = () => {};\n");
  await git(["add", "-A"]);
  await git(["commit", "-m", "Add a retry helper"]);

  const result = await run(
    { remote: "origin", base: "main", dryRun: true, commit: true, push: true, useAi: false, yes: true },
    { cwd: repo },
  );

  assert.equal(result.dryRun, true);
  assert.equal(result.head, "feature/retry");
  assert.equal(result.base, "main");
  assert.equal(result.summary.title, "Add a retry helper");
  assert.match(result.summary.body, /retry\.js/);
});

test("a dry run on the base branch generates a branch name from the title", async () => {
  await git(["checkout", "main"]);
  await writeFile(path.join(repo, "notes.md"), "notes\n");

  const result = await run(
    { remote: "origin", base: "main", dryRun: true, commit: true, push: true, useAi: false, yes: true },
    { cwd: repo },
  );

  assert.match(result.head, /^jhhzzy\//);
  assert.match(result.summary.body, /notes\.md/);

  await git(["checkout", "--", "."]);
  await rm(path.join(repo, "notes.md"), { force: true });
});

test("an explicit title and body skip generation entirely", async () => {
  await git(["checkout", "feature/retry"]);
  const result = await run(
    {
      remote: "origin",
      base: "main",
      branch: "feature/retry",
      title: "Custom title",
      body: "Custom body",
      dryRun: true,
      commit: true,
      push: true,
      useAi: true,
      yes: true,
    },
    { cwd: repo },
  );

  assert.equal(result.summary.source, "provided");
  assert.equal(result.summary.title, "Custom title");
  assert.equal(result.summary.body, "Custom body");
});

test("a branch with no changes against the base is rejected", async () => {
  await git(["checkout", "main"]);
  await assert.rejects(
    run({ remote: "origin", base: "main", dryRun: true, commit: true, push: true, useAi: false, yes: true }, { cwd: repo }),
    (error) => error instanceof UserError && /no changes between main/.test(error.message),
  );
});

test("a head that equals the base is rejected", async () => {
  await git(["checkout", "feature/retry"]);
  await assert.rejects(
    run(
      { remote: "origin", base: "main", branch: "main", dryRun: true, commit: true, push: true, useAi: false, yes: true },
      { cwd: repo },
    ),
    (error) => error instanceof UserError && /into itself/.test(error.message),
  );
});

test("a missing remote is reported as a user error", async () => {
  const bare = await mkdtemp(path.join(tmpdir(), "jhhzzy-bare-"));
  await execFileAsync("git", ["init", "--initial-branch=main", bare]);
  await assert.rejects(
    run({ remote: "origin", dryRun: true, commit: true, push: true, useAi: false, yes: true }, { cwd: bare }),
    (error) => error instanceof UserError && /is not configured/.test(error.message),
  );
  await rm(bare, { recursive: true, force: true });
});

test("a directory that is not a git repository is reported as a user error", async () => {
  const plain = await mkdtemp(path.join(tmpdir(), "jhhzzy-plain-"));
  await assert.rejects(
    run({ remote: "origin", dryRun: true, commit: true, push: true, useAi: false, yes: true }, { cwd: plain }),
    (error) => error instanceof UserError && /not a git repository/.test(error.message),
  );
  await rm(plain, { recursive: true, force: true });
});
