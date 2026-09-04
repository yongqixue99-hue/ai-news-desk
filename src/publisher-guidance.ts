import type { PublisherPreflightResult } from "./types.js";

const withoutTerminalPunctuation = (value: string) => value.trim().replace(/[。；;]+$/u, "");

export const publisherBlockingGuidance = (preflight?: PublisherPreflightResult) => {
  if (!preflight || preflight.canQueueFill || !preflight.blocking.length) return undefined;
  const messages = [...new Set(preflight.blocking
    .map((issue) => withoutTerminalPunctuation(issue.message))
    .filter(Boolean))];
  return messages.length ? `暂不能填入：${messages.join("；")}。` : undefined;
};
