import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceInlineCompletion,
  beginInlineCompletion,
  createInlineCompletionState,
  handleInlineCompletionKey,
  invalidateInlineCompletion,
  resolveInlineCompletion,
} from "./inline-completion-state.js";

test("typing along the ghost text keeps the remaining suggestion without a new request", () => {
  const started = beginInlineCompletion(createInlineCompletionState(), "draft-a:position-12");
  const visible = resolveInlineCompletion(started.state, {
    token: started.token,
    contextKey: "draft-a:position-12",
    text: "模型现已开放 API。",
  });

  const advanced = advanceInlineCompletion(visible, "模型现已", "draft-a:position-16");
  assert.equal(advanced?.status, "visible");
  assert.equal(advanced?.text, "开放 API。");
  assert.equal(advanced?.contextKey, "draft-a:position-16");
  assert.equal(advanceInlineCompletion(visible, "并不一致", "other"), undefined);
});

test("a stale completion cannot replace the suggestion for a newer cursor context", () => {
  const initial = createInlineCompletionState();
  const first = beginInlineCompletion(initial, "draft-a:position-10");
  const second = beginInlineCompletion(first.state, "draft-a:position-12");

  const afterStale = resolveInlineCompletion(second.state, {
    token: first.token,
    contextKey: "draft-a:position-10",
    text: "旧建议",
  });
  assert.equal(afterStale.text, undefined);
  assert.equal(afterStale.status, "loading");

  const afterCurrent = resolveInlineCompletion(afterStale, {
    token: second.token,
    contextKey: "draft-a:position-12",
    text: "当前建议",
  });
  assert.equal(afterCurrent.status, "visible");
  assert.equal(afterCurrent.text, "当前建议");
});

test("Tab accepts only visible text while Escape and edits dismiss without inserting", () => {
  const started = beginInlineCompletion(createInlineCompletionState(), "draft-a:position-12");
  const visible = resolveInlineCompletion(started.state, {
    token: started.token,
    contextKey: "draft-a:position-12",
    text: "建议文字。",
  });

  const accepted = handleInlineCompletionKey(visible, "Tab");
  assert.equal(accepted.handled, true);
  assert.equal(accepted.acceptedText, "建议文字。");
  assert.equal(accepted.state.status, "idle");

  const ordinaryTab = handleInlineCompletionKey(accepted.state, "Tab");
  assert.equal(ordinaryTab.handled, false);
  assert.equal(ordinaryTab.acceptedText, undefined);

  const visibleAgain = resolveInlineCompletion(started.state, {
    token: started.token,
    contextKey: "draft-a:position-12",
    text: "另一个建议。",
  });
  const dismissed = handleInlineCompletionKey(visibleAgain, "Escape");
  assert.equal(dismissed.handled, true);
  assert.equal(dismissed.acceptedText, undefined);
  assert.equal(dismissed.state.status, "idle");

  const invalidated = invalidateInlineCompletion(visibleAgain);
  assert.equal(invalidated.status, "idle");
  assert.equal(invalidated.text, undefined);
  assert.notEqual(invalidated.token, visibleAgain.token);
});
