import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TodayPage } from "./TodayPage.js";

test("Today exposes a prominent seven-day factual news search", () => {
  const markup = renderToStaticMarkup(createElement(TodayPage, {
    onNavigate: () => undefined,
    onNotice: () => undefined,
    onSearch: async () => undefined,
  }));

  assert.match(markup, /aria-label="搜索想写的新闻"/u);
  assert.match(markup, /搜索模型、公司或事件，例如 GPT-6 Astra/u);
  assert.match(markup, /搜索最近 7 天/u);
  assert.match(markup, /X 和社区帖子不参与这次事实搜索/u);
  assert.match(markup, /aria-label="选题分类"/u);
  for (const label of ["AI 新闻", "知乎", "Hacker News", "V2EX", "GitHub"]) assert.ok(markup.includes(label));
  assert.match(markup, /id="topic-tab-news" aria-selected="true"/u);
});
