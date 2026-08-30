import assert from "node:assert/strict";
import test from "node:test";
import { personalizeCandidates } from "./personalization.js";
import { rawItemToCandidate, sortCandidates } from "./scoring.js";
import type { CandidateFeedback, RawHorizonItem } from "./types.js";

const raw = (id: string, title: string, sourceName: string): RawHorizonItem => ({
  id,
  source_type: "rss",
  title,
  url: `https://example.com/${id}`,
  content: "A new AI model launch changes API access and pricing.",
  author: sourceName,
  published_at: "2026-08-13T10:00:00.000Z",
  fetched_at: "2026-08-13T11:00:00.000Z",
  metadata: { feed_name: sourceName },
});

const feedback = (
  id: string,
  kind: CandidateFeedback["kind"],
  sourceName: string,
  keywords: string[],
): CandidateFeedback => ({
  id: `feedback-${id}`,
  candidateId: id,
  runId: `run-${id}`,
  kind,
  title: keywords.join(" "),
  sourceName,
  topicIds: ["ai"],
  keywords,
  createdAt: "2026-08-13T12:00:00.000Z",
});

test("personalization is capped, explained, and never mutates value or heat signals", () => {
  const target = sortCandidates([
    rawItemToCandidate(raw("target", "OpenAI ships GPT reasoning model benchmarks", "OpenAI"), 24, ["ai"]),
  ])[0];
  const base = {
    score: target.score,
    scoreBreakdown: structuredClone(target.scoreBreakdown),
    heatScore: target.heatScore,
    heatBreakdown: structuredClone(target.heatBreakdown),
    recommendationScore: target.recommendationScore,
  };
  const history = Array.from({ length: 12 }, (_, index) =>
    feedback(`published-${index}`, "published", "OpenAI", ["openai", "gpt", "reasoning"]));

  const [personalized] = personalizeCandidates([target], history, true);

  assert.equal(personalized.personalizationScore, 3);
  assert.ok(personalized.personalizationReasons.some((reason) => reason.includes("来源")));
  assert.ok(personalized.personalizationReasons.every((reason) => /[+-]\d$/u.test(reason)));
  assert.deepEqual({
    score: personalized.score,
    scoreBreakdown: personalized.scoreBreakdown,
    heatScore: personalized.heatScore,
    heatBreakdown: personalized.heatBreakdown,
    recommendationScore: personalized.recommendationScore,
  }, base);

  const directDislike = personalizeCandidates([
    { ...target, userFeedback: "not_interested" },
  ], [...history, feedback(target.id, "not_interested", "OpenAI", ["openai", "gpt"])], true)[0];
  assert.equal(directDislike.personalizationScore, -4);
  assert.ok(directDislike.personalizationReasons.some((reason) => reason.includes("不感兴趣")));
});

test("turning personalization off clears its adjustment and keeps base recommendation order", () => {
  const first = sortCandidates([
    rawItemToCandidate(raw("one", "OpenAI releases a new GPT API model", "OpenAI"), 24, ["ai"]),
  ])[0];
  const second = sortCandidates([
    rawItemToCandidate(raw("two", "Anthropic releases a new Claude API model", "Anthropic"), 24, ["ai"]),
  ])[0];
  first.recommendationScore = 60;
  second.recommendationScore = 61;

  const disabled = personalizeCandidates(
    [first, second],
    [feedback("history", "published", "OpenAI", ["openai", "gpt"])],
    false,
  );

  assert.deepEqual(disabled.map((candidate) => candidate.id), [second.id, first.id]);
  assert.ok(disabled.every((candidate) => candidate.personalizationScore === 0));
  assert.ok(disabled.every((candidate) => candidate.personalizationReasons.length === 0));
});
