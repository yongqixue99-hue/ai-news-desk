import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("storage revision advances only after committed writes, replacements and snapshot restores", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "newsdesk-revision-"));
  process.env.AI_NEWS_DESK_WORKFLOW_ROOT = root;
  const { readState, updateState, replaceState, runStorageExclusive, getStateRevision, getLocalDatabase } = await import("./storage.js");
  const { readTodayView } = await import("./today-view-cache.js");
  try {
    const state = await readState(), start = getStateRevision();
    const feedback = { id: "f", kind: "interested" as const, candidateId: "c", runId: "r", title: "example", sourceName: "example", keywords: [], topicIds: ["ai" as const], createdAt: new Date().toISOString() };
    assert.equal((await readTodayView()).funnel.feedbackCount, 0);
    await assert.rejects(updateState(() => { throw new Error("do not commit"); }), /do not commit/u);
    assert.equal(getStateRevision(), start);
    await Promise.all([updateState(s => { s.settings.community = "first"; s.candidateFeedback.push(feedback); }), updateState(s => { s.settings.community = "second"; })]);
    assert.equal(getStateRevision(), start + 2);
    assert.equal((await readTodayView()).funnel.feedbackCount, 1);
    await replaceState(state); assert.equal(getStateRevision(), start + 3);
    assert.equal((await readTodayView()).funnel.feedbackCount, 0);
    const db = await getLocalDatabase();
    const snapshot = path.join(root, "snapshot.db");
    db.createSnapshot(snapshot);
    await updateState(s => { s.settings.community = "later"; s.candidateFeedback.push(feedback); });
    assert.equal((await readTodayView()).funnel.feedbackCount, 1);
    await runStorageExclusive(async ({ replaceDatabaseSnapshot }) => { replaceDatabaseSnapshot(snapshot); });
    assert.equal(getStateRevision(), start + 5);
    assert.equal((await readState()).settings.community, state.settings.community);
    assert.equal((await readTodayView()).funnel.feedbackCount, 0);
  } finally { (await getLocalDatabase()).close(); await rm(root, { recursive: true, force: true }); }
});
