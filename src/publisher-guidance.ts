import type { PublisherPreflightResult } from "./types.js";

const withoutTerminalPunctuation = (value: string) => value.trim().replace(/[。；;]+$/u, "");

export const publisherBlockingGuidance = (preflight?: PublisherPreflightResult) => {
  if (!preflight || preflight.canQueueFill || !preflight.blocking.length) return undefined;
  const messages = [...new Set(preflight.blocking
    .map((issue) => withoutTerminalPunctuation(issue.message))
    .filter(Boolean))];
  return messages.length ? `暂不能填入：${messages.join("；")}。` : undefined;
};

export const publisherFillButtonLabel = ({
  preflightBusy,
  busy,
  loginRequired,
}: {
  preflightBusy: boolean;
  busy: boolean;
  loginRequired: boolean;
}) => preflightBusy
  ? "正在检查填入条件…"
  : busy
    ? "正在打开小黑盒并填入…"
    : loginRequired
      ? "登录后重新填入"
      : "填入小黑盒编辑器";
