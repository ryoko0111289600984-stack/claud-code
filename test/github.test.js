import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { UserError } from "../src/errors.js";
import {
  createPullRequest,
  fetchPullRequestTemplate,
  findOpenPullRequest,
  resolveToken,
  updatePullRequest,
} from "../src/github.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const { status = 200, body = {} } = (await handler({ url: String(url), init })) ?? {};
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return calls;
}

test("resolveToken prefers GITHUB_TOKEN and accepts the aliases", () => {
  assert.equal(resolveToken({ GITHUB_TOKEN: "a", GH_TOKEN: "b" }), "a");
  assert.equal(resolveToken({ GH_TOKEN: "b" }), "b");
  assert.equal(resolveToken({ JHHZZY_GITHUB_TOKEN: "c" }), "c");
  assert.throws(() => resolveToken({}), UserError);
});

test("createPullRequest posts the expected payload", async () => {
  const calls = stubFetch(() => ({ body: { html_url: "https://github.com/acme/widgets/pull/7", number: 7 } }));

  const pr = await createPullRequest({
    owner: "acme",
    repo: "widgets",
    head: "feature",
    base: "main",
    title: "Add retry",
    body: "Body",
    draft: true,
    token: "t",
  });

  assert.equal(pr.number, 7);
  assert.equal(calls[0].init.method, "POST");
  assert.match(calls[0].url, /\/repos\/acme\/widgets\/pulls$/);
  assert.equal(calls[0].init.headers.authorization, "Bearer t");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    head: "feature",
    base: "main",
    title: "Add retry",
    body: "Body",
    draft: true,
  });
});

test("updatePullRequest patches the numbered pull request", async () => {
  const calls = stubFetch(() => ({ body: { number: 7 } }));
  await updatePullRequest({ owner: "acme", repo: "widgets", number: 7, title: "T", body: "B", token: "t" });
  assert.equal(calls[0].init.method, "PATCH");
  assert.match(calls[0].url, /\/repos\/acme\/widgets\/pulls\/7$/);
});

test("findOpenPullRequest queries by owner-qualified head and returns the first match", async () => {
  const calls = stubFetch(() => ({ body: [{ number: 3 }] }));
  const pr = await findOpenPullRequest({ owner: "acme", repo: "widgets", head: "feature", token: "t" });
  assert.equal(pr.number, 3);
  assert.match(calls[0].url, /head=acme%3Afeature/);
  assert.match(calls[0].url, /state=open/);
});

test("findOpenPullRequest returns null when there is no open pull request", async () => {
  stubFetch(() => ({ body: [] }));
  assert.equal(await findOpenPullRequest({ owner: "acme", repo: "widgets", head: "feature", token: "t" }), null);
});

test("API errors become UserErrors carrying status and message", async () => {
  stubFetch(() => ({ status: 422, body: { message: "Validation Failed", errors: [{ message: "No commits between" }] } }));
  await assert.rejects(
    createPullRequest({ owner: "acme", repo: "widgets", head: "f", base: "main", title: "t", body: "b", token: "t" }),
    (error) => error instanceof UserError && /422: Validation Failed \(No commits between\)/.test(error.message),
  );
});

test("fetchPullRequestTemplate decodes the first candidate that exists", async () => {
  const calls = stubFetch(({ url }) => {
    if (url.includes(".github/pull_request_template.md")) return { status: 404, body: { message: "Not Found" } };
    return { body: { content: Buffer.from("## Why\n").toString("base64") } };
  });

  const template = await fetchPullRequestTemplate({ owner: "acme", repo: "widgets", ref: "main", token: "t" });
  assert.equal(template, "## Why\n");
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /ref=main$/);
});

test("fetchPullRequestTemplate returns null when the repo has no template", async () => {
  stubFetch(() => ({ status: 404, body: { message: "Not Found" } }));
  assert.equal(await fetchPullRequestTemplate({ owner: "acme", repo: "widgets", token: "t" }), null);
});
