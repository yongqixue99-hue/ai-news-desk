import assert from "node:assert/strict";
import test from "node:test";
import { compareDeliveryFields, xiaoheiheDeliveryChecks, socialDeliveryChecks } from "./delivery-verification.js";

test("missing evidence never becomes a matched field, including falsy values", () => {
  const check = compareDeliveryFields("test/v1", "remote-draft", { title: "标题", comments: 0, cover: "cover" }, { title: "标题", comments: 1 });
  assert.deepEqual(check.fields.map(field => [field.key, field.status]), [["title", "matched"], ["comments", "different"], ["cover", "unobserved"]]);
  assert.equal(check.adapterVersion, "test/v1");
  assert.equal(check.schemaVersion, "delivery-fields/v1");
  assert.equal(JSON.stringify(check).includes('"cover":"cover"'), false, "receipts contain comparison outcomes, not raw platform content");
});
test("Xiaoheihe checks include every publishing field and preserve an absent result", () => {
  const check = xiaoheiheDeliveryChecks([{ name: "标题", ok: true, detail: "读取一致" }, { name: "创作计划", ok: false, detail: "计划不同" }], "0.1.28");
  assert.equal(check.fields.find(field => field.key === "title")?.status, "matched");
  assert.equal(check.fields.find(field => field.key === "creationPlan")?.status, "different");
  assert.equal(check.fields.find(field => field.key === "visibility")?.status, "unobserved");
  assert.equal(check.fields.find(field => field.key === "cover")?.status, "unobserved");
  assert.equal(check.adapterVersion, "xiaoheihe-chrome/0.1.28");
});
test("social helper success does not certify the body, cover or platform settings", () => {
  const check = socialDeliveryChecks("toutiao", "bridge-only");
  assert.ok(check.fields.every(field => field.status === "unobserved"));
  for (const key of ["title", "body", "images", "cover", "settings"]) assert.ok(check.fields.some(field => field.key === key));
});
