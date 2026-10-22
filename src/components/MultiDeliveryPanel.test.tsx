import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createBlankDraftInState } from "../../server/draft-library.js";
import { createDefaultState } from "../../server/defaults.js";
import { MultiDeliveryPanel } from "./MultiDeliveryPanel.js";

test("one delivery panel exposes six equal channels and makes no unverified capability claims", () => {
  const html = renderToStaticMarkup(createElement(MultiDeliveryPanel, {
    draft: createBlankDraftInState(createDefaultState()), dirty: false, disabled: false,
    prepare: async () => undefined, onBusy: () => {}, onOpenSettings: () => {}, onDelivered: () => {}, onChange: () => {},
  }));
  assert.match(html, /小红书/u);
  assert.match(html, /未接通/u);
  assert.match(html, /未验收/u);
  assert.doesNotMatch(html, /checked=""/u, "a new writer chooses their destinations once");
});
