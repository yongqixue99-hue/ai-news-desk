import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("projected reads cannot change cached state and observe subsequent committed updates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "newsdesk-projection-"));
  process.env.AI_NEWS_DESK_WORKFLOW_ROOT = root;
  const { readStateProjection, readState, updateState, getLocalDatabase } = await import("./storage.js");
  try {
    const original = await readState();
    const projected = await readStateProjection(state => ({ settings: state.settings, sources: state.sources.slice(0, 1) }));
    projected.settings.community = "a mutation outside storage";
    if (projected.sources[0]) projected.sources[0].name = "changed outside storage";
    assert.deepEqual(await readState(), original);
    await updateState(state => { state.settings.community = "committed value"; });
    assert.equal(await readStateProjection(state => state.settings.community), "committed value");
  } finally {
    (await getLocalDatabase()).close();
    await rm(root, { recursive: true, force: true });
  }
});
