import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInlineCompletionPrompt,
  isStableInlineCompletionPreview,
  prepareInlineCompletion,
} from "./inline-completion.js";
import type { ContentPackage } from "./product-types.js";

const packageData: ContentPackage = {
  id: "package-completion",
  storyId: "story-completion",
  mode: "brief",
  intent: "news",
  title: "Acme 发布 Model X",
  createdAt: "2026-09-02T08:00:00.000Z",
  facts: [
    {
      id: "fact-supported",
      text: "Acme 于 2026 年发布 Model X，并开放 API。",
      status: "supported",
      sourceSignalIds: ["run:candidate"],
      sourceUrls: ["https://acme.example/model-x"],
    },
    {
      id: "fact-unverified",
      text: "Model X 将在 2027 年收费。",
      status: "unverified",
      sourceSignalIds: ["run:candidate"],
    },
  ],
  communityFocus: ["部署成本"],
  discussionSamples: [],
  sourceSignalIds: ["run:candidate"],
  sources: [{
    signalId: "run:candidate",
    label: "Acme 官方",
    url: "https://acme.example/model-x",
    role: "official",
    basis: "full-source",
    publishedAt: "2026-09-02T07:30:00.000Z",
    isCommunity: false,
  }],
  imageIds: [],
  assets: [],
  uncertainties: ["收费时间尚未公开。"],
  suggestedAngles: ["开放 API 对开发者意味着什么"],
  communityEvidenceLabel: "有限样本",
  status: "ready",
  blockers: [],
};

test("stream previews wait for a stable clause instead of repainting every token", () => {
  assert.equal(isStableInlineCompletionPreview("它们必须在2026"), false);
  assert.equal(isStableInlineCompletionPreview("它们必须在2026年12月底前完成整改，"), true);
  assert.equal(isStableInlineCompletionPreview("完整一句。"), true);
});

test("completion does not label facts already present after the cursor as uncovered", () => {
  const prompt = buildInlineCompletionPrompt({ contentPackage: packageData, title: packageData.title,
    before: "这次的变化是", after: packageData.facts[0].text });
  const uncovered = prompt.user.split("【尚未覆盖的事实】")[1].split("【不可补写的未知项】")[0];
  assert.doesNotMatch(uncovered, /fact-supported/u);
});

test("inline completion prompt exposes supported package facts and keeps unknown claims outside the writing evidence", () => {
  const prompt = buildInlineCompletionPrompt({
    contentPackage: packageData,
    title: "Acme 发布 Model X",
    before: "Acme 这次发布最值得关注的是",
    after: "",
  });

  assert.match(prompt.system, /只能使用素材包/u);
  assert.match(prompt.user, /Acme 于 2026 年发布 Model X，并开放 API/u);
  assert.match(prompt.user, /收费时间尚未公开/u);
  assert.doesNotMatch(prompt.user, /Model X 将在 2027 年收费/u);
  assert.match(prompt.user, /Acme 这次发布最值得关注的是/u);
  assert.match(prompt.user, /写作路由.*brief/u);
  assert.match(prompt.user, /尚未覆盖的事实/u);
});

test("inline completion keeps one short sentence and rejects new protected fact anchors", () => {
  const accepted = prepareInlineCompletion({
    raw: "```\n开放 API 让开发者可以更快开始测试。第二句话不应返回。\n```",
    contentPackage: packageData,
  });
  assert.deepEqual(accepted, {
    available: true,
    text: "开放 API 让开发者可以更快开始测试。",
  });

  const rejected = prepareInlineCompletion({
    raw: "Model Y 将在 2027 年全面收费。",
    contentPackage: packageData,
  });
  assert.deepEqual(rejected, {
    available: false,
    reason: "模型建议包含素材包外的新数字或实体",
  });
});

test("inline completion may predict two evidence-bound paragraphs but never a third", () => {
  const result = prepareInlineCompletion({
    raw: [
      "开放 API 让开发者可以更快开始测试。这里不应成为同段第二句。",
      "对团队来说，下一步可以先验证 Model X 的接口。",
      "第三段不应进入灰字建议。",
    ].join("\n\n"),
    contentPackage: packageData,
    before: "Acme 这次发布最值得关注的是",
    after: "",
  });

  assert.deepEqual(result, {
    available: true,
    text: "开放 API 让开发者可以更快开始测试。\n\n对团队来说，下一步可以先验证 Model X 的接口。",
  });
});

test("inline completion rejects a paragraph that is already present around the cursor", () => {
  const result = prepareInlineCompletion({
    raw: "对团队来说，下一步可以先验证 Model X 的接口。",
    contentPackage: packageData,
    before: "Acme 已经开放 API。",
    after: "对团队来说，下一步可以先验证 Model X 的接口。",
  });

  assert.deepEqual(result, {
    available: false,
    reason: "模型建议与现有正文重复",
  });
});
