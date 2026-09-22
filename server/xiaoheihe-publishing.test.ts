import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultState } from "./defaults.js";
import { createBlankDraftInState } from "./draft-library.js";
import { normalizeXiaoheiheOptions, reserveXiaoheiheDefaults, xiaoheiheSelection, XHH_FIXED_TOPICS } from "./xiaoheihe-publishing.js";
import { publicationRevisionHash } from "./publication-state.js";
import { snapshotDraft, restoreDraftRevision } from "./draft-revisions.js";
import { ensurePublisherConnected } from "./publishing.js";
import { evaluatePublisherPreflight, createPublisherAttempt, completePublisherAttempt } from "./publisher-preflight.js";

test("exclusive community, mandatory topics, aliases and a single extra topic", () => {
  const selection = xiaoheiheSelection({ community: "和友杂谈", topics: ["ai", "Steam游戏", "和友日常", "科技", "OpenAI"], xiaoheiheOptions: { creationPlan: "none", companionCommunity: "Steam" } });
  assert.deepEqual(selection.communities, ["盒友杂谈"]);
  assert.deepEqual(selection.topics, [...XHH_FIXED_TOPICS, "科技"]);
  assert.deepEqual(xiaoheiheSelection({ community: "Codex", topics: [] }).communities, ["CodeX", "Steam"]);
  assert.deepEqual(xiaoheiheSelection({ community: "Steam 游戏", topics: [] }).communities, ["Steam", "数码硬件"]);
});

test("companion alternates once per new draft, not on autosave or retry", () => {
  const state = createDefaultState();
  const first = createBlankDraftInState(state); first.community = "CodeX";
  reserveXiaoheiheDefaults(first, state.settings);
  assert.equal(first.xiaoheiheOptions?.companionCommunity, "Steam");
  reserveXiaoheiheDefaults(first, state.settings, structuredClone(first));
  assert.equal(state.settings.xiaoheiheNextCompanion, "数码硬件");
  const exclusive = createBlankDraftInState(state); exclusive.community = "盒友杂谈";
  reserveXiaoheiheDefaults(exclusive, state.settings);
  assert.equal(state.settings.xiaoheiheNextCompanion, "数码硬件");
  const second = createBlankDraftInState(state); second.community = "CodeX";
  reserveXiaoheiheDefaults(second, state.settings);
  assert.equal(second.xiaoheiheOptions?.companionCommunity, "数码硬件");
  assert.equal(state.settings.xiaoheiheNextCompanion, "Steam");
});

test("plan and cover changes invalidate only Xiaoheihe delivery and survive history restore", () => {
  const state = createDefaultState(); const draft = createBlankDraftInState(state);
  draft.xiaoheiheOptions = { creationPlan: "hot", coverPlacementId: "cover-one" };
  const originalXhh = publicationRevisionHash(draft, "xiaoheihe"), originalWeChat = publicationRevisionHash(draft, "wechat");
  const snapshot = snapshotDraft(draft);
  draft.xiaoheiheOptions.coverPlacementId = "cover-two";
  assert.notEqual(publicationRevisionHash(draft, "xiaoheihe"), originalXhh);
  assert.equal(publicationRevisionHash(draft, "wechat"), originalWeChat);
  restoreDraftRevision(state, draft, { id: "restore", draftId: draft.id, createdAt: draft.updatedAt, updatedAt: draft.updatedAt, kind: "manual", label: "saved", snapshot });
  assert.equal(draft.xiaoheiheOptions.coverPlacementId, "cover-one");
  assert.throws(() => normalizeXiaoheiheOptions({ creationPlan: "unexpected" }), /有效/);
});

test("sending automatically connects once and a connected browser requires no extra operation", async () => {
  const settings = createDefaultState().settings; let reads = 0, opens = 0;
  const status = async () => ({ mode: "chrome-extension" as const, ok: ++reads > 2, detail: "test" });
  const dependencies = { status, open: async () => { opens++; }, wait: async () => {}, attempts: 3 };
  await ensurePublisherConnected(settings, dependencies);
  await ensurePublisherConnected(settings, dependencies);
  assert.equal(opens, 1);
  await assert.rejects(ensurePublisherConnected(settings, { ...dependencies, attempts: 1, status: async () => ({ mode: "chrome-extension", ok: false, detail: "offline" }) }), /尚未响应/);
});

test("delivery waits through Chrome's normal thirty-second background wake interval", async () => {
  let reads = 0;
  let opened = 0;
  await ensurePublisherConnected(createDefaultState().settings, {
    status: async () => ({ mode: "chrome-extension", ok: ++reads > 45, detail: "wake pending" }),
    open: async () => { opened++; },
    wait: async () => {},
  });
  assert.equal(opened, 1);
});

test("participating requires a verified cover and receipt cannot omit publishing options", () => {
  const input = { runtime: { mode: "chrome-extension" as const, connected: true, protocolVersion: "0.1.24" }, draft: { id: "draft", title: "测试标题", bodyHtml: "<p>这是一段用于发布前检查的独立测试内容，正文长度足够。</p>", community: "CodeX · Steam", topics: [...XHH_FIXED_TOPICS], images: [], xiaoheiheOptions: { creationPlan: "hot" as const, coverPlacementId: "cover" }, coverAvailable: false } };
  assert.equal(evaluatePublisherPreflight(input).canQueueFill, false);
  const ready = evaluatePublisherPreflight({ ...input, draft: { ...input.draft, coverAvailable: true } });
  assert.equal(ready.canQueueFill, true);
  const steps = ["标题", "正文", "配图", "分区", "话题"].map(name => ({ name, ok: true, detail: "verified" }));
  const incomplete = completePublisherAttempt(createPublisherAttempt(ready), { steps });
  assert.notEqual(incomplete.outcome, "filled");
  assert.ok(incomplete.blocking.some(issue => issue.id === "cover"));
  const full = completePublisherAttempt(createPublisherAttempt(ready), { steps: [...steps, ...["可见范围", "创作计划", "内容封面"].map(name => ({ name, ok: true, detail: "verified" }))] });
  assert.equal(full.outcome, "filled");
  assert.deepEqual(full.usedImageIds, ["cover"]);
});
