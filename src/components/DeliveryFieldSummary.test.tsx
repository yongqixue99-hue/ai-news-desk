import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { socialDeliveryChecks, compareDeliveryFields } from "../../server/delivery-verification.js";
import { DeliveryFieldSummary } from "./DeliveryFieldSummary.js";

test("field results stay folded and a helper receipt never implies complete verification", () => {
  const html = renderToStaticMarkup(createElement(DeliveryFieldSummary, { checks: socialDeliveryChecks("baijiahao") }));
  assert.match(html, /字段核对 0\/5/u); assert.match(html, /尚未回读/u); assert.doesNotMatch(html, /open=""|已核对 5 项/u);
  const mismatch = renderToStaticMarkup(createElement(DeliveryFieldSummary, { checks: compareDeliveryFields("test/v1", "remote-draft", { comments: 0 }, { comments: 1 }) }));
  assert.match(mismatch, /1 项与发送设置不同/u); assert.match(mismatch, /留言权限/u);
});
