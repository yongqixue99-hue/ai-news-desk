import assert from "node:assert/strict";
import test from "node:test";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import {
  InlineCompletionExtension,
  inlineCompletionAcceptance,
  inlineCompletionTransaction,
} from "./tiptap-inline-completion.js";

test("IME confirmation and Shift+Tab never accept ghost text", () => {
  const schema = getSchema([StarterKit]);
  const doc = schema.node("doc", undefined, [schema.node("paragraph", undefined, [schema.text("前文")])]);
  const plugin = InlineCompletionExtension.config.addProseMirrorPlugins!.call({ options: {} } as never)[0];
  let state = EditorState.create({ schema, doc, selection: TextSelection.atEnd(doc), plugins: [plugin] });
  state = state.apply(state.tr.setMeta(plugin.spec.key!, { type: "show", value: { position: state.selection.from, text: "补全内容。" } }));
  for (const modifiers of [{ shiftKey: true }, { isComposing: true }, { keyCode: 229 }]) {
    let applied = false;
    const view = { state, composing: false, dispatch: () => { applied = true; } };
    const event = { key: "Tab", preventDefault() {}, ...modifiers };
    assert.equal(plugin.props.handleKeyDown!.call(plugin, view as never, event as never), false);
    assert.equal(applied, false);
  }
});

test("Tab accepts the next predicted paragraph while an explicit shortcut can accept all", () => {
  assert.deepEqual(
    inlineCompletionAcceptance("接着当前段写完。\n\n这是预测的下一段。", false),
    {
      acceptedText: "接着当前段写完。",
      remainingText: "这是预测的下一段。",
    },
  );
  assert.deepEqual(
    inlineCompletionAcceptance("接着当前段写完。\n\n这是预测的下一段。", true),
    {
      acceptedText: "接着当前段写完。\n\n这是预测的下一段。",
      remainingText: "",
    },
  );
});

test("accepting a cross-paragraph ghost suggestion creates real article paragraphs", () => {
  const schema = getSchema([StarterKit]);
  const doc = schema.node("doc", undefined, [
    schema.node("paragraph", undefined, [schema.text("前文")]),
  ]);
  const state = EditorState.create({
    schema,
    doc,
    selection: TextSelection.atEnd(doc),
  });

  const transaction = inlineCompletionTransaction(
    state,
    "接着当前段写完。\n\n这是预测的下一段。",
  );

  assert.deepEqual(transaction.doc.toJSON(), {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "前文接着当前段写完。" }] },
      { type: "paragraph", content: [{ type: "text", text: "这是预测的下一段。" }] },
    ],
  });
  assert.equal(transaction.selection.empty, true);
  assert.equal(transaction.selection.$from.parent.textContent, "这是预测的下一段。");
});
