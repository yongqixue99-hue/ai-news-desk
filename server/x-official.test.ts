import assert from "node:assert/strict";
import test from "node:test";
import {
  accountsForXSource,
  applyXSourceCursors,
  collectXOfficialSources,
  createXApiClient,
  type XRecentSearchClient,
} from "./x-official.js";
import { rawItemToCandidate, sortCandidates } from "./scoring.js";
import { defaultSources } from "./defaults.js";
import { createSourceDesk } from "./source-desk.js";
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

test("the default X watchlist contains the nine reviewed accounts but remains opt-in", () => {
  const configured = defaultSources.find((entry) => entry.id === "x-ai-official");
  assert.ok(configured);
  assert.equal(configured.enabled, false);
  assert.equal(configured.selected, false);
  assert.deepEqual(accountsForXSource(configured), [
    "OpenAI",
    "AnthropicAI",
    "GoogleDeepMind",
    "nvidia",
    "AIatMeta",
    "MicrosoftAI",
    "xai",
    "sama",
    "demishassabis",
  ]);
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
  assert.match(url.searchParams.get("tweet.fields") ?? "", /(?:^|,)attachments(?:,|$)/u);
  assert.equal(url.searchParams.get("expansions"), "author_id,attachments.media_keys");
  assert.equal(
    url.searchParams.get("media.fields"),
    "media_key,type,url,preview_image_url,width,height,alt_text",
  );
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

test("an unconfigured X token fails before any network request", async () => {
  let requested = false;
  const client = createXApiClient({
    getBearerToken: async () => "   ",
    fetcher: async () => {
      requested = true;
      return Response.json({ data: [] });
    },
  });

  await assert.rejects(client.searchRecent({ accounts: ["OpenAI"] }), /尚未配置 X API Bearer Token/u);
  assert.equal(requested, false);
});

test("an unconfigured X token does not discard RSS records collected in the same batch", async () => {
  const xSource = source("x-ai-official", "OpenAI");
  const rssSource: SourceConfig = {
    ...source("rss-official", ""),
    kind: "rss",
    query: undefined,
  };
  const client = createXApiClient({ getBearerToken: async () => "" });
  const desk = createSourceDesk({
    collectStructured: async () => ({
      items: [{
        id: "rss:official:1",
        source_type: "rss",
        title: "RSS survives an optional X failure",
        url: "https://example.com/rss-story",
        published_at: "2026-08-30T08:00:00.000Z",
      }],
    }),
    collectXOfficial: (sources, options) => collectXOfficialSources(sources, { client, signal: options.signal }),
  });

  const batch = await desk.collect({ sources: [rssSource, xSource], topicIds: ["ai"] });

  assert.deepEqual(batch.items.map((entry) => entry.id), ["rss:official:1"]);
  assert.match(batch.failures[xSource.id] ?? "", /尚未配置 X API Bearer Token/u);
  assert.equal(batch.failures[rssSource.id], undefined);
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
          text: "We are releasing a new AI model, Model X, today.\nTechnical details: https://example.com/model-x",
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
  const xCandidate = rawItemToCandidate(result.items[0]!, 24);
  assert.deepEqual(xCandidate.engagement, {
    points: 1_035,
    comments: 80,
    discussionUrl: "https://x.com/OpenAI/status/200",
  });
  const [rankedCandidate] = sortCandidates([xCandidate]);
  assert.ok(rankedCandidate.heatBreakdown.engagement > 0);
  assert.deepEqual(result.cursors, { "x-ai-official": "200" });
});

test("X post photos and video previews become rights-gated candidate source images", async () => {
  const configured = source("x-ai-official", "OpenAI");
  const client: XRecentSearchClient = {
    searchRecent: async () => ({
      data: [{
        id: "media-200",
        author_id: "user-openai",
        created_at: "2026-08-30T08:00:00.000Z",
        text: "A visual product update",
        attachments: { media_keys: ["photo-1", "video-1"] },
      }],
      includes: {
        users: [{ id: "user-openai", username: "OpenAI", name: "OpenAI" }],
        media: [
          {
            media_key: "photo-1",
            type: "photo",
            url: "https://pbs.twimg.com/media/photo-1.jpg",
            width: 1600,
            height: 900,
            alt_text: "OpenAI product interface",
          },
          {
            media_key: "video-1",
            type: "video",
            preview_image_url: "https://pbs.twimg.com/ext_tw_video_thumb/video-1.jpg",
            width: 1280,
            height: 720,
          },
          {
            media_key: "unattached-photo",
            type: "photo",
            url: "https://pbs.twimg.com/media/unattached.jpg",
          },
        ],
      },
    }),
  };

  const result = await collectXOfficialSources([configured], { client });
  const candidate = rawItemToCandidate(result.items[0]!, 24);

  assert.equal(candidate.imageCount, 2);
  assert.deepEqual(candidate.images.map((image) => ({
    url: image.url,
    caption: image.caption,
    attribution: image.attribution,
    sourceUrl: image.sourceUrl,
    rights: image.rights,
    selected: image.selected,
  })), [
    {
      url: "https://pbs.twimg.com/media/photo-1.jpg",
      caption: "OpenAI product interface",
      attribution: "@OpenAI",
      sourceUrl: "https://x.com/OpenAI/status/media-200",
      rights: "check-required",
      selected: false,
    },
    {
      url: "https://pbs.twimg.com/ext_tw_video_thumb/video-1.jpg",
      caption: "@OpenAI 发布的 X 视频预览图",
      attribution: "@OpenAI",
      sourceUrl: "https://x.com/OpenAI/status/media-200",
      rights: "check-required",
      selected: false,
    },
  ]);
});

test("an X response without media remains a valid text candidate with an empty image list", async () => {
  const configured = source("x-ai-official", "OpenAI");
  const client: XRecentSearchClient = {
    searchRecent: async () => ({
      data: [{
        id: "text-only-200",
        author_id: "user-openai",
        created_at: "2026-08-30T08:00:00.000Z",
        text: "A text-only official update",
      }],
      includes: { users: [{ id: "user-openai", username: "OpenAI", name: "OpenAI" }] },
    }),
  };

  const result = await collectXOfficialSources([configured], { client });
  const candidate = rawItemToCandidate(result.items[0]!, 24);

  assert.equal(result.failures[configured.id], undefined);
  assert.equal(candidate.imageCount, 0);
  assert.deepEqual(candidate.images, []);
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
