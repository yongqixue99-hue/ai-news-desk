import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw, Save } from "lucide-react";
import { socialDeliveryApi } from "../api";
import { socialPlatforms, type SocialDeliveryStatus } from "../../server/social-delivery-types";

export function SocialDeliverySettings() {
  const [status, setStatus] = useState<SocialDeliveryStatus>();
  const [extensionId, setExtensionId] = useState("");
  const [token, setToken] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = async (initial = false) => {
    const next = await socialDeliveryApi.status(); setStatus(next);
    if (initial) { setExtensionId(next.settings.extensionId); setEnabled(next.settings.enabled || !next.settings.extensionId); }
  };
  useEffect(() => { void refresh(true).catch(error => setError(String(error))); }, []);
  const perform = async (save: boolean) => {
    setBusy(true); setError("");
    try {
      if (save) { await socialDeliveryApi.settings({ extensionId, token, enabled }); setToken(""); }
      await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const openPlatforms = async () => {
    setError("");
    try { await socialDeliveryApi.open(socialPlatforms.map(platform => platform.id)); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };
  return <section className="social-setup" id="social-delivery-settings">
    <div className="social-heading"><div><small>文章分发</small><h3>连接多平台同步助手</h3></div><span>{status?.connected ? "助手已连接" : "等待连接"}</span></div>
    <p>在 Chrome 中登录一次，以后直接复用。百家号、知乎可通过助手存草稿；头条暂提供编辑入口。</p>
    <div className="social-actions"><button className="secondary-button" onClick={() => void openPlatforms()}><ExternalLink size={14} />打开平台登录</button><button className="secondary-button" disabled={busy} onClick={() => void perform(false)}><RefreshCw size={14} />{busy ? "正在检查…" : "检测连接"}</button></div>
    <div className="social-accounts">{socialPlatforms.map(platform => <div key={platform.id}><b>{platform.name}</b><span>{status?.accounts.find(account => account.id === platform.id)?.detail || "正在检测…"}</span></div>)}</div>
    <details className="social-connection-details" open={!status?.settings.tokenConfigured}><summary>{status?.settings.tokenConfigured ? "连接配置 · 已保存" : "首次连接同步助手"}</summary>
    <ol>
      <li><a href="https://www.wechatsync.com/#install" target="_blank" rel="noreferrer">安装文章同步助手 <ExternalLink size={12} /></a>，在同一个 Chrome 登录目标平台。</li>
      <li>打开 <code>chrome://extensions</code>，开启开发者模式，复制“文章同步助手”的扩展 ID。</li>
      <li>在助手设置中开启“同步桥接 / MCP 连接”，服务器地址填 <code>ws://127.0.0.1:19527</code>，将助手显示的 Token 填在下方。不同版本名称可能略有差异。</li>
    </ol>
    <div className="social-form">
      <label>同步助手扩展 ID<input value={extensionId} onChange={event => setExtensionId(event.target.value.trim())} placeholder="chrome://extensions 中的 32 位 ID" autoCapitalize="off" spellCheck={false} maxLength={32} /></label>
      <label>桥接 Token<input type="password" value={token} onChange={event => setToken(event.target.value.trim())} autoComplete="new-password" placeholder={status?.settings.tokenConfigured ? "已保存，留空保持" : "仅保存到本机 Keychain / DPAPI"} /></label>
    </div>
    <label className="social-check"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />启用本机连接</label>
    <div className="social-actions"><button className="primary-button" disabled={busy} onClick={() => void perform(true)}><Save size={14} />保存连接</button></div>
    </details>
    <p role="status">{status?.detail ?? "正在读取连接配置…"}</p>
    {error ? <p role="alert" className="social-error">{error}</p> : null}
    <small>首次安装、扫码登录和平台验证码需要你操作一次。Mac 和 Windows 分别连接；Token 不随项目或备份导出。</small>
  </section>;
}
