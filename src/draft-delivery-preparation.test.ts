import assert from "node:assert/strict";
import test from "node:test";
import { deliveryPreparationPatch } from "./draft-delivery-preparation.js";

test("multi-platform delivery fills required Xiaoheihe defaults before saving", () => {
  assert.deepEqual(deliveryPreparationPatch({ community: "Codex", topics: ["ai"] }, ["wechat", "xiaoheihe"], "数码硬件"), {
    community: "CodeX", topics: ["AI", "盒友杂谈", "盒友日常", "Steam 游戏"],
    xiaoheiheOptions: { creationPlan: "none", companionCommunity: "数码硬件", coverPlacementId: undefined },
  });
});

test("unchanged defaults keep the saved companion, plan and cover on retry", () => {
  const draft = { community: "CodeX", topics: ["AI", "盒友杂谈", "盒友日常", "Steam 游戏", "科技"],
    xiaoheiheOptions: { creationPlan: "hot" as const, companionCommunity: "Steam" as const, coverPlacementId: "cover" } };
  assert.equal(deliveryPreparationPatch(draft, ["xiaoheihe"], "数码硬件"), undefined);
  assert.equal(deliveryPreparationPatch(draft, ["wechat", "zhihu"]), undefined);
});

test("exclusive community gets fixed topics without reserving a companion", () => {
  const patch = deliveryPreparationPatch({ community: "和友杂谈", topics: [] }, ["xiaoheihe"]);
  assert.equal(patch?.community, "盒友杂谈");
  assert.equal(patch?.xiaoheiheOptions?.companionCommunity, undefined);
  assert.equal(patch?.xiaoheiheOptions?.creationPlan, "none");
  assert.equal(patch?.topics?.length, 4);
});
