import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { createDefaultState } from "./defaults.js";
import { buildStories, buildTodayView } from "./story-desk.js";
import type { Candidate, WorkflowRun } from "./types.js";

const imageFixtureRoot = mkdtempSync(path.join(tmpdir(), "ai-news-story-images-"));
after(() => rmSync(imageFixtureRoot, { recursive: true, force: true }));

const imageFixture = (name: string) => {
  const localPath = path.join(imageFixtureRoot, name);
  writeFileSync(localPath, Buffer.from("image-bytes"));
  return localPath;
};

const candidate = (id: string, overrides: Partial<Candidate> = {}): Candidate => ({
  id,
  rawId: id,
  sourceType: "rss",
  sourceName: "Official",
  sourceRole: "official",
  title: "Acme releases Model X",
  url: "https://acme.example/model-x",
  canonicalUrl: "https://acme.example/model-x",
  excerpt: "Acme released Model X with a documented API and public weights.",
  publishedAt: "2026-08-30T01:00:00.000Z",
  fetchedAt: "2026-08-30T01:05:00.000Z",
  score: 12,
  scoreBreakdown: { consequence: 3, novelty: 3, evidence: 3, relevance: 1, timeliness: 2, confirmation: 0, penalty: 0 },
  heatScore: 0,
  heatBreakdown: { engagement: 0, sourceReach: 0, crossSource: 0, freshness: 0 },
  recommendationScore: 80,
  clusterSize: 1,
  relatedSources: ["Official"],
  evidence: "一手来源",
  briefing: {
    titleZh: "Acme 发布 Model X",
    summaryZh: "Acme 发布了 Model X，并同步开放 API 与权重。",
    basis: "full-source",
    generatedAt: "2026-08-30T01:10:00.000Z",
    providerId: "codex",
    explanation: {
      voiceVersion: 2,
      whatHappenedZh: "Acme 正式发布 Model X，并在同一天开放模型 API 和公开权重。",
      readerBriefZh: "Acme 发布了 Model X，API 和公开权重在同一天开放。生产环境是否稳定，还要等开发者实测。",
      keyPointsZh: ["开发者可以调用公开 API。", "模型权重允许本地测试。"],
      whyItMattersZh: "开发者可以比较托管 API 与本地部署两种使用方式。",
      affectedZh: "需要评估模型部署方式的 AI 开发者。",
      editorNoteZh: "API 和权重都已开放，可以写一篇简短发布稿。",
      unknownsZh: ["真实生产负载下的稳定性仍需验证。"],
    },
  },
  imageCount: 0,
  images: [],
  selected: false,
  status: "candidate",
  topicIds: ["ai"],
  ...overrides,
});

const run = (id: string, candidates: Candidate[]): WorkflowRun => ({
  id,
  createdAt: "2026-08-30T01:05:00.000Z",
  updatedAt: "2026-08-30T01:05:00.000Z",
  status: "ready",
  stage: "完成",
  windowHours: 24,
  sourceIds: [],
  scheduled: false,
  rawCount: candidates.length,
  candidates,
  logs: [],
});

test("StoryDesk merges official, news and community signals into one story", () => {
  const state = createDefaultState();
  state.runs = [run("run-1", [
    candidate("official"),
    candidate("news", {
      sourceName: "Newsroom",
      sourceRole: "verification",
      url: "https://news.example/acme-model-x",
      canonicalUrl: "https://news.example/acme-model-x",
      title: "Acme launches its Model X API and weights",
    }),
    candidate("community", {
      sourceType: "hackernews",
      sourceName: "Hacker News",
      sourceRole: "community",
      url: "https://acme.example/model-x",
      engagement: { points: 220, comments: 80, discussionUrl: "https://news.ycombinator.com/item?id=1" },
      excerpt: "--- Top Comments --- [alice]: This is a detailed practitioner response about deployment tradeoffs and API reliability. [bob]: Another concrete response about model weights and local testing. [c]: A third useful comment about latency and cost. [d]: A fourth comment about integration. [e]: A fifth comment about operational experience.",
      communityInsight: {
        summaryZh: "讨论主要集中在部署成本和 API 稳定性。",
        focusZh: ["本地部署成本", "API 稳定性"],
        basis: "discussion-excerpt",
        generatedAt: "2026-08-30T01:10:00.000Z",
        providerId: "codex",
      },
    }),
  ])];

  const stories = buildStories(state, "2026-08-30T02:00:00.000Z");
  assert.equal(stories.length, 1);
  assert.equal(stories[0]?.factSourceCount, 2);
  assert.equal(stories[0]?.communitySourceCount, 1);
  assert.equal(stories[0]?.assignment.mode, "community");
  assert.equal(stories[0]?.communitySummary, "讨论主要集中在部署成本和 API 稳定性。");
  assert.equal(stories[0]?.explanation.status, "ready");
  assert.equal(stories[0]?.explanation.voiceVersion, 2);
  assert.equal(stories[0]?.explanation.readerBrief, "Acme 发布了 Model X，API 和公开权重在同一天开放。生产环境是否稳定，还要等开发者实测。");
  assert.equal(stories[0]?.explanation.editorNote, "API 和权重都已开放，可以写一篇简短发布稿。");
  assert.equal(stories[0]?.explanation.whatHappened, "Acme 正式发布 Model X，并在同一天开放模型 API 和公开权重。");
  assert.deepEqual(stories[0]?.explanation.keyPoints, ["开发者可以调用公开 API。", "模型权重允许本地测试。"]);
  assert.equal(stories[0]?.explanation.sources.length, 2);
});

test("weak community-only signals stay in watch instead of becoming a draft", () => {
  const state = createDefaultState();
  state.runs = [run("run-1", [candidate("community", {
    sourceType: "hackernews",
    sourceName: "Hacker News",
    sourceRole: "community",
    engagement: { comments: 100, points: 300, discussionUrl: "https://news.ycombinator.com/item?id=2" },
    briefing: { titleZh: "社区流传一条未经核验的消息", summaryZh: "目前只有社区标题。", basis: "title", generatedAt: "2026-08-30T01:10:00.000Z", providerId: "codex" },
  })])];

  const today = buildTodayView(state, "2026-08-30T02:00:00.000Z");
  assert.equal(today.mustReads.length, 0);
  assert.equal(today.watching[0]?.assignment.mode, "watch");
  assert.match(today.watching[0]?.assignment.blockers[0] ?? "", /证据不足/u);
  assert.equal(today.watching[0]?.explanation.status, "partial");
  assert.equal(today.watching[0]?.explanation.basis, "title");
  assert.match(today.watching[0]?.explanation.unknowns[0] ?? "", /只有标题级证据/u);
});

test("legacy fixed-field explanations remain readable but request a v2 editorial refresh", () => {
  const state = createDefaultState();
  state.runs = [run("run-1", [candidate("legacy", {
    briefing: {
      titleZh: "Acme 发布 Model X",
      summaryZh: "Acme 发布了 Model X。",
      basis: "full-source",
      generatedAt: "2026-08-30T01:10:00.000Z",
      providerId: "codex",
      explanation: {
        whatHappenedZh: "Acme 发布了 Model X，并开放 API。",
        keyPointsZh: ["API 已经开放。"],
        whyItMattersZh: "开发者可以开始测试。",
        unknownsZh: ["价格尚未说明。"],
      },
    },
  })])];

  const story = buildStories(state, "2026-08-30T02:00:00.000Z")[0];
  assert.equal(story?.explanation.status, "partial");
  assert.equal(story?.explanation.voiceVersion, 1);
  assert.equal(story?.explanation.readerBrief, "Acme 发布了 Model X，并开放 API。");
});

test("today excludes unhandled stories after the 48-hour editorial window", () => {
  const state = createDefaultState();
  state.runs = [run("run-1", [
    candidate("recent", {
      title: "Acme ships a recent model update",
      url: "https://acme.example/recent",
      canonicalUrl: "https://acme.example/recent",
      publishedAt: "2026-08-30T01:00:00.000Z",
      briefing: {
        titleZh: "Acme 发布近期模型更新",
        summaryZh: "Acme 刚刚发布了一次模型更新。",
        basis: "full-source",
        generatedAt: "2026-08-30T01:10:00.000Z",
        providerId: "codex",
      },
    }),
    candidate("stale", {
      title: "Acme old model announcement",
      url: "https://acme.example/stale",
      canonicalUrl: "https://acme.example/stale",
      publishedAt: "2026-08-28T00:00:00.000Z",
      briefing: {
        titleZh: "Acme 两天前的模型消息",
        summaryZh: "这是一条已经超过编辑窗口的旧消息。",
        basis: "full-source",
        generatedAt: "2026-08-28T00:10:00.000Z",
        providerId: "codex",
      },
    }),
  ])];

  const today = buildTodayView(state, "2026-08-30T02:00:00.000Z");
  const visibleTitles = [...today.mustReads, ...today.secondary].map((story) => story.originalTitle);

  assert.deepEqual(visibleTitles, ["Acme ships a recent model update"]);
  assert.equal(today.coverage.activeStoryCount, 1);
});

test("StoryDesk counts only existing local files and requires both platforms for publication readiness", () => {
  const state = createDefaultState();
  const sourceImage = (id: string, overrides: Partial<Candidate["images"][number]> = {}) => ({
    id,
    url: `https://images.example/${id}.jpg`,
    caption: `Image ${id}`,
    attribution: "Acme",
    sourceUrl: "https://acme.example/news",
    selected: false,
    rights: "owned" as const,
    allowedPlatforms: ["*"],
    ...overrides,
  });
  const deletedPath = imageFixture("deleted.jpg");
  rmSync(deletedPath);
  const migratedPath = process.platform === "win32"
    ? "/Users/old-mac/ai-news-desk/media/migrated.jpg"
    : "C:\\Users\\old-windows\\ai-news-desk\\media\\migrated.jpg";
  state.runs = [run("run-images", [
    candidate("remote-only", {
      title: "Remote image story",
      url: "https://acme.example/remote-images",
      canonicalUrl: "https://acme.example/remote-images",
      briefing: { titleZh: "远程图片事件", summaryZh: "只有远程图片。", basis: "full-source", generatedAt: "2026-08-30T01:10:00.000Z", providerId: "test" },
      imageCount: 2,
      images: [sourceImage("remote-1"), sourceImage("remote-2")],
    }),
    candidate("cached", {
      title: "Cached image story",
      url: "https://acme.example/cached-images",
      canonicalUrl: "https://acme.example/cached-images",
      briefing: { titleZh: "本地图片事件", summaryZh: "具有真实本地图片。", basis: "full-source", generatedAt: "2026-08-30T01:10:00.000Z", providerId: "test" },
      imageCount: 2,
      images: [
        sourceImage("cached-1", {
          localPath: imageFixture("cached-1.jpg"),
          publicPath: "/media/cached-1.jpg",
          allowedPlatforms: ["wechat"],
        }),
        sourceImage("cached-2", {
          localPath: imageFixture("cached-2.jpg"),
          publicPath: "/media/cached-2.jpg",
          allowedPlatforms: ["wechat", "xiaoheihe"],
        }),
      ],
    }),
    candidate("stale-paths", {
      title: "Stale local path story",
      url: "https://acme.example/stale-image-paths",
      canonicalUrl: "https://acme.example/stale-image-paths",
      briefing: { titleZh: "失效路径事件", summaryZh: "路径指向已删除或异机文件。", basis: "full-source", generatedAt: "2026-08-30T01:10:00.000Z", providerId: "test" },
      imageCount: 2,
      images: [
        sourceImage("deleted", { localPath: deletedPath, publicPath: "/media/deleted.jpg" }),
        sourceImage("migrated", { localPath: migratedPath, publicPath: "/media/migrated.jpg" }),
      ],
    }),
  ])];

  const stories = buildStories(state, "2026-08-30T02:00:00.000Z");
  const cached = stories.find((item) => item.originalTitle === "Cached image story")!;
  const stale = stories.find((item) => item.originalTitle === "Stale local path story")!;

  assert.equal(cached.localImageCount, 2);
  assert.equal(cached.publishReadyImageCount, 1, "WeChat-only permission is not neutral publication readiness");
  assert.equal(cached.rightsReviewImageCount, 1);
  assert.equal(stale.localImageCount, 0);
  assert.equal(stale.publishReadyImageCount, 0);
  assert.equal(buildTodayView(state, "2026-08-30T02:00:00.000Z").coverage.imageReadyCount, 1);
});

test("today recommendations show each available source before repeating one", () => {
  const state = createDefaultState();
  const storyCandidate = (id: string, sourceName: string, recommendationScore: number, publishedAt: string) => candidate(id, {
    sourceName,
    title: `Unique story ${id}`,
    url: `https://${id}.example/story`,
    canonicalUrl: `https://${id}.example/story`,
    recommendationScore,
    publishedAt,
    briefing: {
      titleZh: `独立新闻 ${id}`,
      summaryZh: `这是 ${id} 的独立新闻摘要。`,
      basis: "full-source",
      generatedAt: publishedAt,
      providerId: "codex",
    },
  });
  state.runs = [run("run-1", [
    storyCandidate("a-1", "Source A", 100, "2026-08-30T01:50:00.000Z"),
    storyCandidate("a-2", "Source A", 99, "2026-08-30T01:40:00.000Z"),
    storyCandidate("a-3", "Source A", 98, "2026-08-30T01:30:00.000Z"),
    storyCandidate("b-1", "Source B", 90, "2026-08-30T01:20:00.000Z"),
    storyCandidate("c-1", "Source C", 80, "2026-08-30T01:10:00.000Z"),
  ])];

  const today = buildTodayView(state, "2026-08-30T02:00:00.000Z");
  const visible = [...today.mustReads, ...today.secondary];

  assert.deepEqual(
    visible.slice(0, 4).map((story) => story.signals[0]?.sourceName),
    ["Source A", "Source B", "Source C", "Source A"],
  );
});

test("Story id remains stable when extraction adds a canonical URL", () => {
  const state = createDefaultState();
  state.runs = [run("run-1", [candidate("official", {
    url: "https://acme.example/news/model-x?utm_source=feed",
    canonicalUrl: undefined,
  })])];

  const before = buildStories(state, "2026-08-30T02:00:00.000Z")[0];
  state.runs[0]!.candidates[0]!.canonicalUrl = "https://acme.example/model-x";
  const after = buildStories(state, "2026-08-30T02:00:00.000Z")[0];

  assert.ok(before);
  assert.equal(after?.id, before.id);
});
