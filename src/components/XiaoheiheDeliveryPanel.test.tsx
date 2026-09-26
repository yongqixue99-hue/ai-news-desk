import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createBlankDraftInState } from "../../server/draft-library.js";
import { createDefaultState } from "../../server/defaults.js";
import { XiaoheiheDeliveryPanel } from "./XiaoheiheDeliveryPanel.js";

const props = (): ComponentProps<typeof XiaoheiheDeliveryPanel> => ({
  draft: createBlankDraftInState(createDefaultState()),
  status: "current", busy: false, connected: false, error: "", selectedImageIds: [],
  result: { ok: true, at: "2026-09-26T00:00:00.000Z", pageUrl: "https://www.xiaoheihe.cn/creator/editor/draft/article/test", steps: [{ name: "正文", ok: true, detail: "已核验" }] },
  onChange: () => {}, onSend: () => {}, onSettings: () => {},
  onUpload: async () => { throw new Error("unused"); },
  onConfirmPublished: () => {}, publicationRemembered: false,
});
const render = (patch: Partial<ComponentProps<typeof XiaoheiheDeliveryPanel>> = {}) => renderToStaticMarkup(createElement(XiaoheiheDeliveryPanel, { ...props(), ...patch }));

test("an unchanged delivered draft leads to its existing editor, with refill secondary", () => {
  const html = render();
  assert.match(html, /<a class="primary-button full xhh-send"[^>]*href="https:\/\/www\.xiaoheihe\.cn\/creator\/editor\/draft\/article\/test"/u);
  assert.match(html, /打开小黑盒检查/u);
  assert.match(html, /重新填入/u);
  assert.doesNotMatch(html, />送到小黑盒<|自动连接 Chrome/u);
});

test("unavailable status keeps the receipt without claiming success or an edit", () => {
  for (const status of ["checking", "unknown"] as const) {
    const html = render({ status });
    assert.doesNotMatch(html, /已填好，可以前往检查|内容有更新/u);
    assert.match(html, status === "checking" ? /正在核对交付记录/u : /暂时无法核对交付状态/u);
    assert.match(html, /查看上次填入页面/u);
    assert.match(html, />送到小黑盒</u);
  }
});

test("real edits ask for update while failed checks ask for retry", () => {
  assert.match(render({ status: "changed" }), />更新到小黑盒</u);
  const html = render({ status: "failed", error: "封面：请补充封面", result: { ...props().result!, ok: false, steps: [{ name: "封面", ok: false, detail: "请补充封面" }] } });
  assert.match(html, />重试填入</u);
  assert.match(html, /封面：请补充封面/u);
  assert.doesNotMatch(html, /内容有更新/u);
  assert.equal((html.match(/封面：请补充封面/gu) ?? []).length, 1, "structured failure should not be repeated as a second alert");
});
