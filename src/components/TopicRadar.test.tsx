import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import { TopicRadar } from "./TopicRadar.js";

test("topic rows show the brief and label, fold template prose and omit unknown heat", () => {
  const $ = load(renderToStaticMarkup(createElement(TopicRadar, {
    rows: [{ id: "fixture", title: "示例工具支持本地运行", summary: "完整原始摘要", brief: "用户可以下载权重，在自己的电脑上处理文字。",
      label: "重要进展", reason: "模板选题原因", heat: "热度未知", status: "verify", selected: false,
      publishedAt: "2026-10-07T08:00:00Z", dateLabel: "发布", sources: [{ name: "示例来源", url: "https://example.com/fixture" }], aggregationId: "fixture" }],
    busy: false, onOpen() {}, onQueue() {}, onRetain: async () => {},
  })));
  assert.equal($(".radar-main > .radar-brief").text(), "用户可以下载权重，在自己的电脑上处理文字。");
  assert.equal($(".radar-main > .radar-label").text(), "重要进展");
  assert.equal($(".radar-main > .radar-reason").length, 0);
  assert.equal($(".radar-evidence .radar-reason").text(), "模板选题原因");
  assert.equal($(".radar-status small").length, 0);
  assert.equal($(".radar-row").length, 1);
  assert.equal($(".radar-evidence").attr("open"), undefined);
  assert.equal($(".radar-evidence a").attr("href"), "https://example.com/fixture");
});
