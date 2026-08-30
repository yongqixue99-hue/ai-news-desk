const WORKBENCH_ORIGIN = "http://127.0.0.1:4317";
const CLIENT_ID = chrome.runtime.id;
const VERSION = chrome.runtime.getManifest().version;

let pairingToken = "";
let busy = false;

const workbenchFetch = (path, options = {}) => fetch(`${WORKBENCH_ORIGIN}${path}`, options);

async function ensurePairingToken() {
  if (pairingToken) return pairingToken;
  const response = await workbenchFetch("/api/publisher/extension/bootstrap", { cache: "no-store" });
  if (!response.ok) throw new Error(`工作台连接失败：${response.status}`);
  const payload = await response.json();
  pairingToken = payload.token || "";
  if (!pairingToken) throw new Error("工作台没有返回配对信息");
  return pairingToken;
}

const authorizedOptions = (token, options = {}) => ({
  ...options,
  headers: {
    "content-type": "application/json",
    "x-ai-news-extension-token": token,
    ...(options.headers || {}),
  },
});

async function reportJob(token, jobId, result) {
  await workbenchFetch(
    `/api/publisher/extension/jobs/${encodeURIComponent(jobId)}/result`,
    authorizedOptions(token, {
      method: "POST",
      body: JSON.stringify({ clientId: CLIENT_ID, ...result }),
    }),
  );
}

async function bridgeTick() {
  if (busy) return;
  busy = true;
  try {
    const token = await ensurePairingToken();
    const heartbeat = await workbenchFetch(
      "/api/publisher/extension/heartbeat",
      authorizedOptions(token, {
        method: "POST",
        body: JSON.stringify({ clientId: CLIENT_ID, version: VERSION }),
      }),
    );
    if (!heartbeat.ok) {
      if (heartbeat.status === 401 || heartbeat.status === 403 || heartbeat.status === 500) pairingToken = "";
      return;
    }

    const next = await workbenchFetch(
      `/api/publisher/extension/jobs/next?clientId=${encodeURIComponent(CLIENT_ID)}`,
      authorizedOptions(token),
    );
    if (next.status === 204) return;
    if (!next.ok) throw new Error(`领取发布任务失败：${next.status}`);
    const job = await next.json();

    let result;
    try {
      result = await chrome.runtime.sendMessage({ type: "AI_NEWS_RUN_PUBLISH_JOB", job });
      if (!result || !Array.isArray(result.steps)) throw new Error("小黑盒页面没有返回填入结果");
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
    await reportJob(token, job.id, result);
  } catch (error) {
    console.warn("[AI 新闻工作台] 填入助手暂时无法连接：", error);
  } finally {
    busy = false;
  }
}

void bridgeTick();
setInterval(bridgeTick, 1500);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void bridgeTick();
});
