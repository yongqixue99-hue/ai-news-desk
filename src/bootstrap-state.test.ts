import assert from "node:assert/strict";
import test from "node:test";
import { resolveBootstrap } from "./bootstrap-state.js";

test("bootstrap failure becomes a persistent error state with its reason", async () => {
  const result = await resolveBootstrap(async () => {
    throw new Error("本地数据库暂时不可用");
  });

  assert.deepEqual(result, {
    status: "error",
    message: "本地数据库暂时不可用",
  });
});
