import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSocialMetadata, socialArticleTitle, socialMetadataBinding } from "./social-metadata.js";
import { createDefaultState } from "./defaults.js";
import { createBlankDraftInState } from "./draft-library.js";
import { appendDraftRevision, restoreDraftRevision } from "./draft-revisions.js";
import { editableDraftContent } from "../src/draft-stability.js";

test("empty metadata falls back to the original document and malformed metadata fails explicitly", () => {
  const draft = createBlankDraftInState(createDefaultState()); draft.title = "原始标题";
  assert.deepEqual(normalizeSocialMetadata({ zhihu: { title: "  ", coverPlacementId: "" } }), {});
  assert.equal(socialArticleTitle(draft, "zhihu"), "原始标题"); assert.equal(socialMetadataBinding(draft, "zhihu"), "");
  for (const input of [null, [], { evil: {} }, { zhihu: { title: 3 } }, { zhihu: { coverPlacementId: {} } }]) assert.throws(() => normalizeSocialMetadata(input));
});
test("platform variants survive recovery and revision restoration with a backup of current settings", () => {
  const state = createDefaultState(), draft = createBlankDraftInState(state);
  draft.socialMetadata = normalizeSocialMetadata({ zhihu: { title: " 知乎标题 ", coverPlacementId: "one" }, baijiahao: { title: "百家号标题" } });
  const revision = appendDraftRevision(state, draft, "manual");
  assert.deepEqual(editableDraftContent(draft).socialMetadata, draft.socialMetadata);
  draft.socialMetadata.zhihu!.title = "新标题";
  restoreDraftRevision(state, draft, revision);
  assert.equal(draft.socialMetadata?.zhihu?.title, "知乎标题");
  assert.equal(state.draftRevisions.at(-1)?.snapshot.socialMetadata?.zhihu?.title, "新标题");
});
