import assert from "node:assert/strict";
import { test } from "node:test";

import { parseArgs } from "../src/cli.js";
import { UserError } from "../src/errors.js";

test("defaults", () => {
  const options = parseArgs([]);
  assert.equal(options.remote, "origin");
  assert.equal(options.commit, true);
  assert.equal(options.push, true);
  assert.equal(options.useAi, true);
  assert.equal(options.dryRun, false);
  assert.equal(options.model, "claude-opus-5");
});

test("accepts the pr subcommand", () => {
  assert.equal(parseArgs(["pr", "--dry-run"]).dryRun, true);
});

test("rejects an unknown subcommand", () => {
  assert.throws(() => parseArgs(["ship"]), UserError);
});

test("parses values in both --flag value and --flag=value form", () => {
  assert.equal(parseArgs(["--base", "develop"]).base, "develop");
  assert.equal(parseArgs(["--base=develop"]).base, "develop");
});

test("parses short aliases", () => {
  const options = parseArgs(["-b", "feature", "-m", "wip", "-y"]);
  assert.equal(options.branch, "feature");
  assert.equal(options.commitMessage, "wip");
  assert.equal(options.yes, true);
});

test("negation flags flip their defaults", () => {
  const options = parseArgs(["--no-commit", "--no-push", "--no-ai"]);
  assert.equal(options.commit, false);
  assert.equal(options.push, false);
  assert.equal(options.useAi, false);
});

test("--max-diff-bytes must be a positive integer", () => {
  assert.equal(parseArgs(["--max-diff-bytes", "1000"]).maxDiffBytes, 1000);
  assert.throws(() => parseArgs(["--max-diff-bytes", "0"]), UserError);
  assert.throws(() => parseArgs(["--max-diff-bytes", "lots"]), UserError);
});

test("a value flag without a value is an error", () => {
  assert.throws(() => parseArgs(["--base"]), UserError);
});

test("a boolean flag with a value is an error", () => {
  assert.throws(() => parseArgs(["--draft=true"]), UserError);
});

test("unknown options are rejected", () => {
  assert.throws(() => parseArgs(["--nope"]), UserError);
  assert.throws(() => parseArgs(["nope.txt"]), UserError);
});

test("--body and --body-file are mutually exclusive", () => {
  assert.throws(() => parseArgs(["--body", "x", "--body-file", "y.md"]), UserError);
});

test("--title cannot be empty", () => {
  assert.throws(() => parseArgs(["--title", "  "]), UserError);
});
