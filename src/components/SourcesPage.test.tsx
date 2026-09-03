import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createDefaultState } from "../../server/defaults.js";
import { SourcesPage } from "./SourcesPage.js";

test("sources page leads with a free manual X workflow and keeps paid API monitoring locked in zero-cost mode", () => {
  const state = createDefaultState();
  const markup = renderToStaticMarkup(createElement(SourcesPage, {
    sources: state.sources,
    sourcePresets: state.sourcePresets,
    spendingPolicy: "zero-cost",
    onSave: async () => undefined,
    onAdd: async () => undefined,
    onDelete: async () => undefined,
    onBatch: async () => undefined,
    onTest: async () => undefined,
    onCreatePreset: async () => undefined,
    onApplyPreset: async () => undefined,
    onDeletePreset: async () => undefined,
  }));

  assert.match(markup, /X 免费监控/u);
  assert.match(markup, /不调用计费 X API/u);
  assert.match(markup, /官方 oEmbed 免费读取/u);
  assert.match(markup, /复制重点账号/u);
  assert.match(markup, /付费 X API/u);
  assert.match(markup, /零成本模式下锁定/u);
  assert.match(markup, /高管个人号只作预告线索/u);
  assert.match(markup, /type="password"/u);
  assert.match(markup, /Bearer Token/u);
  assert.match(markup, /X 官方/u);
  assert.match(markup, /console\.x\.com/u);
  assert.match(markup, /每读取 1 条 Post.*\$0\.005/u);
  assert.match(markup, /解除 X \/ Gemini API 锁定/u);
  assert.match(markup, /Keys and tokens/u);
  assert.match(markup, /关闭自动充值/u);
  assert.match(markup, /DPAPI/u);
});

test("each source exposes one clear three-state collection control and an exception-first health summary", () => {
  const state = createDefaultState();
  const markup = renderToStaticMarkup(createElement(SourcesPage, {
    sources: state.sources,
    sourcePresets: state.sourcePresets,
    spendingPolicy: "zero-cost",
    onSave: async () => undefined,
    onAdd: async () => undefined,
    onDelete: async () => undefined,
    onBatch: async () => undefined,
    onTest: async () => undefined,
    onCreatePreset: async () => undefined,
    onApplyPreset: async () => undefined,
    onDeletePreset: async () => undefined,
  }));

  assert.match(markup, />采集状态</u);
  assert.match(markup, />停用</u);
  assert.match(markup, />可手动使用</u);
  assert.match(markup, />默认采集</u);
  assert.match(markup, /只看需关注来源/u);
  assert.match(markup, /个需要关注 · 其中 \d+ 个尚未检查/u);
  assert.match(markup, /aria-label="[^"]+ 的采集状态"/u);
  assert.doesNotMatch(markup, /<span>启用<\/span>.*<span>默认采集<\/span>/u);
});
