import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createDefaultState } from "../../server/defaults.js";
import { SourcesPage } from "./SourcesPage.js";

test("sources page exposes X credentials and identifies X as an official source adapter", () => {
  const state = createDefaultState();
  const markup = renderToStaticMarkup(createElement(SourcesPage, {
    sources: state.sources,
    sourcePresets: state.sourcePresets,
    onSave: async () => undefined,
    onAdd: async () => undefined,
    onDelete: async () => undefined,
    onBatch: async () => undefined,
    onTest: async () => undefined,
    onCreatePreset: async () => undefined,
    onApplyPreset: async () => undefined,
    onDeletePreset: async () => undefined,
  }));

  assert.match(markup, /X 官方账号采集/u);
  assert.match(markup, /type="password"/u);
  assert.match(markup, /Bearer Token/u);
  assert.match(markup, /X 官方/u);
});

test("each source exposes one clear three-state collection control and an exception-first health summary", () => {
  const state = createDefaultState();
  const markup = renderToStaticMarkup(createElement(SourcesPage, {
    sources: state.sources,
    sourcePresets: state.sourcePresets,
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
