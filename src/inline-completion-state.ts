export type InlineCompletionStatus = "idle" | "loading" | "visible";

export interface InlineCompletionState {
  status: InlineCompletionStatus;
  token: number;
  contextKey?: string;
  text?: string;
}

export const createInlineCompletionState = (): InlineCompletionState => ({
  status: "idle",
  token: 0,
});

export const beginInlineCompletion = (
  state: InlineCompletionState,
  contextKey: string,
) => {
  const token = state.token + 1;
  return {
    token,
    state: {
      status: "loading" as const,
      token,
      contextKey,
    },
  };
};

export const resolveInlineCompletion = (
  state: InlineCompletionState,
  result: { token: number; contextKey: string; text?: string },
): InlineCompletionState => {
  if (result.token !== state.token || result.contextKey !== state.contextKey) return state;
  const text = result.text?.trim();
  return text
    ? { ...state, status: "visible", text }
    : { status: "idle", token: state.token };
};

export const invalidateInlineCompletion = (
  state: InlineCompletionState,
): InlineCompletionState => ({
  status: "idle",
  token: state.token + 1,
});

/**
 * Preserve forward-stable ghost text when the editor types exactly along the
 * visible suggestion. Returning undefined means the edit diverged and the
 * caller should cancel the old completion generation.
 */
export const advanceInlineCompletion = (
  state: InlineCompletionState,
  insertedText: string,
  nextContextKey: string,
): InlineCompletionState | undefined => {
  if (state.status !== "visible" || !state.text || !insertedText || !state.text.startsWith(insertedText)) {
    return undefined;
  }
  const remaining = state.text.slice(insertedText.length);
  return remaining
    ? { ...state, contextKey: nextContextKey, text: remaining }
    : { status: "idle", token: state.token, contextKey: nextContextKey };
};

export const handleInlineCompletionKey = (
  state: InlineCompletionState,
  key: string,
): { state: InlineCompletionState; handled: boolean; acceptedText?: string } => {
  if (state.status !== "visible" || !state.text) return { state, handled: false };
  if (key === "Tab") {
    return {
      state: invalidateInlineCompletion(state),
      handled: true,
      acceptedText: state.text,
    };
  }
  if (key === "Escape") {
    return { state: invalidateInlineCompletion(state), handled: true };
  }
  return { state, handled: false };
};
