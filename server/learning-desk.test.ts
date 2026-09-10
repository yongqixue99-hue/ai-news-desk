import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inferWritingPreferences, recordDraftEdit, writingMemoryView } from "./learning-desk.js";
import { LocalDatabase } from "./local-database.js";
import type { DraftRevisionSnapshot } from "./types.js";

const snapshot = (intro: string, overrides: Partial<DraftRevisionSnapshot> = {}): DraftRevisionSnapshot => ({
  title: "测试文章",
  paragraphs: [intro, "第二段用于说明事实。"],
  take: "",
  sources: [],
  factClaims: [],
  uncertainties: [],
  images: [],
  community: "",
  topics: [],
  ...overrides,
});

test("LearningDesk infers only explainable changes from an edit", () => {
  const before = snapshot(`这是一次重磅而且革命性的全面升级，${"背景内容".repeat(20)}`);
  const after = snapshot("公司在 8 月 30 日发布版本 2.0，价格下降 20%。");
  const kinds = inferWritingPreferences(before, after).map((entry) => entry.kind);
  assert.ok(kinds.includes("remove-promotional-language"));
  assert.ok(kinds.includes("prefer-specific-numbers"));
  assert.ok(kinds.includes("shorter-introduction"));
});

test("writing memory learns image density from inserted images rather than the research tray", () => {
  const image = (id: string): DraftRevisionSnapshot["images"][number] => ({
    id, afterParagraph: 0, caption: id,
    image: { id, url: `https://example.com/${id}.png`, caption: id, attribution: "Official", sourceUrl: "https://example.com/news", selected: true, rights: "check-required" },
  });
  const before = snapshot("正文。", { bodyHtml: '<p>正文。</p><img data-media-id="one" />', images: [image("one")] });
  const trayOnly = { ...before, images: [...before.images, image("two"), image("three")] };
  assert.equal(inferWritingPreferences(before, trayOnly).some((preference) => preference.kind === "higher-image-density"), false);
  const inserted = { ...trayOnly, bodyHtml: `${before.bodyHtml}<img data-media-id="two" /><img data-media-id="two" />` };
  const preference = inferWritingPreferences(trayOnly, inserted).find((entry) => entry.kind === "higher-image-density");
  assert.equal(preference?.summary, "正文图片由 1 张增加到 2 张。");
});

test("writing preferences stay dormant until five confirmed human edits and remain user-controllable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-learning-"));
  const legacyStatePath = path.join(root, "state.json");
  await writeFile(legacyStatePath, JSON.stringify({ version: 11 }), "utf8");
  const database = await LocalDatabase.open({
    workflowRoot: root,
    legacyStatePath,
    initialState: () => ({ version: 11 }),
  });
  try {
    for (let index = 0; index < 5; index += 1) {
      recordDraftEdit(database, {
        draftId: `draft-${index}`,
        before: snapshot(`这是一段重磅导语，${"背景信息".repeat(20)}`),
        after: snapshot(`公司发布版本 ${index + 1}.0，成本下降 ${10 + index}%。`),
        saveMode: "manual", confirmed: true,
      });
    }
    const view = writingMemoryView(database);
    assert.equal(view.effectiveEditCount, 5);
    assert.equal(view.applicationUnlocked, true);
    const promotional = view.memories.find((memory) => memory.kind === "remove-promotional-language");
    assert.equal(promotional?.evidenceCount, 5);
    assert.equal(promotional?.applicable, true);

    const paused = writingMemoryView(database, false);
    assert.equal(paused.memories.some((memory) => memory.applicable), false);
    assert.equal(paused.effectiveEditCount, 5);
    assert.equal(paused.memories.find((memory) => memory.id === promotional!.id)?.enabled, true);

    database.setEditorialMemoryEnabled(promotional!.id, false);
    assert.equal(writingMemoryView(database).memories.find((memory) => memory.id === promotional!.id)?.applicable, false);
    assert.equal(database.deleteEditorialMemory(promotional!.id), true);
    assert.equal(writingMemoryView(database).memories.some((memory) => memory.id === promotional!.id), false);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("autosave does not train writing memory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-learning-auto-"));
  const legacyStatePath = path.join(root, "state.json");
  await writeFile(legacyStatePath, JSON.stringify({ version: 11 }), "utf8");
  const database = await LocalDatabase.open({ workflowRoot: root, legacyStatePath, initialState: () => ({ version: 11 }) });
  try {
    recordDraftEdit(database, {
      draftId: "draft-auto",
      before: snapshot("重磅发布，背景信息很多。"),
      after: snapshot("公司发布了版本 2.0。"),
      saveMode: "auto",
    });
    recordDraftEdit(database, { draftId: "draft-manual-unconfirmed", before: snapshot("重磅发布，背景信息很多。"), after: snapshot("公司发布了版本 2.0。"), saveMode: "manual" });
    assert.equal(writingMemoryView(database).effectiveEditCount, 0);
    assert.deepEqual(database.listEditorialMemories(), []);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
