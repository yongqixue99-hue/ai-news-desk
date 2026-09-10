import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultState } from "./defaults.js";
import { buildTopicFeed, retainZhihuTopic } from "./topic-feeds.js";
import { buildTodayView } from "./story-desk.js";

const now = "2026-09-09T03:00:00.000Z";
const item = { id: "123", rank: 29, title: "AI 工具如何改变工作？", url: "https://www.zhihu.com/question/123", heat: "80 万热度", answers: 100 };

test("saving a hot topic is idempotent, retains rank and never fabricates factual evidence or samples", () => {
  const state = createDefaultState();
  const first = retainZhihuTopic(state, item, now, now);
  const again = retainZhihuTopic(state, item, now, now);
  assert.deepEqual(first, again);
  assert.equal(state.runs.length, 1);
  const candidate = state.runs[0]!.candidates[0]!;
  assert.equal(candidate.publicationDateKnown, false);
  assert.equal(candidate.excerpt, "");
  assert.equal(candidate.scoreBreakdown.evidence, 0);
  assert.equal(candidate.hotlist?.rank, 29);
  const today = buildTodayView(state, now);
  assert.equal(today.pending?.length, 1);
  assert.equal(today.watching.some((story) => story.id === today.pending?.[0]?.id), false);
  assert.equal(today.pending?.[0]?.communitySampleCount, 0);
  assert.equal(today.pending?.[0]?.assignment.canDraft, false);
});

test("platform lists retain their own signals even when they link to another platform", () => {
  const state = createDefaultState();
  retainZhihuTopic(state, item, now, now);
  const base = state.runs[0]!.candidates[0]!;
  state.runs[0]!.candidates.push({ ...base, id: "hn-1", sourceType: "hackernews", sourceName: "Hacker News", url: "https://github.com/acme/model", title: "A useful AI project", selected: false, engagement: { points: 23, comments: 6, discussionUrl: "https://news.ycombinator.com/item?id=12" } });
  assert.equal(buildTopicFeed(state, "hackernews", undefined, now).items.length, 1);
  assert.equal(buildTopicFeed(state, "github", undefined, now).items.length, 0);
  const zhihu = buildTopicFeed(state, "zhihu", { status: "ready", items: [item], capturedAt: now }, now);
  assert.equal(zhihu.items[0]?.rank, 29);
  assert.equal(zhihu.items[0]?.metric, "80 万热度 · 100 个回答");
  assert.equal(zhihu.items[0]?.selected, true);
});

test("platform empty states distinguish unread, failed and successful collection by actual source identity", () => {
  const state = createDefaultState();
  assert.equal(buildTopicFeed(state, "hackernews", undefined, now).status, "unread");
  retainZhihuTopic(state, item, now, now);
  const run = state.runs[0]!;
  run.candidates = [];
  run.sourceResults = [{ sourceId: "hackernews", sourceName: "HN", status: "error", healthImpact: "failure", rawCount: 0, candidateCount: 0, detail: "本次来源读取失败" }];
  const failed = buildTopicFeed(state, "hackernews", undefined, now);
  assert.equal(failed.status, "unavailable");
  assert.equal(failed.error, "本次来源读取失败");
  run.sourceResults[0] = { ...run.sourceResults[0]!, status: "healthy", healthImpact: "success" };
  assert.equal(buildTopicFeed(state, "hackernews", undefined, now).status, "empty");
  run.sourceResults[0] = { ...run.sourceResults[0]!, sourceId: "github-official" };
  assert.equal(buildTopicFeed(state, "github", undefined, now).status, "unread", "GitHub blog is not a project feed");
  const v2ex = state.sources.find(source => source.id === "v2ex-community")!;
  v2ex.id = "custom-source-id";
  run.sourceResults[0] = { ...run.sourceResults[0]!, sourceId: v2ex.id };
  assert.equal(buildTopicFeed(state, "v2ex", undefined, now).status, "empty", "custom ids retain the configured platform identity");
});

test("platform display uses the full evidence pool without replacing the platform permalink", () => {
  const state = createDefaultState(); retainZhihuTopic(state, item, now, now);
  const base = state.runs[0]!.candidates[0]!;
  state.runs[0]!.candidates = [
    { ...base, id: "hn", title: "Example launches AI model", sourceType: "hackernews", sourceName: "Hacker News", url: "https://example.com/model", engagement: { points: 0, discussionUrl: "https://news.ycombinator.com/item?id=42" } },
    { ...base, id: "official", title: "Example launches AI model", sourceRole: "official", sourceType: "rss", sourceName: "Example", url: "https://example.com/model", engagement: undefined },
  ];
  const entry = buildTopicFeed(state, "hackernews", undefined, now).items[0]!;
  assert.equal(entry.discussionUrl, "https://news.ycombinator.com/item?id=42");
  assert.equal(entry.supportingSources?.[0]?.candidateId, "official");
});
