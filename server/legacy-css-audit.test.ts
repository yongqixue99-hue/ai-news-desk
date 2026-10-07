import assert from "node:assert/strict";
import test from "node:test";
import { auditLegacyCss } from "../scripts/legacy-css-analysis.js";

test("CSS audit removes only rules whose every class is unreferenced", () => {
  const css = ".gone { color: red }\n.used, .also-gone { color: blue }\ninput, .missing { color: green }";
  const result = auditLegacyCss(css, ['className="used"']);
  assert.deepEqual(result.removedSelectors, [".gone"]);
  assert.ok(result.css.includes(".used, .also-gone"));
  assert.ok(result.css.includes("input, .missing"), "a global selector arm must survive");
  assert.ok(result.afterBytes < result.beforeBytes);
});

test("CSS audit preserves dynamically constructed classes and nested live ancestors", () => {
  const css = ".status-ready { color: green }\n.draft-selected { color: blue }\n.parent { & .child { color: black } }\n@media (max-width: 720px) { .unused-mobile { display: none } }";
  const result = auditLegacyCss(css, ['`status-${value}`', '"draft-" + state', 'className="parent"']);
  assert.deepEqual(result.removedSelectors, [".unused-mobile"]);
  for (const selector of [".status-ready", ".draft-selected", ".parent", ".child"]) assert.ok(result.css.includes(selector));
});

test("CSS audit preserves export themes, attributes, escapes and functional selectors", () => {
  const css = '.layout-new-theme { color: red }\n.preview-article-title { font-size: 22px }\n[data-kind=".unknown"] { color: green }\n.escaped\\:class { color: blue }\n:not(.absent) { color: black }\n@keyframes moving { from { opacity: 0 } to { opacity: 1 } }';
  assert.equal(auditLegacyCss(css, []).css, css);
});

test("CSS audit searches server export and extension references, not CSS self-references", () => {
  const result = auditLegacyCss(".exported { color: red }\n.extension-live { color: blue }\n.obsolete { color: black }", ['<div class="exported">', 'element.classList.add("extension-live")']);
  assert.deepEqual(result.removedSelectors, [".obsolete"]);
  assert.ok(result.css.includes(".exported"));
  assert.ok(result.css.includes(".extension-live"));
});

test("CSS audit is idempotent and does not remove declarations from retained rules", () => {
  const css = ".live { color: red; width: 10px; }\n.gone { color: green; }";
  const first = auditLegacyCss(css, ["live"]);
  assert.ok(first.css.includes(".live { color: red; width: 10px; }"));
  assert.equal(auditLegacyCss(first.css, ["live"]).css, first.css);
});
