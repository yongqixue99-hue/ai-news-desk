const messageFor = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Adaptive idle time: sentence boundaries are the safest point to predict a next paragraph. */
export const inlineCompletionIdleDelay = (before: string) => {
  const text = before.trimEnd();
  if (/[。！？!?；;：:]$/u.test(text) || /[.!?][”’"')\]}]?$/u.test(text)) return 380;
  if ([...text.trim()].length < 12) return 900;
  return 650;
};

/** Keep transient failures from turning each keystroke into another paid request. */
export const inlineCompletionRetryDelay = (error: unknown) => {
  const message = messageFor(error);
  if (/(?:\b429\b|rate[\s-]*limit|限流|额度)/iu.test(message)) return 60_000;
  if (/(?:timeout|timed out|超时)/iu.test(message)) return 10_000;
  return 5_000;
};
