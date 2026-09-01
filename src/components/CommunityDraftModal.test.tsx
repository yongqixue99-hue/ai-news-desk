import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createDefaultState } from "../../server/defaults.js";
import type { Candidate } from "../../server/types.js";
import { CommunityDraftModal } from "./CommunityDraftModal.js";

const linkedCommunityCandidate = {
  id: "candidate-1",
  rawId: "hackernews:story:1",
  sourceType: "hackernews",
  sourceName: "Hacker News",
  sourceRole: "community",
  title: "Developers create an open source AI CEO",
  url: "https://github.com/example/open-executive",
  excerpt: "[alice]: One cached comment is not the news story.",
  publishedAt: "2026-09-01T00:00:00.000Z",
  fetchedAt: "2026-09-01T01:00:00.000Z",
  score: 10,
  scoreBreakdown: { consequence: 2, novelty: 2, evidence: 2, relevance: 2, timeliness: 2, confirmation: 0, penalty: 0 },
  heatScore: 50,
  heatBreakdown: { engagement: 50, sourceReach: 0, crossSource: 0, freshness: 0 },
  recommendationScore: 80,
  topicIds: ["ai"],
  engagement: { discussionUrl: "https://news.ycombinator.com/item?id=1", points: 100, comments: 80 },
  clusterSize: 1,
  relatedSources: ["Hacker News"],
  evidence: "待核验",
  imageCount: 0,
  images: [],
  selected: false,
  status: "candidate",
} satisfies Candidate;

test("linked community stories default to source-first news writing", () => {
  const state = createDefaultState();
  const markup = renderToStaticMarkup(createElement(CommunityDraftModal, {
    candidate: linkedCommunityCandidate,
    provider: state.aiSettings.providers[0]!,
    onClose: () => undefined,
    onCreate: async () => undefined,
  }));

  assert.match(markup, /先读来源，再写新闻/u);
  assert.match(markup, /aria-checked="true"[^>]*>[\s\S]*?先读来源，再写新闻/u);
  assert.match(markup, /社区只作补充/u);
});
