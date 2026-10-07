import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import { discoveryFixture } from "../../tests/fixtures/discovery.js";
import { buildCommunityView } from "../../server/community-view.js";
import type { SourceConfig } from "../types";
import { CommunityWorkspace } from "./CommunityWorkspace.js";

const renderFixture = () => {
  const now = new Date().toISOString(), fixture = discoveryFixture(now);
  for (const candidate of fixture.state.runs[0]!.candidates) {
    candidate.sourceRole = "community"; candidate.sourceType = "hackernews";
    candidate.engagement = { points: 8, comments: 4, discussionUrl: `https://example.com/discussion/${candidate.id}` };
  }
  const sources = (["healthy", "error", "unknown"] as const).map((health, index): SourceConfig => ({
    ...fixture.state.sources[0]!, id: `example-source-${index}`, name: `隔离来源 ${index}`, role: "community", enabled: true, health,
  }));
  const view = buildCommunityView(fixture.state, now);
  return load(renderToStaticMarkup(createElement(CommunityWorkspace, {
    feed: view.feed, sources, settings: fixture.state.settings,
    onFeedback: async () => undefined, onRestoreFeedback: async () => undefined,
    onCreateDraft: async () => undefined, onAutoBrief: async () => undefined,
  })));
};

test("community overview, source status and sorting are available inside one closed disclosure", () => {
  const $ = renderFixture(), details = $(".community-source-health");
  assert.equal(details.attr("open"), undefined);
  assert.equal($(".community-header-stats").closest("details").length, 1);
  assert.equal($(".community-sort-tabs").closest("details").length, 1);
  assert.equal($(".community-topic-tabs").closest("details").length, 0);
  assert.match(details.find("summary").text(), /1 个来源需留意/u);
  assert.equal(details.find(".community-sort-tabs button").length, 3);
});

test("folded source status preserves failures and unknowns without changing community candidates", () => {
  const $ = renderFixture();
  assert.equal($(".community-source-state.healthy").length, 1);
  assert.equal($(".community-source-state.error").text().includes("读取失败"), true);
  assert.equal($(".community-source-state.unknown").text().includes("待读取"), true);
  assert.match($(".community-source-health").text(), /社区热度不作为事实证明/u);
  assert.equal($(".community-signal-list article").length, 6);
  assert.equal($(".community-signal-main strong").first().text().includes("隔离示例"), true);
});
