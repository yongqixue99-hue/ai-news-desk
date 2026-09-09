import assert from "node:assert/strict";
import test from "node:test";
import { createZhihuHotlist, parseZhihuHotlist, type ZhihuHotSnapshot } from "./zhihu-hotlist.js";

const rows = JSON.stringify([
  { rank: 3, title: "AI 工具如何改变工作？", heat: "126 万热度", answers: 42, url: "https://www.zhihu.com/question/1234567890123456789" },
  { rank: 9, title: "芯片成本如何变化？", heat: "80 万热度", answers: 12, url: "https://www.zhihu.com/question/222" },
]);

test("hotlist preserves original rank, textual heat and lossless question identity", () => {
  const items = parseZhihuHotlist(rows);
  assert.equal(items[0]?.id, "1234567890123456789");
  assert.deepEqual(items.map((item) => item.rank), [3, 9]);
  assert.equal(items[0]?.heat, "126 万热度");
  assert.equal(items[0]?.answers, 42);
});

test("empty, malformed and off-domain hotlists cannot masquerade as successful retrieval", () => {
  for (const payload of ["", "[]", '{"error":"login"}', '[{"title":"AI","rank":1,"url":"https://www.zhihu.com.evil.test/question/12"}]', '[{"title":"AI","rank":1,"url":"https://www.zhihu.com/question/12/answer/2"}]']) {
    assert.throws(() => parseZhihuHotlist(payload));
  }
});

test("failed refresh retains the last snapshot, scrubs errors, throttles retries and shares in-flight work", async () => {
  let stored: ZhihuHotSnapshot | undefined;
  let now = Date.parse("2026-09-09T02:00:00Z");
  let calls = 0;
  let fail = false;
  const desk = createZhihuHotlist({
    load: async () => stored,
    save: async (value) => { stored = value; },
    now: () => now,
    run: async () => { calls++; if (fail) throw new Error("secret upstream content"); return rows; },
  });
  await Promise.all([desk.refresh(), desk.refresh(), desk.refresh()]);
  assert.equal(calls, 1);
  assert.equal((await desk.read()).status, "ready");
  now += 16 * 60_000;
  assert.equal((await desk.read()).status, "stale");
  fail = true;
  const stale = await desk.refresh();
  assert.equal(stale.status, "stale");
  assert.equal(stale.items.length, 2);
  assert.equal(stale.capturedAt, "2026-09-09T02:00:00.000Z");
  assert.doesNotMatch(stale.error ?? "", /secret/);
  await desk.refresh();
  assert.equal(calls, 2);
  assert.equal((await createZhihuHotlist({ load: async () => stored, save: async () => {}, now: () => now, run: async () => rows }).read()).status, "stale");
});
