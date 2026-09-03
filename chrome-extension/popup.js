const statusDot = document.querySelector("#status-dot");
const statusTitle = document.querySelector("#status-title");
const statusDetail = document.querySelector("#status-detail");
const version = chrome.runtime.getManifest().version;
const versionLabel = document.querySelector("#extension-version");
const capturePanel = document.querySelector("#x-capture");
const captureButton = document.querySelector("#capture-x-post");
const captureResult = document.querySelector("#capture-result");

versionLabel.textContent = `常用 Chrome 模式 · v${version}`;

async function refreshCaptureAction() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  capturePanel.hidden = !/^https:\/\/(?:www\.)?(?:x|twitter)\.com\/[^/]+\/status\/\d+/i.test(String(tab?.url || ""));
}

async function refreshStatus() {
  try {
    const response = await fetch("http://127.0.0.1:4317/api/publisher/status", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const status = await response.json();
    statusDot.classList.toggle("ok", Boolean(status.ok));
    statusTitle.textContent = status.ok ? "已连接本地工作台" : "等待工作台页面连接";
    statusDetail.textContent = status.detail || `请打开 AI 新闻工作台 · v${version}`;
  } catch {
    statusTitle.textContent = "本地工作台未运行";
    statusDetail.textContent = `先启动工作台，再打开草稿页面 · v${version}`;
  }
}

document.querySelector("#open-workbench").addEventListener("click", () => {
  chrome.tabs.create({ url: "http://127.0.0.1:4317/#drafts" });
});
document.querySelector("#open-xiaoheihe").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://xiaoheihe.cn/community/user/post_list" });
});

captureButton.addEventListener("click", async () => {
  captureButton.disabled = true;
  captureButton.textContent = "正在收录…";
  captureResult.classList.remove("error");
  captureResult.textContent = "正在传送当前链接并请求官方 oEmbed";
  try {
    const result = await chrome.runtime.sendMessage({ type: "AI_NEWS_CAPTURE_ACTIVE_X_POST" });
    if (!result?.ok) throw new Error(result?.error || "收录失败");
    captureResult.textContent = result.detail || "已收录";
    captureButton.textContent = "已收录，正在打开工作台";
  } catch (error) {
    captureResult.classList.add("error");
    captureResult.textContent = error instanceof Error ? error.message : String(error);
    captureButton.disabled = false;
    captureButton.textContent = "重试收录";
  }
});

void refreshStatus();
void refreshCaptureAction();
