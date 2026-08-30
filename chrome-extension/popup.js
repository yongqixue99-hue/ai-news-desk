const statusDot = document.querySelector("#status-dot");
const statusTitle = document.querySelector("#status-title");
const statusDetail = document.querySelector("#status-detail");
const version = chrome.runtime.getManifest().version;

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

void refreshStatus();
