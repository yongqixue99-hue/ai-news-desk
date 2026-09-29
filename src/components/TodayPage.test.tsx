import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TodayPage } from "./TodayPage.js";

test("Today keeps factual news search available while its first load shows only a skeleton", () => {
  const markup = renderToStaticMarkup(createElement(TodayPage, {
    onNavigate: () => undefined,
    onNotice: () => undefined,
    onSearch: async () => undefined,
  }));

  assert.match(markup, /aria-label="搜索想写的新闻"/u);
  assert.match(markup, /搜索模型、公司或事件，例如 GPT-6 Astra/u);
  assert.match(markup, /搜索最近 7 天/u);
  assert.match(markup, /X 和社区帖子不参与这次事实搜索/u);
  assert.match(markup, /class="today-search-disclosure"/u);
  assert.match(markup, /class="page-loading" role="status"/u);
  assert.match(markup, /正在整理今天的选题与草稿/u);
  assert.doesNotMatch(markup, /class="today-editorial-grid"/u);
  assert.doesNotMatch(markup, /class="today-empty"/u);
  assert.doesNotMatch(markup, /还没有读取新闻|本轮没有符合条件的推荐|>0 条</u);
});
