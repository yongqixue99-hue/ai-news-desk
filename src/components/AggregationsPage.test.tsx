import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import { AggregationsPage } from "./AggregationsPage.js";

test("aggregation title translation has one explicit manual entry point and never hides the original list", () => {
  const $ = load(renderToStaticMarkup(createElement(AggregationsPage, { onNavigate: () => undefined, onNotice: () => undefined })));
  const button = $("button").filter((_, element) => $(element).text().includes("翻译本页标题"));
  assert.equal(button.length, 1); assert.equal(button.attr("disabled"), "disabled");
  assert.match($(".aggregation-translation-tools").text(), /最多 20 条/u);
  assert.equal($(".aggregation-list").length, 1);
});
