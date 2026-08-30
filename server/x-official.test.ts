import assert from "node:assert/strict";
import test from "node:test";
import {
  accountsForXSource,
  applyXSourceCursors,
  collectXOfficialSources,
  createXApiClient,
  type XRecentSearchClient,
} from "./x-official.js";
import type { SourceConfig } from "./types.js";

const source = (id: string, accounts: string): SourceConfig => ({
  id,
  name: "AI 官方 X",
  kind: "x",
  homepageUrl: "https://x.com/",
  query: accounts,
  topicIds: ["ai"],
  enabled: true,
  selected: true,
  category: "ai-official",
  role: "official",
  discoveryOnly: false,
});

test("X cursor persistence advances monotonically and never regresses after overlapping runs", () => {
  const configured = source("x-ai-official", "OpenAI");
  configured.cursor = "400";

  applyXSourceCursors([configured], { "x-ai-official": "399" });
  assert.equal(configured.cursor, "400");
  applyXSourceCursors([configured], { "x-ai-official": "401" });
  assert.equal(configured.cursor, "401");
});

test("X API client uses one authenticated recent-search query for the account whitelist", async () => {
  let requestedUrl = "";
  let authorization = "";
  const client = createXApiClient({
    getBearerToken: async () => "secret-bearer-token",
    fetcher: async (url, init) => {
      requestedUrl = String(url);
      authorization = new Headers(init.headers).get("authorization") ?? "";
      return Response.json({ data: [], meta: { result_count: 0 } });
    },
  });

  await client.searchRecent({ accounts: ["OpenAI", "AnthropicAI"], sinceId: "198" });

  const url = new URL(requestedUrl);
  assert.equal(url.origin, "https://api.x.com");
  assert.equal(url.pathname, "/2/tweets/search/recent");
  assert.equal(url.searchParams.get("query"), "(from:OpenAI OR from:AnthropicAI) -is:retweet -is:reply");
  assert.equal(url.searchParams.get("since_id"), "198");
  assert.equal(url.searchParams.get("max_results"), "100");
  assert.equal(authorization, "Bearer secret-bearer-token");
});

test("X API client turns rate limits into a safe actionable error", async () => {
  const client = createXApiClient({
    getBearerToken: async () => "must-not-leak",
    fetcher: async () => Response.json(
      { title: "Too Many Requests", detail: "rate limit exceeded" },
      { status: 429, headers: { "x-rate-limit-reset": "1788074100" } },
    ),
  });

  await assert.rejects(
    client.searchRecent({ accounts: ["OpenAI"] }),
    (error: unknown) => error instanceof Error
      && /限流/u.test(error.message)
      && !error.message.includes("must-not-leak"),
  );
});

test("X official source admits only configured authors and preserves first-party post evidence", async () => {
  const configured = source("x-ai-official", "@OpenAI, AnthropicAI");
  const client: XRecentSearchClient = {
    searchRecent: async () => ({
      data: [
        {
          id: "200",
          author_id: "user-openai",
          created_at: "2026-08-30T08:00:00.000Z",
          text: "We are releasing Model X today.\nTechnical details: https://example.com/model-x",
          entities: { urls: [{ expanded_url: "https://openai.com/index/model-x" }] },
          public_metrics: { like_count: 900, reply_count: 80, retweet_count: 120, quote_count: 15 },
        },
        {
          id: "199",
          author_id: "unexpected-user",
          created_at: "2026-08-30T07:00:00.000Z",
          text: "Unconfigured account should not enter the official feed.",
        },
        {
          id: "198",
          author_id: "user-openai",
          created_at: "2026-08-30T06:00:00.000Z",
          text: "A reply must not be promoted as a first-party announcement.",
          referenced_tweets: [{ id: "197", type: "replied_to" }],
        },
        {
          id: "196",
          author_id: "user-openai",
          created_at: "2026-08-30T05:00:00.000Z",
          text: "A defensive retweet filter is still required.",
          referenced_tweets: [{ id: "195", type: "retweeted" }],
        },
      ],
      includes: {
        users: [
          { id: "user-openai", username: "OpenAI", name: "OpenAI", verified: true },
          { id: "unexpected-user", username: "random_user", name: "Random", verified: true },
        ],
      },
      meta: { newest_id: "200" },
    }),
  };

  const result = await collectXOfficialSources([configured], { client });

  assert.deepEqual(accountsForXSource(configured), ["OpenAI", "AnthropicAI"]);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.id, "x:200");
  assert.equal(result.items[0]?.url, "https://x.com/OpenAI/status/200");
  assert.equal(result.items[0]?.author, "@OpenAI");
  assert.equal(result.items[0]?.metadata?.source_role, "official");
  assert.equal(result.items[0]?.metadata?.is_official_account, true);
  assert.equal(result.items[0]?.metadata?.like_count, 900);
  assert.equal(result.items[0]?.metadata?.canonical_url, "https://openai.com/index/model-x");
  assert.deepEqual(result.cursors, { "x-ai-official": "200" });
});

test("one X source failure is isolated from another configured official source", async () => {
  const client: XRecentSearchClient = {
    searchRecent: async ({ accounts }) => {
      if (accounts.includes("BrokenAccount")) throw new Error("X API 限流至 09:15");
      return {
        data: [{ id: "300", author_id: "user-1", text: "Official update" }],
        includes: { users: [{ id: "user-1", username: "OpenAI", name: "OpenAI" }] },
        meta: { newest_id: "300" },
      };
    },
  };

  const result = await collectXOfficialSources([
    source("broken", "BrokenAccount"),
    source("healthy", "OpenAI"),
  ], { client });

  assert.equal(result.items.length, 1);
  assert.match(result.failures.broken ?? "", /限流/);
  assert.equal(result.failures.healthy, undefined);
});
