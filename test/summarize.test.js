import assert from "node:assert/strict";
import { test } from "node:test";

import { buildDiffContext, describeFailure, heuristicSummary, slugifyBranch, summarizeWithClaude } from "../src/summarize.js";

test("the diff context carries commits, files, stat and patch", () => {
  const { text, truncated } = buildDiffContext({
    commits: ["Add retry"],
    files: ["src/git.js"],
    stat: " src/git.js | 4 ++++",
    patch: "diff --git a/src/git.js b/src/git.js",
  });
  assert.equal(truncated, false);
  assert.match(text, /Add retry/);
  assert.match(text, /src\/git\.js/);
  assert.match(text, /```diff/);
});

test("an oversized diff is truncated and reported", () => {
  const { text, truncated } = buildDiffContext({ patch: "x".repeat(500), maxDiffBytes: 100 });
  assert.equal(truncated, true);
  assert.match(text, /cut off at 100 bytes/);
  assert.ok(text.length < 500);
});

test("the heuristic summary uses the first commit subject as the title", () => {
  const summary = heuristicSummary({ commits: ["Add retry to push", "Fix typo"], files: ["src/git.js"] });
  assert.equal(summary.title, "Add retry to push");
  assert.equal(summary.source, "heuristic");
  assert.match(summary.body, /- Fix typo/);
  assert.match(summary.body, /## Testing/);
});

test("the heuristic summary falls back to the branch name", () => {
  const summary = heuristicSummary({ commits: [], files: [], branch: "feature/add-retry_logic" });
  assert.equal(summary.title, "Add retry logic");
});

test("the heuristic title stays within 72 characters", () => {
  const summary = heuristicSummary({ commits: ["z".repeat(200)], files: [] });
  assert.equal(summary.title.length, 72);
});

test("the heuristic summary lists at most 20 files", () => {
  const files = Array.from({ length: 25 }, (_, i) => `src/file${i}.js`);
  const summary = heuristicSummary({ commits: [], files });
  assert.match(summary.body, /…and 5 more/);
});

test("branch slugs are filesystem- and git-safe", () => {
  const branch = slugifyBranch("Add retry & backoff to `git push`!");
  assert.match(branch, /^jhhzzy\/add-retry-backoff-to-git-push-\d{8}$/);
});

test("a title with nothing sluggable still produces a branch", () => {
  assert.match(slugifyBranch("!!!"), /^jhhzzy\/change-\d{8}$/);
});

test("summarizeWithClaude returns the parsed title and body", async () => {
  const client = {
    messages: {
      parse: async (request) => {
        assert.equal(request.model, "claude-opus-5");
        assert.deepEqual(request.thinking, { type: "adaptive" });
        assert.equal(request.output_config.format.type, "json_schema");
        return { stop_reason: "end_turn", parsed_output: { title: " Add retry ", body: " Body " } };
      },
    },
  };
  const summary = await summarizeWithClaude({ diffContext: "diff", client });
  assert.deepEqual(summary, { title: "Add retry", body: "Body", source: "claude:claude-opus-5" });
});

test("summarizeWithClaude returns null on a refusal", async () => {
  const client = {
    messages: {
      parse: async () => ({ stop_reason: "refusal", stop_details: { category: "cyber" }, parsed_output: null }),
    },
  };
  assert.equal(await summarizeWithClaude({ diffContext: "diff", client }), null);
});

test("summarizeWithClaude returns null when the response does not parse", async () => {
  const client = { messages: { parse: async () => ({ stop_reason: "end_turn", parsed_output: null }) } };
  assert.equal(await summarizeWithClaude({ diffContext: "diff", client }), null);
});

test("summarizeWithClaude returns null when the API call throws", async () => {
  const client = { messages: { parse: async () => { throw new Error("401 unauthorized"); } } };
  assert.equal(await summarizeWithClaude({ diffContext: "diff", client }), null);
});

test("a pull request template is passed to the model as a layout", async () => {
  let prompt = "";
  const client = {
    messages: {
      parse: async (request) => {
        prompt = request.messages[0].content;
        return { stop_reason: "end_turn", parsed_output: { title: "t", body: "b" } };
      },
    },
  };
  await summarizeWithClaude({ diffContext: "diff", template: "## Why\n## How", client });
  assert.match(prompt, /<pull_request_template>/);
  assert.match(prompt, /## Why/);
});

test("a generic branch name does not become the title", () => {
  const summary = heuristicSummary({ commits: [], files: ["src/add.js"], branch: "main" });
  assert.equal(summary.title, "Update add.js");
});

test("several files with no commits give a counted title", () => {
  const summary = heuristicSummary({ commits: [], files: ["a.js", "b.js", "c.js"], branch: "" });
  assert.equal(summary.title, "Update 3 files");
});

test("no commits and no files still produce a title", () => {
  assert.equal(heuristicSummary({ commits: [], files: [], branch: "" }).title, "Update project files");
});

test("auth failures get an actionable message", () => {
  assert.match(describeFailure(new Error("401 unauthorized")), /set ANTHROPIC_API_KEY/);
  assert.match(
    describeFailure(new Error("Could not resolve authentication method. Expected one of apiKey...")),
    /set ANTHROPIC_API_KEY/,
  );
  assert.match(describeFailure(new Error("529 overloaded")), /529 overloaded/);
});
