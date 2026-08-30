import assert from "node:assert/strict";
import test from "node:test";
import { collectGitHubSource, repositoriesForGitHubSource } from "./github-community.js";
import type { SourceConfig } from "./types.js";

const source: SourceConfig = {
  id: "github-project-community",
  name: "GitHub AI 项目动态",
  kind: "github",
  homepageUrl: "https://github.com/",
  query: "openai/codex invalid anthropics/claude-code openai/codex",
  topicIds: ["ai", "technology"],
  enabled: true,
  selected: true,
  category: "community",
  role: "community",
  discoveryOnly: true,
};

test("GitHub repository configuration is validated, deduplicated and bounded", () => {
  assert.deepEqual(repositoriesForGitHubSource(source), ["openai/codex", "anthropics/claude-code"]);
});

test("GitHub adapter separates official releases from community issues and discussions", async () => {
  const calls: string[] = [];
  const fetcher = async (rawUrl: string | URL) => {
    const url = String(rawUrl);
    calls.push(url);
    if (url.includes("/releases?")) {
      return new Response(JSON.stringify([{
        id: 11,
        name: "v1.2.0",
        tag_name: "v1.2.0",
        html_url: "https://github.com/openai/codex/releases/tag/v1.2.0",
        body: "Adds a documented review workflow.",
        published_at: "2026-08-29T08:00:00.000Z",
        author: { login: "release-bot" },
      }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/issues?")) {
      return new Response(JSON.stringify([{
        id: 22,
        number: 42,
        title: "Review mode loses context",
        html_url: "https://github.com/openai/codex/issues/42",
        body: "A reproducible report with concrete steps.",
        created_at: "2026-08-28T08:00:00.000Z",
        comments: 18,
        user: { login: "practitioner" },
        labels: [{ name: "bug" }],
      }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(`
      <div class="Box-row">
        <a href="/openai/codex/discussions/77">How teams review long sessions</a>
        <relative-time datetime="2026-08-27T08:00:00.000Z"></relative-time>
      </div>
    `, { status: 200, headers: { "content-type": "text/html" } });
  };

  const singleRepoSource = { ...source, query: "openai/codex" };
  const items = await collectGitHubSource(singleRepoSource, {
    fetcher,
    now: () => new Date("2026-08-30T00:00:00.000Z"),
  });

  assert.equal(calls.length, 3);
  assert.equal(items.length, 3);
  const release = items.find((item) => item.metadata?.github_kind === "release");
  const issue = items.find((item) => item.metadata?.github_kind === "issue");
  const discussion = items.find((item) => item.metadata?.github_kind === "discussion");
  assert.equal(release?.metadata?.source_role, "official");
  assert.equal(release?.metadata?.discovery_only, false);
  assert.equal(issue?.metadata?.source_role, "community");
  assert.equal(issue?.metadata?.comment_count, 18);
  assert.equal(discussion?.url, "https://github.com/openai/codex/discussions/77");
  assert.equal(discussion?.metadata?.discovery_only, true);
});

test("one failing GitHub surface is isolated when another surface has evidence", async () => {
  const items = await collectGitHubSource({ ...source, query: "openai/codex" }, {
    fetcher: async (rawUrl) => String(rawUrl).includes("/releases?")
      ? new Response(JSON.stringify([{
        id: 33,
        tag_name: "v2",
        html_url: "https://github.com/openai/codex/releases/tag/v2",
        published_at: "2026-08-30T00:00:00.000Z",
      }]), { status: 200 })
      : new Response("rate limited", { status: 429 }),
  });

  assert.equal(items.length, 1);
  assert.equal(items[0]?.metadata?.github_kind, "release");
});
