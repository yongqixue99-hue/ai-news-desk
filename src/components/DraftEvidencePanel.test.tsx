import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ArticleDraft } from "../types.js";
import { DraftEvidencePanel } from "./DraftEvidencePanel.js";

const draft: ArticleDraft = {
  id: "draft-open-executive",
  runId: "run-open-executive",
  candidateId: "candidate-open-executive",
  createdAt: "2026-09-01T04:21:29.344Z",
  updatedAt: "2026-09-01T04:21:29.344Z",
  status: "editing",
  title: "SenteLabsAI 开源多代理高管项目 Open Executive",
  paragraphs: ["Open Executive 是一个开源多代理项目。"],
  take: "",
  sources: [
    { label: "github.com", url: "https://github.com/SenteLabsAI/OpenExecutive", kind: "primary", verified: true },
    { label: "Hacker News", url: "https://news.ycombinator.com/item?id=49458418", kind: "supporting", verified: true },
  ],
  factClaims: [{
    id: "claim-1",
    claim: "项目采用 Apache 2.0 许可。",
    status: "full-source",
    sourceUrl: "https://github.com/SenteLabsAI/OpenExecutive",
    capturedAt: "2026-09-01T04:21:29.344Z",
  }],
  uncertainties: [
    "仍未知：公开资料没有说明项目的生产环境用户数量",
    "部分原图可进入私人编辑草稿，但公众号同步前会被预检拦截，需确认权利或替换",
  ],
  images: [],
  community: "",
  topics: ["AI"],
  provenance: {
    originalUrl: "https://github.com/SenteLabsAI/OpenExecutive",
    generatedBy: "codex-cli",
    contentPackageId: "package-open-executive",
    generatorRevision: "source-first-v8",
  },
};

test("the evidence panel explains automatic work without turning internal notes into user tasks", () => {
  const markup = renderToStaticMarkup(createElement(DraftEvidencePanel, {
    draft,
    onUpdateFactClaim: () => undefined,
    onResolveFactUncertainty: () => undefined,
  }));

  assert.match(markup, /事实来源已自动整理/u);
  assert.match(markup, /1 条正文事实已回指来源，不需要你逐条勾选/u);
  assert.match(markup, /事件来源/u);
  assert.match(markup, /发现线索/u);
  assert.match(markup, /只说明这条选题从哪里被发现，不参与新闻事实核验/u);
  assert.match(markup, /已知边界 · 1/u);
  assert.match(markup, /发布时再处理/u);
  assert.doesNotMatch(markup, /2 项待确认|已人工核验|事实级证据/u);
});
