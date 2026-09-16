import assert from "node:assert/strict";
import { test } from "node:test";

import { isRetryablePushFailure, parseGitHubRemote } from "../src/git.js";

test("parses every common GitHub remote form", () => {
  const expected = { owner: "acme", repo: "widgets" };
  for (const url of [
    "git@github.com:acme/widgets.git",
    "git@github.com:acme/widgets",
    "ssh://git@github.com/acme/widgets.git",
    "https://github.com/acme/widgets.git",
    "https://github.com/acme/widgets",
    "git://github.com/acme/widgets.git",
    "  https://github.com/acme/widgets  ",
  ]) {
    assert.deepEqual(parseGitHubRemote(url), expected, url);
  }
});

test("returns null for remotes it cannot parse", () => {
  assert.equal(parseGitHubRemote(""), null);
  assert.equal(parseGitHubRemote(null), null);
  assert.equal(parseGitHubRemote("/srv/git/bare.git"), null);
});

test("retries network failures but not rejections", () => {
  for (const stderr of [
    "fatal: unable to access: Could not resolve host: github.com",
    "fatal: the remote end hung up unexpectedly",
    "error: RPC failed; curl 56 Recv failure: Connection reset by peer",
    "ssh: connect to host github.com port 22: Connection timed out",
  ]) {
    assert.equal(isRetryablePushFailure(stderr), true, stderr);
  }

  for (const stderr of [
    "! [rejected] main -> main (non-fast-forward)",
    "remote: Permission denied to user",
    "fatal: Authentication failed for 'https://github.com/acme/widgets'",
    "remote: error: GH006: Protected branch update failed",
  ]) {
    assert.equal(isRetryablePushFailure(stderr), false, stderr);
  }
});
