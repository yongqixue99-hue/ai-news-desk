import { useEffect, useRef, useState } from "react";
import { Archive, Check, CheckCircle2, ChevronDown, CircleUserRound, Clock3, Copy, Cpu, Download, HardDrive, History, KeyRound, LoaderCircle, MessageSquareText, PanelsTopLeft, RadioTower, Save, ShieldCheck, Trash2, Upload } from "lucide-react";
import type { StorageUsage } from "../api";
import type { HealthState, Settings, WeChatChannelSettings, WeChatConnectionResult, WorkflowRun } from "../types";

interface SchedulePageProps {
  settings: Settings;
  runs: WorkflowRun[];
  health?: HealthState;
  onSettings: (patch: Partial<Settings>) => void;
  onRefreshHealth: () => void;
  onLaunchPublisher: () => void;
  onOpenRuns: () => void;
  onLoadStorageUsage: () => Promise<StorageUsage>;
  onExportData: () => Promise<void>;
  onExportPortableArchive: () => Promise<void>;
  onRestoreData: (file: File) => Promise<void>;
  onSaveWeChatSettings: (
    patch: Partial<WeChatChannelSettings> & { appSecret?: string; clearAppSecret?: boolean },
  ) => Promise<WeChatChannelSettings>;
  onTestWeChatConnection: () => Promise<WeChatConnectionResult>;
}

const scheduledStatus = (run?: WorkflowRun) => {
  if (!run) return "还没有定时运行记录";
  if (["queued", "collecting", "scoring", "extracting"].includes(run.status)) return `正在运行 · ${run.stage}`;
  if (run.status === "generating") return "正在自动成稿";
  if (run.status === "failed") return `失败 · ${run.error ?? run.stage}`;
  if (run.status === "cancelled") return "已取消";
  if (!run.candidates.length) return "已完成 · 未找到候选";
  return `已完成 · ${run.candidates.length} 条候选`;
};

const nextScheduledTime = (settings: Settings) => {
  if (!settings.scheduleEnabled) return "当前未启用";
  const now = new Date();
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", dateStyle: "short" }).format(now);
  const candidate = new Date(`${today}T${settings.scheduleTime}:00+08:00`);
  if (candidate <= now || settings.lastScheduledDate === today) candidate.setUTCDate(candidate.getUTCDate() + 1);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(candidate);
};

const formatBytes = (bytes = 0) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
};

export function SchedulePage({ settings, runs, health, onSettings, onRefreshHealth, onLaunchPublisher, onOpenRuns, onLoadStorageUsage, onExportData, onExportPortableArchive, onRestoreData, onSaveWeChatSettings, onTestWeChatConnection }: SchedulePageProps) {
  const latestScheduledRun = runs.find((run) => run.scheduled);
  const [pathCopied, setPathCopied] = useState(false);
  const [storage, setStorage] = useState<StorageUsage>();
  const [dataBusy, setDataBusy] = useState<"export" | "portable" | "restore">();
  const [wechatBusy, setWechatBusy] = useState<"save" | "test" | "clear">();
  const [wechatConnection, setWechatConnection] = useState<WeChatConnectionResult>();
  const [wechatForm, setWechatForm] = useState<WeChatChannelSettings & { appSecret: string }>({
    accountName: settings.wechat.accountName,
    appId: settings.wechat.appId,
    defaultAuthor: settings.wechat.defaultAuthor,
    appSecret: "",
    appSecretConfigured: settings.wechat.appSecretConfigured,
    appSecretHint: settings.wechat.appSecretHint,
  });
  const restoreInput = useRef<HTMLInputElement>(null);
  const extensionMode = settings.publisherMode === "chrome-extension";
  const publisher = health?.publisher;
  useEffect(() => {
    void onLoadStorageUsage().then(setStorage).catch(() => undefined);
  }, [onLoadStorageUsage]);
  useEffect(() => {
    setWechatForm((current) => ({
      accountName: settings.wechat.accountName,
      appId: settings.wechat.appId,
      defaultAuthor: settings.wechat.defaultAuthor,
      appSecret: current.appSecret,
      appSecretConfigured: settings.wechat.appSecretConfigured,
      appSecretHint: settings.wechat.appSecretHint,
    }));
  }, [settings.wechat.accountName, settings.wechat.appId, settings.wechat.defaultAuthor, settings.wechat.appSecretConfigured, settings.wechat.appSecretHint]);
  const wechatDirty = wechatForm.accountName !== settings.wechat.accountName
    || wechatForm.appId !== settings.wechat.appId
    || wechatForm.defaultAuthor !== settings.wechat.defaultAuthor
    || Boolean(wechatForm.appSecret);
  const saveWeChat = async () => {
    const saved = await onSaveWeChatSettings({
      accountName: wechatForm.accountName,
      appId: wechatForm.appId,
      defaultAuthor: wechatForm.defaultAuthor,
      ...(wechatForm.appSecret ? { appSecret: wechatForm.appSecret } : {}),
    });
    setWechatForm({ ...saved, appSecret: "" });
    setWechatConnection(undefined);
    return saved;
  };
  const testWeChat = async () => {
    setWechatBusy("test");
    try {
      if (wechatDirty) await saveWeChat();
      setWechatConnection(await onTestWeChatConnection());
    } catch {
      // The app-level notice owns the actionable error message.
    } finally {
      setWechatBusy(undefined);
    }
  };
  const clearWeChatSecret = async () => {
    if (!window.confirm("从本机钥匙串移除微信公众号 AppSecret？移除后将无法同步草稿，直到重新填写。")) return;
    setWechatBusy("clear");
    try {
      const saved = await onSaveWeChatSettings({ clearAppSecret: true });
      setWechatForm({ ...saved, appSecret: "" });
      setWechatConnection(undefined);
    } catch {
      // The app-level notice owns the actionable error message.
    } finally {
      setWechatBusy(undefined);
    }
  };
  const copyExtensionPath = async () => {
    const installPath = publisher?.installPath;
    if (!installPath) return;
    await navigator.clipboard.writeText(installPath);
    setPathCopied(true);
    window.setTimeout(() => setPathCopied(false), 1_500);
  };
  return (
    <div className="page settings-page schedule-page">
      <header className="page-header">
        <div><h1>定时任务</h1><p>服务运行时，心跳会在设定时间自动采集过去 N 小时的内容。</p></div>
        <div className="page-header-actions">
          <button className="secondary-button" onClick={onOpenRuns}><History size={16} />查看运行记录</button>
          <button className="secondary-button" onClick={onRefreshHealth}>重新检查环境</button>
        </div>
      </header>

      <div className="schedule-layout">
        <section className="settings-section">
          <div className="settings-section-heading"><Clock3 size={20} /><div><h2>每晚采集心跳</h2><p>默认只采集和评分，避免无人查看时直接生成一批无用文章。</p></div><label className="switch large"><input type="checkbox" checked={settings.scheduleEnabled} onChange={(event) => onSettings({ scheduleEnabled: event.target.checked })} /><span /></label></div>
          <div className="form-grid">
            <label><span>固定时间</span><input type="time" value={settings.scheduleTime} onChange={(event) => onSettings({ scheduleTime: event.target.value })} /></label>
            <label><span>采集范围</span><select value={settings.windowHours} onChange={(event) => onSettings({ windowHours: Number(event.target.value) })}>{![12, 18, 24, 36].includes(settings.windowHours) ? <option value={settings.windowHours}>过去 {settings.windowHours} 小时</option> : null}<option value="12">过去 12 小时</option><option value="18">过去 18 小时</option><option value="24">过去 24 小时</option><option value="36">过去 36 小时</option></select></label>
            <label><span>来源图上限</span><select value={settings.imageLimit} onChange={(event) => onSettings({ imageLimit: Number(event.target.value) })}><option value="0">不提取图片</option><option value="4">最多 4 张</option><option value="8">跟随原文，最多 8 张</option><option value="12">最多 12 张</option></select></label>
          </div>
          <div className="schedule-status-grid" aria-live="polite">
            <div><span>下次运行</span><strong>{nextScheduledTime(settings)}</strong></div>
            <div><span>最近一次</span><strong>{scheduledStatus(latestScheduledRun)}</strong></div>
            <div><span>错过时间</span><strong>电脑当天恢复运行后自动补跑一次</strong></div>
          </div>
          <label className="setting-check-row"><input type="checkbox" checked={settings.autoGenerate} onChange={(event) => onSettings({ autoGenerate: event.target.checked })} /><span><strong>心跳后自动生成高分文章</strong><small>开启后会对 10 分及以上的前 {settings.autoGenerateCount} 条分别成稿；建议影子运行稳定后再开。</small></span></label>
          {settings.autoGenerate ? <label className="inline-number"><span>自动生成数量</span><input type="number" min="1" max="10" value={settings.autoGenerateCount} onChange={(event) => onSettings({ autoGenerateCount: Number(event.target.value) })} /></label> : null}
        </section>

        <section className="settings-section">
          <div className="settings-section-heading"><CircleUserRound size={20} /><div><h2>小黑盒填入方式</h2><p>默认使用你日常登录的小黑盒 Chrome；系统只填入，不点击最终发布。</p></div></div>
          <div className="publisher-mode-grid" role="radiogroup" aria-label="小黑盒填入方式">
            <button
              className={extensionMode ? "selected" : ""}
              role="radio"
              aria-checked={extensionMode}
              onClick={() => onSettings({ publisherMode: "chrome-extension" })}
            >
              <CircleUserRound size={18} />
              <span><strong>常用 Chrome</strong><small>推荐 · 沿用现有登录状态</small></span>
              {extensionMode ? <Check size={15} /> : null}
            </button>
            <button
              className={!extensionMode ? "selected" : ""}
              role="radio"
              aria-checked={!extensionMode}
              onClick={() => onSettings({ publisherMode: "cdp" })}
            >
              <PanelsTopLeft size={18} />
              <span><strong>CDP 备用浏览器</strong><small>开发调试 · 使用隔离配置</small></span>
              {!extensionMode ? <Check size={15} /> : null}
            </button>
          </div>
          {extensionMode ? (
            <div className={publisher?.ok ? "extension-setup-card connected" : "extension-setup-card"}>
              <div className="extension-status-row">
                <span className={publisher?.ok ? "connection-dot ok" : "connection-dot"} />
                <div><strong>{publisher?.ok ? "常用 Chrome 已连接" : "等待填入助手连接"}</strong><small>{publisher?.detail ?? "加载扩展后刷新一次工作台页面"}</small></div>
              </div>
              <details open={!publisher?.ok}>
                <summary><span>{publisher?.ok ? "扩展维护与重新安装" : "首次安装填入助手"}</span><ChevronDown size={15} /></summary>
                <ol>
                  <li>在 Chrome 地址栏打开 <code>chrome://extensions</code></li>
                  <li>开启“开发者模式”，点击“加载已解压的扩展程序”</li>
                  <li>选择下面的文件夹，然后刷新工作台</li>
                </ol>
                <div className="extension-path-row">
                  <code>{publisher?.installPath ?? "正在读取扩展目录…"}</code>
                  <button type="button" onClick={() => void copyExtensionPath()} disabled={!publisher?.installPath}>
                    {pathCopied ? <Check size={14} /> : <Copy size={14} />}{pathCopied ? "已复制" : "复制目录"}
                  </button>
                </div>
              </details>
              <p className="publisher-independence-note"><ShieldCheck size={14} />该方式不依赖 Codex，也不需要电脑操作 Harness；后续打包发布时可改为 Chrome 商店安装。</p>
            </div>
          ) : (
            <div className="chrome-setup-row">
              <div><strong>{publisher?.ok ? "CDP 备用浏览器已连接" : "CDP 备用浏览器尚未连接"}</strong><span>{publisher?.detail ?? "会另开隔离的 Chrome 配置，不使用日常浏览器登录态。"}</span></div>
              <button className="outline-accent-button" onClick={onLaunchPublisher}>{publisher?.ok ? "打开编辑器" : "启动备用浏览器"}</button>
            </div>
          )}
          <label className="full-field"><span>小黑盒编辑器地址</span><input value={settings.xiaoheiheEditorUrl} onChange={(event) => onSettings({ xiaoheiheEditorUrl: event.target.value })} /></label>
          {extensionMode ? <button className="outline-accent-button publisher-open-button" onClick={onLaunchPublisher}>在常用 Chrome 打开小黑盒</button> : null}
        </section>
      </div>

      <section className="settings-section wechat-settings-section">
        <div className="settings-section-heading">
          <MessageSquareText size={20} />
          <div>
            <h2>微信公众号草稿箱</h2>
            <p>连接你的个人公众号。工作台只新建或更新草稿，最终预览、排版确认和发布仍由你在微信公众平台完成。</p>
          </div>
          <span className="wechat-boundary-badge"><ShieldCheck size={13} />不自动发布</span>
        </div>
        <div className="wechat-connection-layout">
          <div className="wechat-fields">
            <label><span>公众号名称 <small>仅用于本地识别</small></span><input value={wechatForm.accountName} maxLength={80} placeholder="例如：我的科技观察" onChange={(event) => setWechatForm((current) => ({ ...current, accountName: event.target.value }))} /></label>
            <label><span>默认作者 <small>最多 16 字</small></span><input value={wechatForm.defaultAuthor} maxLength={16} placeholder="每篇同步前仍可修改" onChange={(event) => setWechatForm((current) => ({ ...current, defaultAuthor: event.target.value }))} /></label>
            <label><span>AppID</span><input value={wechatForm.appId} autoCapitalize="off" spellCheck={false} placeholder="wx…" onChange={(event) => setWechatForm((current) => ({ ...current, appId: event.target.value.trim() }))} /></label>
            <label><span>AppSecret <small>{wechatForm.appSecretConfigured ? `已保存 ${wechatForm.appSecretHint ?? ""}` : "尚未保存"}</small></span><input type="password" autoComplete="new-password" value={wechatForm.appSecret} placeholder={wechatForm.appSecretConfigured ? "留空则保持原密钥" : "只在这里填写，不要发到聊天中"} onChange={(event) => setWechatForm((current) => ({ ...current, appSecret: event.target.value.trim() }))} /></label>
          </div>
          <div className="wechat-setup-guide">
            <div className={wechatConnection?.ok ? "wechat-status connected" : wechatConnection ? "wechat-status error" : "wechat-status"} aria-live="polite">
              <span className={wechatConnection?.ok ? "connection-dot ok" : "connection-dot"} />
              <div>
                <strong>{wechatConnection?.ok ? "草稿接口已连接" : wechatConnection ? "连接需要处理" : wechatForm.appSecretConfigured ? "连接信息已保存" : "等待首次配置"}</strong>
                <small>{wechatConnection?.detail ?? (wechatForm.appSecretConfigured ? "点击“保存并测试”进行只读验证" : "AppSecret 会写入本机受保护存储，不进入项目状态或备份")}</small>
              </div>
            </div>
            <ol>
              <li>登录微信公众平台，在“设置与开发 → 基本配置”取得 AppID 和 AppSecret。</li>
              <li>把运行本工具的当前出口 IP 加到公众号 IP 白名单。</li>
              <li>保存并测试后，到任意文章的“审批发布包”同步草稿。</li>
            </ol>
            <p><KeyRound size={13} />AppSecret 只保存在操作系统的本机安全存储中；数据备份不包含它。</p>
          </div>
        </div>
        <div className="wechat-settings-actions">
          <button type="button" className="secondary-button" disabled={Boolean(wechatBusy) || !wechatDirty} onClick={() => { setWechatBusy("save"); void saveWeChat().catch(() => undefined).finally(() => setWechatBusy(undefined)); }}>{wechatBusy === "save" ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}保存配置</button>
          <button type="button" className="primary-button" disabled={Boolean(wechatBusy) || (!wechatForm.appId && !wechatDirty)} onClick={() => void testWeChat()}>{wechatBusy === "test" ? <LoaderCircle className="spin" size={15} /> : <RadioTower size={15} />}{wechatDirty ? "保存并测试" : "测试草稿接口"}</button>
          {wechatForm.appSecretConfigured ? <button type="button" className="text-danger-button" disabled={Boolean(wechatBusy)} onClick={() => void clearWeChatSecret()}>{wechatBusy === "clear" ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={14} />}移除密钥</button> : null}
        </div>
      </section>

      <section className="health-strip">
        <div><Cpu size={19} /><span><strong>Codex</strong><small>{health?.codex.detail ?? "检查中"}</small></span><CheckCircle2 className={health?.codex.ok ? "ok" : "not-ok"} size={18} /></div>
        <div><RadioTower size={19} /><span><strong>Horizon</strong><small>{health?.horizon.detail ?? "检查中"}</small></span><CheckCircle2 className={health?.horizon.ok ? "ok" : "not-ok"} size={18} /></div>
        <div><PanelsTopLeft size={19} /><span><strong>小黑盒助手</strong><small>{publisher?.detail ?? "检查中"}</small></span><CheckCircle2 className={publisher?.ok ? "ok" : "not-ok"} size={18} /></div>
        <div><MessageSquareText size={19} /><span><strong>公众号草稿</strong><small>{wechatConnection?.detail ?? (settings.wechat.appSecretConfigured ? "配置已保存" : "尚未配置")}</small></span><CheckCircle2 className={wechatConnection?.ok ? "ok" : "not-ok"} size={18} /></div>
      </section>

      <section className="settings-section data-management-section">
        <div className="settings-section-heading"><Archive size={20} /><div><h2>本地数据与迁移</h2><p>完整归档包含 SQLite 快照、草稿图片、素材库、轻量状态备份和 SHA-256 清单；操作系统安全存储中的密钥永不导出。</p></div></div>
        <div className="storage-usage-grid" aria-label="本地数据占用">
          <div><HardDrive size={17} /><span><small>总占用</small><strong>{storage ? formatBytes(storage.totalBytes) : "读取中"}</strong></span></div>
          <div><span><small>草稿图片</small><strong>{storage ? formatBytes(storage.mediaBytes) : "—"}</strong></span></div>
          <div><span><small>素材库</small><strong>{storage ? formatBytes(storage.materialBytes) : "—"}</strong></span></div>
          <div><span><small>任务与状态</small><strong>{storage ? formatBytes(storage.jobBytes + storage.stateBytes + storage.backupBytes) : "—"}</strong></span></div>
        </div>
        <div className="data-management-actions">
          <button type="button" className="primary-button" disabled={Boolean(dataBusy)} onClick={() => { setDataBusy("portable"); void onExportPortableArchive().finally(() => setDataBusy(undefined)); }}>{dataBusy === "portable" ? <LoaderCircle className="spin" size={15} /> : <Archive size={15} />}导出完整归档</button>
          <button type="button" className="secondary-button" disabled={Boolean(dataBusy)} onClick={() => { setDataBusy("export"); void onExportData().finally(() => setDataBusy(undefined)); }}>{dataBusy === "export" ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}导出轻量 JSON</button>
          <button type="button" className="secondary-button" disabled={Boolean(dataBusy)} onClick={() => restoreInput.current?.click()}>{dataBusy === "restore" ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}恢复备份</button>
          <input ref={restoreInput} hidden type="file" accept="application/json,.json" onChange={(event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            if (!file || !window.confirm("恢复会覆盖当前工作台状态。系统会先自动生成一份包含数据库和图片的完整归档，继续吗？")) return;
            setDataBusy("restore");
            void onRestoreData(file).then(() => onLoadStorageUsage().then(setStorage)).finally(() => setDataBusy(undefined));
          }} />
        </div>
        <p className="data-safety-note"><ShieldCheck size={14} />恢复前会校验 SHA-256 并创建额外检查点；完整归档的 manifest 可逐文件核验，且始终排除钥匙串凭据。</p>
      </section>
    </div>
  );
}
