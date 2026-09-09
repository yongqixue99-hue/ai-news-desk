import assert from "node:assert/strict";
import test from "node:test";
import { buildCandidateBriefingEvidence, parseCandidateBriefings } from "./candidate-briefing.js";
import type { Candidate } from "./types.js";

const candidate = (id: string, excerpt: string): Candidate => ({
  id,
  rawId: id,
  sourceType: "rss",
  sourceName: "Official source",
  title: `Original ${id}`,
  url: `https://example.com/${id}`,
  excerpt,
  publishedAt: "2026-08-27T08:00:00.000Z",
  fetchedAt: "2026-08-27T08:00:00.000Z",
  score: 12,
  scoreBreakdown: { consequence: 3, novelty: 3, evidence: 3, relevance: 1, timeliness: 2, confirmation: 0, penalty: 0 },
  heatScore: 0,
  heatBreakdown: { engagement: 0, sourceReach: 0, crossSource: 0, freshness: 0 },
  recommendationScore: 80,
  clusterSize: 1,
  relatedSources: ["Official source"],
  evidence: "一手来源",
  imageCount: 0,
  images: [],
  selected: false,
  status: "candidate",
});

test("candidate briefings keep evidence provenance while returning Chinese titles and summaries", () => {
  const parsed = parseCandidateBriefings(
    JSON.stringify({
      items: [
        {
          candidateId: "glm-release",
          titleZh: "智谱发布 GLM-5.3-Flash",
          summaryZh: "新模型主打更低推理成本，并同步开放 API 与模型权重。",
        },
        {
          candidateId: "api-update",
          titleZh: "OpenAI 更新开发者 API",
          summaryZh: "本次更新增加批处理能力，同时调整部分接口限制。",
        },
      ],
    }),
    [
      { candidateId: "glm-release", basis: "full-source", text: "full text" },
      { candidateId: "api-update", basis: "excerpt", text: "excerpt" },
    ],
    {
      generatedAt: "2026-08-27T12:00:00.000Z",
      providerId: "codex-cli",
    },
  );

  assert.deepEqual(parsed, [
    {
      candidateId: "glm-release",
      briefing: {
        titleZh: "智谱发布 GLM-5.3-Flash",
        summaryZh: "新模型主打更低推理成本，并同步开放 API 与模型权重。",
        basis: "full-source",
        generatedAt: "2026-08-27T12:00:00.000Z",
        providerId: "codex-cli",
      },
    },
    {
      candidateId: "api-update",
      briefing: {
        titleZh: "OpenAI 更新开发者 API",
        summaryZh: "本次更新增加批处理能力，同时调整部分接口限制。",
        basis: "excerpt",
        generatedAt: "2026-08-27T12:00:00.000Z",
        providerId: "codex-cli",
      },
    },
  ]);
});

test("candidate briefing evidence prefers extracted source text, then excerpt, then title", () => {
  const full = candidate("full", "fallback excerpt");
  const excerpt = candidate("excerpt", "use this excerpt");
  const title = candidate("title", "");
  const evidence = buildCandidateBriefingEvidence(
    [full, excerpt, title],
    new Map([["full", "This is the extracted source body with enough detail to understand what happened and why it matters."]]),
  );

  assert.deepEqual(evidence.map((item) => item.basis), ["full-source", "excerpt", "title"]);
  assert.match(evidence[0].text, /extracted source body/);
  assert.match(evidence[1].text, /use this excerpt/);
  assert.match(evidence[2].text, /Original title/);
});

test("candidate briefings keep a source-bound explanation for the Story reader", () => {
  const parsed = parseCandidateBriefings(JSON.stringify({
    items: [{
      candidateId: "glm-release",
      titleZh: "智谱发布 GLM-5.3-Flash",
      summaryZh: "新模型已经开放 API 与模型权重。",
      whatHappenedZh: "智谱在 8 月 26 日发布 GLM-5.3-Flash，并同步开放 API 和模型权重。官方把它定位为更低推理成本的多模态模型。",
      readerBriefZh: "智谱发布了 GLM-5.3-Flash，API 和模型权重已经同时开放。第三方工具链能不能稳定接入，还要等实际测试。",
      keyPointsZh: [
        "官方公布总参数为 320B、激活参数为 18B。",
        "模型可通过 API 调用，权重已经在 Hugging Face 公布。",
      ],
      editorNoteZh: "参数和开放状态已经明确，可以等第一批真实部署反馈后再决定是否写长文。",
      unknownsZh: ["第三方工具链中的稳定性还没有足够实测。"],
    }],
  }), [{
    candidateId: "glm-release",
    basis: "full-source",
    text: "source body",
  }], {
    generatedAt: "2026-08-27T12:00:00.000Z",
    providerId: "codex-cli",
  });

  assert.deepEqual(parsed[0]?.briefing.explanation, {
    voiceVersion: 2,
    whatHappenedZh: "智谱在 8 月 26 日发布 GLM-5.3-Flash，并同步开放 API 和模型权重。官方把它定位为更低推理成本的多模态模型。",
    readerBriefZh: "智谱发布了 GLM-5.3-Flash，API 和模型权重已经同时开放。第三方工具链能不能稳定接入，还要等实际测试。",
    keyPointsZh: [
      "官方公布总参数为 320B、激活参数为 18B。",
      "模型可通过 API 调用，权重已经在 Hugging Face 公布。",
    ],
    editorNoteZh: "参数和开放状态已经明确，可以等第一批真实部署反馈后再决定是否写长文。",
    unknownsZh: ["第三方工具链中的稳定性还没有足够实测。"],
  });
});

test("candidate briefing records machine-like reader copy without treating the audit as evidence", () => {
  const parsed = parseCandidateBriefings(JSON.stringify({
    items: [{
      candidateId: "robot-copy",
      titleZh: "某公司发布新模型",
      summaryZh: "某公司发布了一个新模型。",
      whatHappenedZh: "某公司发布了一个新模型。",
      readerBriefZh: "现有证据显示，某公司发布了一个新模型。这意味着该模型值得关注。",
      keyPointsZh: ["新模型已经发布。"],
      editorNoteZh: "",
      unknownsZh: ["具体参数还没有公布。"],
    }],
  }), [{ candidateId: "robot-copy", basis: "excerpt", text: "source excerpt" }], {
    generatedAt: "2026-08-27T12:00:00.000Z",
    providerId: "codex-cli",
  });

  assert.deepEqual(parsed[0]?.briefing.explanation?.qualityFlags, [
    "lieflat-this-means-repeat",
    "robot-evidence-shell",
  ]);
});

test("candidate briefing catches model-facing words that leaked into editor copy", () => {
  const parsed = parseCandidateBriefings(JSON.stringify({
    items: [{
      candidateId: "input-leak",
      titleZh: "某公司更新开发工具",
      summaryZh: "某公司更新了开发工具。",
      whatHappenedZh: "某公司更新了开发工具。",
      readerBriefZh: "某公司更新了开发工具，开发者现在可以直接导入本地代码。具体兼容范围还要等官方文档。",
      keyPointsZh: ["开发者可以导入本地代码。"],
      editorNoteZh: "输入里还没有实际性能数据。",
      unknownsZh: ["输入未给出旧版本的迁移成本。"],
    }],
  }), [{ candidateId: "input-leak", basis: "full-source", text: "source body" }], {
    generatedAt: "2026-08-27T12:00:00.000Z",
    providerId: "codex-cli",
  });

  assert.ok(parsed[0]?.briefing.explanation?.qualityFlags?.includes("robot-evidence-shell"));
});

test("partial-source unknowns describe reading limits instead of claiming that the publisher omitted facts", () => {
  for (const basis of ["title", "excerpt"] as const) {
    const parsed = parseCandidateBriefings(JSON.stringify({ items: [{
      candidateId: "partial", titleZh: "某公司发布新模型", summaryZh: "某公司发布了新模型。",
      whatHappenedZh: "某公司发布了新模型。", readerBriefZh: "某公司发布了新模型，细节仍需核对。",
      keyPointsZh: ["新模型已发布。"], editorNoteZh: "价格还没公布，先观察。",
      unknownsZh: ["官方文章尚未说明价格与使用条件。"],
    }] }), [{ candidateId: "partial", basis, text: "available source fragment" }], {
      generatedAt: "2026-09-08T00:00:00Z", providerId: "codex-cli",
    });
    const explanation = parsed[0]!.briefing.explanation!;
    assert.deepEqual(explanation.unknownsZh, [basis === "title"
      ? "目前只读到标题，细节仍需打开原文核对。"
      : "目前只读到来源摘要，未覆盖的正文内容仍需核对。"]);
    assert.equal(explanation.editorNoteZh, undefined);
    assert.equal(parsed[0]!.briefing.basis, basis);
  }
});

test("community briefing keeps event facts separate from discussion viewpoints", () => {
  const community = candidate("thread", "--- Top Comments --- [reader]: I tested it for a week and the latency is still the main problem.");
  community.sourceType = "hackernews";
  community.sourceName = "Hacker News";
  community.sourceRole = "community";
  community.engagement = { discussionUrl: "https://news.ycombinator.com/item?id=1" };
  const evidence = buildCandidateBriefingEvidence(
    [community],
    new Map([["thread", "The linked source confirms the product release, its published API price, availability date, and supported regions."]]),
  );
  assert.equal(evidence[0].community, true);
  assert.match(evidence[0].text, /关联来源正文/u);
  assert.match(evidence[0].text, /社区讨论摘录/u);

  const parsed = parseCandidateBriefings(JSON.stringify({
    items: [{
      candidateId: "thread",
      titleZh: "产品发布新的 API",
      summaryZh: "关联来源确认产品已经发布，并公布了 API 价格。",
      communitySummaryZh: "讨论者更关心实际延迟，而不是发布本身。",
      communityFocusZh: ["有人分享了一周实测经验", "延迟仍是主要问题"],
      communityDisagreementZh: "",
    }],
  }), evidence, {
    generatedAt: "2026-08-27T12:00:00.000Z",
    providerId: "codex-cli",
  });

  assert.equal(parsed[0].briefing.summaryZh, "关联来源确认产品已经发布，并公布了 API 价格。");
  assert.equal(parsed[0].communityInsight?.summaryZh, "讨论者更关心实际延迟，而不是发布本身。");
  assert.deepEqual(parsed[0].communityInsight?.focusZh, ["有人分享了一周实测经验", "延迟仍是主要问题"]);
});
