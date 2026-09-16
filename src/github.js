import { UserError } from "./errors.js";

const API_ROOT = process.env.GITHUB_API_URL || "https://api.github.com";

export function resolveToken(env = process.env) {
  const token = env.GITHUB_TOKEN || env.GH_TOKEN || env.JHHZZY_GITHUB_TOKEN;
  if (!token) {
    throw new UserError("no GitHub token found", {
      hint: "export GITHUB_TOKEN (a token with `repo`/`pull_request: write` scope), or pass --dry-run to preview without opening a PR",
    });
  }
  return token;
}

async function request(path, { token, method = "GET", body } = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "jhhzzy-pr-agent",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }

  if (!response.ok) {
    const message = payload?.message || response.statusText;
    const details = Array.isArray(payload?.errors)
      ? ` (${payload.errors.map((e) => e.message || e.code).filter(Boolean).join("; ")})`
      : "";
    throw new UserError(`GitHub API ${method} ${path} → ${response.status}: ${message}${details}`);
  }

  return payload;
}

export function findOpenPullRequest({ owner, repo, head, token }) {
  const query = new URLSearchParams({ head: `${owner}:${head}`, state: "open" });
  return request(`/repos/${owner}/${repo}/pulls?${query}`, { token }).then((prs) => prs?.[0] ?? null);
}

export function createPullRequest({ owner, repo, head, base, title, body, draft, token }) {
  return request(`/repos/${owner}/${repo}/pulls`, {
    token,
    method: "POST",
    body: { head, base, title, body, draft },
  });
}

export function updatePullRequest({ owner, repo, number, title, body, token }) {
  return request(`/repos/${owner}/${repo}/pulls/${number}`, {
    token,
    method: "PATCH",
    body: { title, body },
  });
}

/** Returns the PR template body, or null when the repo has none. */
export async function fetchPullRequestTemplate({ owner, repo, ref, token }) {
  const candidates = [
    ".github/pull_request_template.md",
    ".github/PULL_REQUEST_TEMPLATE.md",
    "PULL_REQUEST_TEMPLATE.md",
    "docs/PULL_REQUEST_TEMPLATE.md",
  ];
  for (const path of candidates) {
    try {
      const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
      const file = await request(`/repos/${owner}/${repo}/contents/${path}${query}`, { token });
      if (file?.content) return Buffer.from(file.content, "base64").toString("utf8");
    } catch {
      // 404 for this candidate - try the next one.
    }
  }
  return null;
}
