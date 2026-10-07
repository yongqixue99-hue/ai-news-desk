import assert from "node:assert/strict";
import test from "node:test";
import type { StoryView, TodayView } from "./product-types.js";
import { groupTitleBackfillByRun, lacksChineseTitle, titleBackfillTargets } from "./today-title-backfill.js";

const story = (id: string, title: string, originalTitle: string, signals: Array<{ runId: string; candidateId: string; title: string; isCommunity?: boolean }>) =>
  ({ id, title, originalTitle, signals: signals.map((signal) => ({ isCommunity: false, ...signal })) }) as unknown as StoryView;

test("Today title backfill targets only source-language headlines and prefers the original non-community signal", () => {
  const english = story("s1", "How we will do better", "How we will do better", [
    { runId: "r1", candidateId: "hn", title: "How we will do better", isCommunity: true },
    { runId: "r2", candidateId: "official", title: "How we will do better" },
  ]);
  const translated = story("s2", "OpenAI 推出语音 API", "Build voice experiences", [{ runId: "r2", candidateId: "c2", title: "Build voice experiences" }]);
  const pending = story("s3", "Introducing Astra for Law", "Introducing Astra for Law", [{ runId: "r2", candidateId: "c3", title: "Introducing Astra for Law" }]);
  const view = { radar: [{ story: english }, { story: translated }, {}], pending: [pending, english], mustReads: [english], secondary: [], interesting: [] } as unknown as TodayView;

  const targets = titleBackfillTargets(view);
  assert.deepEqual(targets, [
    { storyId: "s1", runId: "r2", candidateId: "official" },
    { storyId: "s3", runId: "r2", candidateId: "c3" },
  ]);
  assert.deepEqual([...groupTitleBackfillByRun(targets)], [["r2", ["official", "c3"]]]);
  assert.equal(titleBackfillTargets(view, 1).length, 1);
});

test("a headline with any Chinese text is treated as already readable", () => {
  assert.equal(lacksChineseTitle("Show HN：Janus——用 Go 单二进制"), false);
  assert.equal(lacksChineseTitle("GPT-6 Astra — 2026"), true);
});
