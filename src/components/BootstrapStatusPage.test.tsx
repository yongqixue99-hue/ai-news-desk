import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BootstrapStatusPage } from "./BootstrapStatusPage.js";

test("bootstrap error page explains the failure and offers retry", () => {
  const markup = renderToStaticMarkup(createElement(BootstrapStatusPage, {
    state: { status: "error", message: "本地数据库暂时不可用" },
    onRetry: () => undefined,
  }));

  assert.match(markup, /AI 新闻台没有启动成功/u);
  assert.match(markup, /本地数据库暂时不可用/u);
  assert.match(markup, />重新加载</u);
  assert.match(markup, /role="alert"/u);
});
