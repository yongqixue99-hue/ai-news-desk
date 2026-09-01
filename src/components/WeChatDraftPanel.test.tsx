import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ArticleDraft, WeChatChannelSettings } from "../types.js";
import { WeChatDraftPanel } from "./WeChatDraftPanel.js";

const draft: ArticleDraft = {
  id: "draft-wechat-copy",
  runId: "run-1",
  candidateId: "candidate-1",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  status: "editing",
  title: "Open Executive 用八个智能体组成虚拟高管团队",
  paragraphs: ["Open Executive 把八个专职智能体放进同一套管理界面。"],
  take: "",
  bodyHtml: "<p>Open Executive 把八个专职智能体放进同一套管理界面。</p>",
  sources: [],
  factClaims: [],
  uncertainties: [],
  images: [],
  community: "",
  topics: [],
  provenance: { originalUrl: "https://example.com/open-executive", generatedBy: "test" },
};

const unconfigured: WeChatChannelSettings = {
  accountName: "个人公众号",
  appId: "",
  defaultAuthor: "",
  appSecretConfigured: false,
};

test("an unconfigured WeChat channel offers a one-click formatted-copy fallback", () => {
  const markup = renderToStaticMarkup(createElement(WeChatDraftPanel, {
    draft,
    settings: unconfigured,
    dirty: false,
    saving: false,
    busy: false,
    copiedFormatted: false,
    onSaveDraft: async () => undefined,
    onSync: async () => undefined,
    onCopyFormatted: async () => undefined,
    onConfirmPublished: async () => undefined,
    onOpenSettings: () => undefined,
  }));

  assert.match(markup, />复制公众号排版</u);
  assert.match(markup, /接口不可用时，复制后粘贴到公众号编辑器/u);
});

test("publication checks do not turn known limits or image notes into unresolved facts", () => {
  const markup = renderToStaticMarkup(createElement(WeChatDraftPanel, {
    draft: {
      ...draft,
      uncertainties: [
        "仍未知：公开资料没有说明项目的生产环境用户数量",
        "部分原图可进入私人编辑草稿，但公众号同步前会被预检拦截，需确认权利或替换",
      ],
    },
    settings: unconfigured,
    dirty: false,
    saving: false,
    busy: false,
    copiedFormatted: false,
    onSaveDraft: async () => undefined,
    onSync: async () => undefined,
    onCopyFormatted: async () => undefined,
    onConfirmPublished: async () => undefined,
    onOpenSettings: () => undefined,
  }));

  assert.match(markup, /没有需要你确认的事实/u);
  assert.doesNotMatch(markup, /2 项事实待确认/u);
});
