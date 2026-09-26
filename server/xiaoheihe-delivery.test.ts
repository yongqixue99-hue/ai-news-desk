import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultState } from "./defaults.js";
import { createDeliveryDesk } from "./delivery-desk.js";
import { createBlankDraftInState } from "./draft-library.js";
import { publicationRevisionHash } from "./publication-state.js";
import { evaluatePublisherPreflight } from "./publisher-preflight.js";
import { createXiaoheiheDelivery } from "./xiaoheihe-delivery.js";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(release => { resolve = release; });
  return { promise, resolve };
};

const fixture = () => {
  const state = createDefaultState();
  const draft = createBlankDraftInState(state);
  draft.title = "交付并发测试";
  draft.bodyHtml = "<p>这是足够长的一段正文，用来检查连接和预检期间是否会重复交付。</p>";
  draft.community = "盒友杂谈";
  draft.topics = ["AI"];
  const revision = publicationRevisionHash(draft, "xiaoheihe");
  const preflight = evaluatePublisherPreflight({
    expectedRevisionHash: revision,
    runtime: { mode: "chrome-extension", connected: true, protocolVersion: "0.1.24" },
    draft: { id: draft.id, title: draft.title, bodyHtml: draft.bodyHtml,
      community: draft.community, topics: draft.topics, images: [] },
  });
  const counts = { connect: 0, preflight: 0, fill: 0, record: 0 };
  assert.equal(preflight.canQueueFill, true, JSON.stringify(preflight.blocking));
  const dependencies: Parameters<typeof createXiaoheiheDelivery>[0] = {
    deliveryDesk: createDeliveryDesk(),
    connect: async () => { counts.connect++; },
    preflight: async () => { counts.preflight++; return preflight; },
    fill: async () => {
      counts.fill++;
      return { at: new Date().toISOString(), ok: true, revisionHash: revision,
        pageUrl: `https://www.xiaoheihe.cn/creator/editor/draft/article/local_${counts.fill}`,
        steps: ["标题", "正文", "配图", "分区", "话题"].map(name => ({ name, ok: true, detail: "verified" })),
        warning: "只填入，不发布" };
    },
    record: async () => { counts.record++; return { revision, updatedAt: new Date().toISOString() }; },
  };
  return { draft, settings: state.settings, revision, preflight, counts, dependencies };
};

test("concurrent delivery while Chrome wakes opens one connection and returns one receipt", async () => {
  const { draft, settings, counts, dependencies } = fixture();
  const opening = deferred();
  const entered = deferred();
  dependencies.connect = async () => { counts.connect++; entered.resolve(); await opening.promise; };
  const delivery = createXiaoheiheDelivery(dependencies);
  const first = delivery.deliver(draft, settings);
  await entered.promise;
  const second = delivery.deliver(draft, settings);
  opening.resolve();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(counts.connect, 1, "one user action must not open two Chrome pairing pages");
  assert.deepEqual(counts, { connect: 1, preflight: 1, fill: 1, record: 1 });
  assert.strictEqual(left, right);
  assert.equal(left.status, 200);
});

test("a second request during slow preflight cannot dispatch after the first fill finishes", async () => {
  const { draft, settings, preflight, counts, dependencies } = fixture();
  const firstCheck = deferred();
  const secondCheck = deferred();
  const checking = deferred();
  dependencies.preflight = async () => {
    counts.preflight++;
    const wait = counts.preflight === 1 ? firstCheck : secondCheck;
    checking.resolve();
    await wait.promise;
    return preflight;
  };
  const delivery = createXiaoheiheDelivery(dependencies);
  const first = delivery.deliver(draft, settings);
  await checking.promise;
  const second = delivery.deliver(draft, settings);
  firstCheck.resolve();
  const result = await first;
  secondCheck.resolve();
  const laterResult = await second;
  assert.equal(counts.fill, 1, "the later preflight must not create another remote editor");
  assert.equal(counts.record, 1);
  assert.strictEqual(result, laterResult);
});

test("a completed receipt is historical evidence and never replaces a later platform attempt", async () => {
  const { draft, settings, counts, dependencies } = fixture();
  const delivery = createXiaoheiheDelivery(dependencies);
  const first = await delivery.deliver(draft, settings);
  const second = await delivery.deliver(draft, settings);
  assert.deepEqual(counts, { connect: 2, preflight: 2, fill: 2, record: 2 });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  if (first.status === 200 && second.status === 200) {
    assert.notEqual(first.body.receipt?.attemptId, second.body.receipt?.attemptId);
    assert.notEqual(first.body.pageUrl, second.body.pageUrl);
  }
});

test("a changed version is rejected before opening Chrome while an earlier version connects", async () => {
  const { draft, settings, counts, dependencies } = fixture();
  const opening = deferred();
  const entered = deferred();
  dependencies.connect = async () => { counts.connect++; entered.resolve(); await opening.promise; };
  const delivery = createXiaoheiheDelivery(dependencies);
  const first = delivery.deliver(draft, settings);
  await entered.promise;
  const changed = { ...draft, title: "在连接期间修改的新标题" };
  await assert.rejects(delivery.deliver(changed, settings), /另一个版本/);
  opening.resolve();
  await first;
  assert.deepEqual(counts, { connect: 1, preflight: 1, fill: 1, record: 1 });
});

test("a connection failure is shared and a later explicit retry can succeed", async () => {
  const { draft, settings, counts, dependencies } = fixture();
  const opening = deferred();
  const entered = deferred();
  dependencies.connect = async () => {
    counts.connect++;
    if (counts.connect === 1) {
      entered.resolve();
      await opening.promise;
      throw new Error("助手尚未响应");
    }
  };
  const delivery = createXiaoheiheDelivery(dependencies);
  const first = delivery.deliver(draft, settings);
  await entered.promise;
  const second = delivery.deliver(draft, settings);
  const results = Promise.allSettled([first, second]);
  opening.resolve();
  assert.ok((await results).every(result => result.status === "rejected"));
  assert.deepEqual(counts, { connect: 1, preflight: 0, fill: 0, record: 0 });
  assert.equal((await delivery.deliver(draft, settings)).status, 200);
  assert.deepEqual(counts, { connect: 2, preflight: 1, fill: 1, record: 1 });
});

test("blocked concurrent attempts persist one failure receipt without dispatching to Chrome", async () => {
  const { draft, settings, counts, preflight, dependencies } = fixture();
  const checking = deferred();
  const entered = deferred();
  const blocked = { ...preflight, canQueueFill: false, summary: "图片文件缺失" };
  dependencies.preflight = async () => {
    counts.preflight++;
    entered.resolve();
    await checking.promise;
    return blocked;
  };
  const delivery = createXiaoheiheDelivery(dependencies);
  const first = delivery.deliver(draft, settings);
  await entered.promise;
  const second = delivery.deliver(draft, settings);
  checking.resolve();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(left.status, 409);
  assert.strictEqual(left, right);
  assert.equal(left.body.receipt?.outcome, "blocked");
  assert.deepEqual(counts, { connect: 1, preflight: 1, fill: 0, record: 1 });
});

test("a transport result for another revision is never recorded as the current delivery", async () => {
  const { draft, settings, counts, dependencies } = fixture();
  const fill = dependencies.fill;
  dependencies.fill = async (...args) => ({ ...await fill(...args), revisionHash: "wrong-revision" });
  await assert.rejects(createXiaoheiheDelivery(dependencies).deliver(draft, settings), /预检后/);
  assert.equal(counts.record, 0);
});

test("a draft edited during filling preserves the attempt but cannot return current-version success", async () => {
  const { draft, settings, counts, dependencies } = fixture();
  dependencies.record = async () => { counts.record++; return { revision: "newer-revision" }; };
  await assert.rejects(createXiaoheiheDelivery(dependencies).deliver(draft, settings), /预检后/);
  assert.equal(counts.record, 1);
});
