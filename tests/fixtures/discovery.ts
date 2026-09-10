import { createDefaultState } from "../../server/defaults.js";
import { rawItemToCandidate } from "../../server/scoring.js";
import { buildTodayView } from "../../server/story-desk.js";
import type { ArticleDraft } from "../../server/types.js";
import type { ContentPackage } from "../../server/product-types.js";

/** Original, isolated UI fixtures. Never import into a user's workflow. */
export function discoveryFixture() {
  const state = createDefaultState();
  state.settings.scheduleEnabled = false;
  state.settings.officialMonitorEnabled = false;
  state.sources.forEach((source) => { source.enabled = false; });
  const now = new Date().toISOString();
  const titles = ["隔离示例：Acme 开放本地模型，先看使用条件", "隔离示例：一款能保留来源的 AI 阅读工具", "隔离示例：长型号 ModelWithAVeryLongUnbrokenName2026Preview 在本地运行的限制", "隔离示例：开发者记录了一次失败的自动化实验", "隔离示例：研究团队公开评测方法与适用范围", "隔离示例：一份保留代码与步骤的入门指南"];
  const candidates = titles.map((title, i) => {
    const candidate = rawItemToCandidate({ id: `ui-${i}`, title: `Acme releases ${["LocalModel", "Reader", "LongModel", "Runner", "Benchmark", "Guide"][i]}`, url: `https://example.com/ui-${i}`, published_at: new Date(Date.now() - (i + 1) * 3_600_000).toISOString(), fetched_at: now, content: "Acme released a local model for personal evaluation. Commercial use requires a separate agreement. This is an original UI fixture, not live news.", source_type: "rss", metadata: { feed_name: "隔离示例来源", source_role: "official" } }, 48, ["ai"]);
    candidate.score = 15; candidate.recommendationScore = 90 - i;
    candidate.briefing = { titleZh: title, summaryZh: "开放范围是个人评估，商业使用仍需单独约定。这里只展示隔离测试材料。", basis: i === 2 ? "excerpt" : "full-source", generatedAt: now, providerId: "fixture" };
    return candidate;
  });
  state.runs = [{ id: "ui-fixture", origin: "link-intake", createdAt: now, updatedAt: now, collectedAt: now, status: "ready", stage: "隔离测试数据", windowHours: 48, sourceIds: [], scheduled: false, rawCount: candidates.length, candidates, logs: [] }];
  const today = buildTodayView(state);
  const stories = [...today.mustReads, ...today.secondary, ...today.watching, ...(today.interesting ?? [])].filter((story, i, all) => all.findIndex((s) => s.id === story.id) === i);
  if (!stories.length) throw new Error("UI fixtures did not produce Stories");
  today.mustReads = stories.slice(0, 3); today.secondary = stories.slice(3); today.interesting = []; today.watching = []; today.releaseHighlights = []; today.backlog = [];
  const story = stories[0]!;
  story.explanation.status = "partial";
  const sourceUrl = story.signals[0]!.url;
  const material = { signalId: story.signals[0]!.candidateId, sourceKind: "article" as const, sourceLabel: "隔离示例来源", url: sourceUrl, author: "示例作者", originalTitle: "Acme LocalModel — isolated fixture", originalText: "Acme released a local model for personal evaluation.\n\nCommercial use requires a separate agreement.\n\nThis is an original UI fixture, not live news.", originalLanguage: "en" as const, basis: "full-source" as const, capturedAt: now, fromCache: true, truncated: true, extractionWarnings: ["隔离示例：附录未读入。"], rightsNotice: "仅供隔离界面验收。" };
  const contentPackage: ContentPackage = { id: "ui-package", storyId: story.id, mode: "brief", title: story.title, createdAt: now,
    facts: [{ id: "ui-fact", text: "模型开放个人评估，商业使用需要单独约定。", status: "supported", sourceSignalIds: [material.signalId], sourceUrls: [sourceUrl], quotations: [{ sourceUrl, text: "Commercial use requires a separate agreement." }] }],
    communityFocus: [], discussionSamples: [{ id: "ui-comment", signalId: "ui-discussion", platform: "测试社区", author: "示例评论者", permalink: "https://example.com/comment/1", originalText: "I would like to try it locally.", kind: "opinion", branchId: "branch-1", publishedAt: now }],
    sourceSignalIds: [material.signalId], sources: [{ signalId: material.signalId, label: material.sourceLabel, url: sourceUrl, role: "official", basis: "full-source", publishedAt: story.publishedAt, isCommunity: false }], sourceEvidence: [material], imageIds: [], assets: [], uncertainties: ["隔离示例：附录未读入。"], suggestedAngles: [], communityEvidenceLabel: "有限样本", status: "blocked", blockers: ["隔离示例：附录材料待补充，不能开始写作。"] };
  const draft: ArticleDraft = { id: "ui-draft", title: "隔离示例：编辑器视觉回归稿", candidateId: "ui", runId: "ui-fixture", status: "editing", createdAt: now, updatedAt: now, paragraphs: ["这是隔离测试正文，不是用户草稿。", "原来的保存、版本和交付流程保持独立。"], bodyHtml: "<p>这是隔离测试正文，不是用户草稿。</p><p>原来的保存、版本和交付流程保持独立。</p>", take: "", sources: [], uncertainties: [], images: [], community: "", topics: [], provenance: { originalUrl: sourceUrl, generatedBy: "codex-cli", authoringMode: "human-first" } };
  state.drafts = [draft];
  return { state, today, story, stories, contentPackage, draft };
}
