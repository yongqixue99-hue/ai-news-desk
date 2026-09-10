import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { canSplit } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

interface GhostCompletion {
  position: number;
  text: string;
}

type CompletionMeta =
  | { type: "show"; value: GhostCompletion }
  | { type: "clear" };

interface InlineCompletionOptions {
  onAccept?: (text: string, remainingText: string) => void;
  onDismiss?: () => void;
}

const pluginKey = new PluginKey<GhostCompletion | undefined>("ai-news-inline-completion");

const insertionParagraphs = (text: string) => text
  .split(/\r?\n\s*\r?\n+/u)
  .map((paragraph) => paragraph.replace(/\s+/gu, " ").trim())
  .filter(Boolean)
  .slice(0, 2);

export const inlineCompletionAcceptance = (text: string, acceptAll: boolean) => {
  const paragraphs = insertionParagraphs(text);
  const normalized = paragraphs.join("\n\n");
  if (acceptAll || paragraphs.length <= 1) {
    return { acceptedText: normalized, remainingText: "" };
  }
  return {
    acceptedText: paragraphs[0] ?? "",
    remainingText: paragraphs.slice(1).join("\n\n"),
  };
};

/** Build the exact ProseMirror change used when a user accepts visible ghost text. */
export const inlineCompletionTransaction = (
  state: EditorState,
  text: string,
): Transaction => {
  const paragraphs = insertionParagraphs(text);
  const transaction = state.tr.setMeta("newsdesk-ai-insertion", true);
  if (!paragraphs.length) return transaction;
  transaction.insertText(paragraphs[0]);
  for (const paragraph of paragraphs.slice(1)) {
    const position = transaction.selection.from;
    if (canSplit(transaction.doc, position)) {
      transaction.split(position);
      transaction.insertText(paragraph);
    } else {
      transaction.insertText(` ${paragraph}`);
    }
  }
  return transaction.scrollIntoView();
};

export const showInlineCompletion = (editor: Editor, value: GhostCompletion) => {
  editor.view.dispatch(editor.state.tr.setMeta(pluginKey, { type: "show", value } satisfies CompletionMeta));
};

export const clearInlineCompletion = (editor: Editor) => {
  if (!pluginKey.getState(editor.state)) return;
  editor.view.dispatch(editor.state.tr.setMeta(pluginKey, { type: "clear" } satisfies CompletionMeta));
};

export const currentInlineCompletion = (editor: Editor) => pluginKey.getState(editor.state);

export const InlineCompletionExtension = Extension.create<InlineCompletionOptions>({
  name: "aiNewsInlineCompletion",

  addOptions() {
    return { onAccept: undefined, onDismiss: undefined };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [new Plugin<GhostCompletion | undefined>({
      key: pluginKey,
      state: {
        init: () => undefined,
        apply(transaction, current, oldState, newState) {
          const meta = transaction.getMeta(pluginKey) as CompletionMeta | undefined;
          if (meta?.type === "show") return meta.value;
          if (meta?.type === "clear") return undefined;
          if (transaction.docChanged && current && oldState.selection.empty && newState.selection.empty) {
            const mappedPosition = transaction.mapping.map(current.position, 1);
            if (
              oldState.selection.from === current.position
              && newState.selection.from === mappedPosition
              && mappedPosition > current.position
            ) {
              const insertedText = transaction.doc.textBetween(current.position, mappedPosition, "\n", "\n");
              if (insertedText && current.text.startsWith(insertedText)) {
                const remainingText = current.text.slice(insertedText.length);
                return remainingText ? { position: mappedPosition, text: remainingText } : undefined;
              }
            }
            return undefined;
          }
          if (transaction.docChanged || transaction.selectionSet) return undefined;
          return current;
        },
      },
      props: {
        decorations(state) {
          const completion = pluginKey.getState(state);
          if (!completion || completion.position !== state.selection.from || !state.selection.empty) return null;
          const widget = Decoration.widget(completion.position, () => {
            const span = document.createElement("span");
            span.className = "inline-completion-ghost";
            span.setAttribute("aria-hidden", "true");
            span.textContent = completion.text;
            return span;
          }, { side: 1, key: `inline-completion:${completion.position}:${completion.text}` });
          return DecorationSet.create(state.doc, [widget]);
        },
        handleKeyDown(view, event) {
          if (view.composing || event.isComposing || event.keyCode === 229) return false;
          const completion = pluginKey.getState(view.state);
          if (!completion || completion.position !== view.state.selection.from || !view.state.selection.empty) return false;
          const acceptsAll = event.key === "Enter" && (event.ctrlKey || event.metaKey);
          if ((event.key === "Tab" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) || acceptsAll) {
            event.preventDefault();
            const acceptance = inlineCompletionAcceptance(completion.text, acceptsAll);
            let transaction = inlineCompletionTransaction(view.state, acceptance.acceptedText);
            if (acceptance.remainingText) {
              const position = transaction.selection.from;
              if (canSplit(transaction.doc, position)) transaction = transaction.split(position);
              transaction = transaction.setMeta(pluginKey, {
                type: "show",
                value: { position: transaction.selection.from, text: acceptance.remainingText },
              } satisfies CompletionMeta);
            } else {
              transaction = transaction.setMeta(pluginKey, { type: "clear" } satisfies CompletionMeta);
            }
            view.dispatch(transaction);
            options.onAccept?.(acceptance.acceptedText, acceptance.remainingText);
            return true;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            view.dispatch(view.state.tr.setMeta(pluginKey, { type: "clear" } satisfies CompletionMeta));
            options.onDismiss?.();
            return true;
          }
          return false;
        },
      },
    })];
  },
});
