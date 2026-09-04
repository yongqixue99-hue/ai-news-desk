const shouldRepairPairing = (status) => status === 401 || status === 403 || status >= 500;

export const XIAOHEIHE_PAGE_SCRIPTS = Object.freeze([
  "xiaoheihe-dom.js",
  "xiaoheihe-image-post-dom.js",
  "xiaoheihe-publisher-job.js",
  "xiaoheihe.js",
]);

const normalizedEditorUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    return url.href.replace(/\/$/u, "");
  } catch {
    return String(value || "").replace(/#.*$/u, "").replace(/\/$/u, "");
  }
};

export function planEditorTab(tabs, editorUrl) {
  const usable = (Array.isArray(tabs) ? tabs : []).filter((tab) => Number.isInteger(tab?.id));
  const requested = normalizedEditorUrl(editorUrl);
  const matching = usable.filter((tab) => normalizedEditorUrl(tab.url) === requested);
  const tab = matching.find((entry) => entry.active)
    || matching[0]
    || usable.find((entry) => entry.active)
    || usable[0];
  if (!tab) return { type: "create", url: editorUrl };
  if (normalizedEditorUrl(tab.url) === requested) {
    return { type: "activate", tabId: tab.id, windowId: tab.windowId };
  }
  return {
    type: "navigate",
    tabId: tab.id,
    windowId: tab.windowId,
    url: editorUrl,
  };
}

export function startPublisherBridgePolling(
  run,
  schedule = (callback, milliseconds) => globalThis.setInterval(callback, milliseconds),
) {
  run();
  return schedule(run, 1_500);
}

export function createPublisherBridgeClient({
  origin,
  clientId,
  version,
  fetcher = fetch,
  runJob,
}) {
  let pairingToken = "";
  let busy = false;

  const request = (path, options = {}) => fetcher(`${origin}${path}`, options);
  const authorizedOptions = (token, options = {}) => ({
    ...options,
    headers: {
      "content-type": "application/json",
      "x-ai-news-extension-token": token,
      ...(options.headers || {}),
    },
  });

  const ensurePairingToken = async () => {
    if (pairingToken) return pairingToken;
    const response = await request("/api/publisher/extension/bootstrap", { cache: "no-store" });
    if (!response.ok) throw new Error(`工作台连接失败：${response.status}`);
    const payload = await response.json();
    pairingToken = String(payload.token || "");
    if (!pairingToken) throw new Error("工作台没有返回配对信息");
    return pairingToken;
  };

  const repairPairingIfNeeded = (response) => {
    if (shouldRepairPairing(response.status)) pairingToken = "";
  };

  const tick = async () => {
    if (busy) return { status: "busy" };
    busy = true;
    try {
      const token = await ensurePairingToken();
      const heartbeat = await request(
        "/api/publisher/extension/heartbeat",
        authorizedOptions(token, {
          method: "POST",
          body: JSON.stringify({ clientId, version }),
        }),
      );
      if (!heartbeat.ok) {
        repairPairingIfNeeded(heartbeat);
        return { status: "disconnected" };
      }

      const next = await request(
        `/api/publisher/extension/jobs/next?clientId=${encodeURIComponent(clientId)}`,
        authorizedOptions(token),
      );
      if (next.status === 204) return { status: "connected" };
      if (!next.ok) {
        repairPairingIfNeeded(next);
        return { status: "disconnected" };
      }

      const job = await next.json();
      let result;
      try {
        result = await runJob(job);
        if (!result || !Array.isArray(result.steps)) {
          throw new Error("小黑盒页面没有返回填入结果");
        }
      } catch (error) {
        result = {
          pageUrl: job.editorUrl,
          steps: [{
            name: "填入助手",
            ok: false,
            detail: error instanceof Error ? error.message : String(error),
          }],
        };
      }

      const report = await request(
        `/api/publisher/extension/jobs/${encodeURIComponent(job.id)}/result`,
        authorizedOptions(token, {
          method: "POST",
          body: JSON.stringify({ clientId, ...result }),
        }),
      );
      if (!report.ok) {
        repairPairingIfNeeded(report);
        return { status: "disconnected" };
      }
      return { status: "completed" };
    } finally {
      busy = false;
    }
  };

  return {
    tick,
    reset() {
      pairingToken = "";
    },
  };
}
