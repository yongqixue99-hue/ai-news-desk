import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultState } from "./defaults.js";
import { createContentPackageDesk } from "./content-package-desk.js";

test("unreadable factual source fails before costly image and discussion work", async () => {
  let imageCalls = 0;
  const desk = createContentPackageDesk({ readState: async () => createDefaultState(),
    prepareArticleEvidence: async () => { throw new Error("HTTP 403: original unavailable"); },
    hydrateAssets: async () => { imageCalls++; throw new Error("image work should not run"); },
    hydrateDiscussion: async () => [],
  });
  await assert.rejects(desk.buildAndSave("story", "brief"), /original unavailable/u);
  assert.equal(imageCalls, 0);
});
