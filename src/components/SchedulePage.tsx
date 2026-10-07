import { SettingsTabs } from "./SettingsTabs";
import { SocialDeliverySettings } from "./SocialDeliverySettings";
import { useEffect, useRef, useState } from "react";
import { BookOpen, Radio, Archive, Check, CheckCircle2, ChevronDown, CircleUserRound, Clock3, Copy, Cpu, Download, HardDrive, History, KeyRound, LoaderCircle, MessageSquareText, PanelsTopLeft, RadioTower, Save, ShieldCheck, Trash2, Upload } from "lucide-react";
import type { PortableArchiveImportResult, PortableArchivePreview, StorageUsage } from "../api";
import type { HealthState, Settings, WeChatChannelSettings, WeChatConnectionResult, WorkflowRun } from "../types";

interface SchedulePageProps {
  initialPlatform?: "wechat" | "social" | "xiaoheihe";
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
  onInspectPortableArchive: (file: File) => Promise<PortableArchivePreview>;
  onImportPortableArchive: (file: File, confirmationToken: string) => Promise<PortableArchiveImportResult>;
  onRestoreData: (file: File) => Promise<void>;
  onSaveWeChatSettings: (
    patch: Partial<WeChatChannelSettings> & { appSecret?: string; clearAppSecret?: boolean },
  ) => Promise<WeChatChannelSettings>;
  onTestWeChatConnection: () => Promise<WeChatConnectionResult>;
}

const displayRunStage = (stage: string) => stage.replace("生成中文速读", "生成中文摘要");

const scheduledStatus = (run?: WorkflowRun) => {
  if (!run) return "还没有定时运行记录";
  if (["queued", "collecting", "scoring", "extracting"].includes(run.status)) return `正在运行 · ${displayRunStage(run.stage)}`;
  if (run.status === "generating") return "正在自动成稿";
  if (run.status === "failed") return `失败 · ${run.error ?? displayRunStage(run.stage)}`;
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

export function SchedulePage({ initialPlatform, settings, runs, health, onSettings, onRefreshHealth, onLaunchPublisher, onOpenRuns, onLoadStorageUsage, onExportData, onExportPortableArchive, onInspectPortableArchive, onImportPortableArchive, onRestoreData, onSaveWeChatSettings, onTestWeChatConnection }: SchedulePageProps) {
  const [section, setSection] = useState<"plans" | "platforms" | "data">(initialPlatform ? "platforms" : "plans");
  const [platform, setPlatform] = useState<"wechat" | "social" | "xiaoheihe">(initialPlatform ?? "wechat");
  const recentAutomaticRuns = runs.filter((run) => run.scheduled || run.collectionPurpose === "official-monitor").slice(0, 5);
  const enabledPlanCount = Number(settings.scheduleEnabled) + Number(Boolean(settings.officialMonitorEnabled));
  const latestScheduledRun = runs.find((run) => run.scheduled);
  const [pathCopied, setPathCopied] = useState(false);
  const [storage, setStorage] = useState<StorageUsage>();
  const [dataBusy, setDataBusy] = useState<"export" | "portable" | "inspect" | "import" | "restore">();
  const [archivePreview, setArchivePreview] = useState<PortableArchivePreview>();
  const [archiveFile, setArchiveFile] = useState<File>();
  const [wechatBusy, setWechatBusy] = useState<"save" | "test" | "clear">();
  const [wechatConnection, setWechatConnection] = useState<WeChatConnectionResult>();
  const [wechatForm, setWechatForm] = useState<WeChatChannelSettings & { appSecret: string }>({
    accountName: settings.wechat.accountName,
    appId: settings.wechat.appId,
    originalId: settings.wechat.originalId ?? "",
    defaultAuthor: settings.wechat.defaultAuthor,
    appSecret: "",
    appSecretConfigured: settings.wechat.appSecretConfigured,
    appSecretHint: settings.wechat.appSecretHint,
  });
  const restoreInput = useRef<HTMLInputElement>(null);
  const archiveInspectInput = useRef<HTMLInputElement>(null);
  const extensionMode = settings.publisherMode === "chrome-extension";
  const publisher = health?.publisher;
  useEffect(() => {
    if (section !== "data") return;
    void onLoadStorageUsage().then(setStorage).catch(() => undefined);
  }, [onLoadStorageUsage, section]);
  useEffect(() => {
    setWechatForm((current) => ({
      accountName: settings.wechat.accountName,
      appId: settings.wechat.appId,
      originalId: settings.wechat.originalId ?? "",
      defaultAuthor: settings.wechat.defaultAuthor,
      appSecret: current.appSecret,
      appSecretConfigured: settings.wechat.appSecretConfigured,
      appSecretHint: settings.wechat.appSecretHint,
    }));
  }, [settings.wechat.accountName, settings.wechat.appId, settings.wechat.originalId, settings.wechat.defaultAuthor, settings.wechat.appSecretConfigured, settings.wechat.appSecretHint]);
  const wechatDirty = wechatForm.accountName !== settings.wechat.accountName
    || wechatForm.appId !== settings.wechat.appId
    || wechatForm.originalId !== (settings.wechat.originalId ?? "")
    || wechatForm.defaultAuthor !== settings.wechat.defaultAuthor
    || Boolean(wechatForm.appSecret);
  const saveWeChat = async () => {
    const saved = await onSaveWeChatSettings({
      accountName: wechatForm.accountName,
      appId: wechatForm.appId,
      originalId: wechatForm.originalId,
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
        <div><h1>自动化</h1><p>管理采集计划、平台连接与本地数据。</p></div>
        <div className="page-header-actions">
          <button className="secondary-button" onClick={onOpenRuns}><History size={16} />查看运行记录</button>
          <button className="secondary-button" onClick={onRefreshHealth}>重新检查环境</button>
        </div>
      </header>

      <SettingsTabs id="automation" label="自动化设置分类" value={section} onChange={setSection} tabs={[
        { id: "plans", label: "采集计划" }, { id: "platforms", label: "平台连接" }, { id: "data", label: "数据与迁移" },
      ]} />
      <div className="settings-tab-panel" role="tabpanel" id="automation-panel-plans" aria-labelledby="automation-tab-plans" hidden={section !== "plans"}>
        <div className="automation-summary">
          <div><span>采集计划</span><strong>{enabledPlanCount ? `${enabledPlanCount} 项已启用` : "全部已暂停"}</strong><small>在本机服务运行时执行</small></div>
          <div><span>下次每日采集</span><strong>{nextScheduledTime(settings)}</strong><small>北京时间</small></div>
          <div><span>最近每日采集</span><strong>{scheduledStatus(latestScheduledRun)}</strong><button type="button" className="text-button" onClick={onOpenRuns}>查看运行记录</button></div>
        </div>
        <div className="automation-plan-layout">
          <div className="automation-plans">
            <section className="settings-section increment-plan">
              <div className="settings-section-heading"><Radio size={20} /><div><h2>官方与热点增量</h2><p>检查已选官方来源和聚合来源的新变化。</p></div><label className="switch large"><input type="checkbox" aria-label="启用官方与热点增量" checked={Boolean(settings.officialMonitorEnabled)} onChange={event => onSettings({ officialMonitorEnabled: event.target.checked })} /><span /></label></div>
              <div className="increment-controls"><label htmlFor="automation-poll-interval">检查间隔</label><select id="automation-poll-interval" value={settings.officialMonitorIntervalMinutes ?? 60} disabled={!settings.officialMonitorEnabled} onChange={event => onSettings({ officialMonitorIntervalMinutes: Number(event.target.value) })}><option value={30}>每 30 分钟</option><option value={60}>每小时</option><option value={120}>每 2 小时</option><option value={240}>每 4 小时</option></select><a href="#sources">管理新闻源<ChevronDown size={13} /></a></div>
              <div className="increment-foot"><span>最近触发：{settings.lastOfficialPollAt ? new Date(settings.lastOfficialPollAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "还没有运行记录"}</span><small>失败来源自动延长重试间隔</small></div>
            </section>
        <section className="settings-section">
          <div className="settings-section-heading"><Clock3 size={20} /><div><h2>每日采集</h2><p>按固定时间收集新闻，整理为候选。</p></div><label className="switch large"><input type="checkbox" aria-label="启用每日采集" checked={settings.scheduleEnabled} onChange={(event) => onSettings({ scheduleEnabled: event.target.checked })} /><span /></label></div>
          <div className="form-grid">
            <label><span>每天运行时间 · 北京时间</span><input type="time" value={settings.scheduleTime} onChange={(event) => onSettings({ scheduleTime: event.target.value })} /></label>
            <label><span>采集范围</span><select value={Math.max(48, settings.windowHours)} disabled aria-describedby="collection-window-note"><option value={Math.max(48, settings.windowHours)}>过去 {Math.max(48, settings.windowHours)} 小时（防漏报）</option></select><small id="collection-window-note">至少覆盖 48 小时，与今日推荐窗口保持一致，避免定时任务延迟时漏掉官方消息。</small></label>
            <label><span>来源图上限</span><select value={settings.imageLimit} onChange={(event) => onSettings({ imageLimit: Number(event.target.value) })}><option value="0">不提取图片</option><option value="4">最多 4 张</option><option value="8">跟随原文，最多 8 张</option><option value="12">最多 12 张</option></select></label>
          </div>
          <p className="schedule-catchup"><Clock3 size={14} />错过时间后，电脑当天恢复运行时自动补跑一次。</p>
          <details className="schedule-advanced" open={settings.autoGenerate || undefined}><summary>采集后的成稿设置<ChevronDown size={14} /></summary>
          <label className="setting-check-row"><input type="checkbox" checked={settings.autoGenerate} onChange={(event) => onSettings({ autoGenerate: event.target.checked })} /><span><strong>心跳后自动生成高分文章</strong><small>开启后会对 10 分及以上的前 {settings.autoGenerateCount} 条分别成稿；建议影子运行稳定后再开。</small></span></label>
          {settings.autoGenerate ? <label className="inline-number"><span>自动生成数量</span><input type="number" min="1" max="10" value={settings.autoGenerateCount} onChange={(event) => onSettings({ autoGenerateCount: Number(event.target.value) })} /></label> : null}
          </details>
        </section>

            <div className="technical-catalog-note"><BookOpen size={17} /><span><strong>技术资料目录</strong><small>每 12 小时读取一次，随官方与热点增量计划启停。</small></span><b>{Boolean(settings.officialMonitorEnabled) ? "已启用" : "已暂停"}</b></div>
          </div>
          <aside className="automation-activity" aria-label="最近自动采集记录">
            <div className="settings-group-heading"><h2>最近运行</h2><button type="button" className="text-button" onClick={onOpenRuns}>全部记录</button></div>
            {recentAutomaticRuns.length ? <ol>{recentAutomaticRuns.map(run => <li key={run.id} className={run.status === "failed" ? "failed" : ""}><time dateTime={run.createdAt}>{new Date(run.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</time><strong>{run.collectionPurpose === "official-monitor" ? "官方与热点增量" : "每日采集"}</strong><p>{scheduledStatus(run)}</p></li>)}</ol> : <p className="settings-empty-note">还没有自动采集记录。计划运行后，结果和异常会显示在这里。</p>}
            <div className="automation-boundary"><ShieldCheck size={15} /><p>采集结果进入候选列表。平台草稿同步和最终发布仍由你确认。</p></div>
          </aside>
        </div>
      </div>
      <div className="settings-tab-panel" role="tabpanel" id="automation-panel-platforms" aria-labelledby="automation-tab-platforms" hidden={section !== "platforms"}>
        <div className="platform-settings-layout">
          <nav className="platform-settings-nav" aria-label="选择连接平台">
            <button type="button" aria-pressed={platform === "wechat"} onClick={() => setPlatform("wechat")}><MessageSquareText size={18} /><span>微信公众号<small>{wechatConnection ? wechatConnection.ok ? "接口已连接" : "连接需处理" : settings.wechat.appSecretConfigured ? "已保存 · 待测试" : "尚未配置"}</small></span></button>
            <button type="button" aria-pressed={platform === "social"} onClick={() => setPlatform("social")}><PanelsTopLeft size={18} /><span>知乎与百家号<small>多平台同步助手</small></span></button>
            <button type="button" aria-pressed={platform === "xiaoheihe"} onClick={() => setPlatform("xiaoheihe")}><CircleUserRound size={18} /><span>小黑盒<small>兼容通道 · {publisher?.ok ? "已连接" : "待连接"}</small></span></button>
          </nav>
          <div className="platform-settings-content">
            <div hidden={platform !== "wechat"}>
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
            <label><span>公众号原始 ID <small>用于识别账号，不代替 AppSecret</small></span><input value={wechatForm.originalId ?? ""} maxLength={43} autoCapitalize="off" spellCheck={false} placeholder="gh_…" onChange={(event) => setWechatForm((current) => ({ ...current, originalId: event.target.value.trim() }))} /></label>
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
            <details className="settings-connection-help"><summary>如何获取 AppSecret 与配置白名单<ChevronDown size={14} /></summary><ol>
              <li>用公众号管理员微信登录 <a href="https://developers.weixin.qq.com/platform/" target="_blank" rel="noreferrer">微信开发者平台</a>，进入“我的业务（与服务）→ 公众号 / 服务号”，选择这个公众号。</li>
              <li>在“基础信息 → 开发密钥”中获取 AppSecret；若账号仍显示旧入口，可从微信公众平台“设置与开发 → 开发接口管理”进入。密钥通常只在生成时展示，未保存时需按页面提示重置；重置会影响仍使用旧密钥的其他工具。</li>
              <li>把运行本工具的当前出口 IP 加到公众号 IP 白名单。</li>
              <li>保存并测试后，到文章的“多平台分发台”同步草稿。</li>
            </ol></details>
            <p><KeyRound size={13} />AppSecret 只保存在操作系统的本机安全存储中；数据备份不包含它。</p>
          </div>
        </div>
        <div className="wechat-settings-actions">
          <button type="button" className="secondary-button" disabled={Boolean(wechatBusy) || !wechatDirty} onClick={() => { setWechatBusy("save"); void saveWeChat().catch(() => undefined).finally(() => setWechatBusy(undefined)); }}>{wechatBusy === "save" ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}保存配置</button>
          <button type="button" className="primary-button" disabled={Boolean(wechatBusy) || (!wechatForm.appId && !wechatDirty)} onClick={() => void testWeChat()}>{wechatBusy === "test" ? <LoaderCircle className="spin" size={15} /> : <RadioTower size={15} />}{wechatDirty ? "保存并测试" : "测试草稿接口"}</button>
          {wechatForm.appSecretConfigured ? <button type="button" className="text-danger-button" disabled={Boolean(wechatBusy)} onClick={() => void clearWeChatSecret()}>{wechatBusy === "clear" ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={14} />}移除密钥</button> : null}
        </div>
      </section>
            </div>
            <div hidden={platform !== "social"}><SocialDeliverySettings /></div>
            <div hidden={platform !== "xiaoheihe"}>
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
          </div>
        </div>
        <details className="settings-environment"><summary>环境诊断<ChevronDown size={14} /></summary>
      <section className="health-strip">
        <div><Cpu size={19} /><span><strong>Codex</strong><small>{health?.codex.detail ?? "检查中"}</small></span><CheckCircle2 className={health?.codex.ok ? "ok" : "not-ok"} size={18} /></div>
        <div><RadioTower size={19} /><span><strong>Horizon</strong><small>{health?.horizon.detail ?? "检查中"}</small></span><CheckCircle2 className={health?.horizon.ok ? "ok" : "not-ok"} size={18} /></div>
        <div><PanelsTopLeft size={19} /><span><strong>小黑盒助手</strong><small>{publisher?.detail ?? "检查中"}</small></span><CheckCircle2 className={publisher?.ok ? "ok" : "not-ok"} size={18} /></div>
        <div><MessageSquareText size={19} /><span><strong>公众号草稿</strong><small>{wechatConnection?.detail ?? (settings.wechat.appSecretConfigured ? "配置已保存" : "尚未配置")}</small></span><CheckCircle2 className={wechatConnection?.ok ? "ok" : "not-ok"} size={18} /></div>
      </section>

        </details>
      </div>
      <div className="settings-tab-panel" role="tabpanel" id="automation-panel-data" aria-labelledby="automation-tab-data" hidden={section !== "data"}>
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
          <button type="button" className="secondary-button" disabled={Boolean(dataBusy)} onClick={() => archiveInspectInput.current?.click()}>{dataBusy === "inspect" ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />}预检完整归档</button>
          <button type="button" className="secondary-button" disabled={Boolean(dataBusy)} onClick={() => { setDataBusy("export"); void onExportData().finally(() => setDataBusy(undefined)); }}>{dataBusy === "export" ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}导出轻量 JSON</button>
          <button type="button" className="secondary-button" disabled={Boolean(dataBusy)} onClick={() => restoreInput.current?.click()}>{dataBusy === "restore" ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}恢复备份</button>
          <input ref={restoreInput} hidden type="file" accept="application/json,.json" onChange={(event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            if (!file || !window.confirm("恢复会覆盖当前工作台状态。系统会先自动生成一份包含数据库和图片的完整归档，继续吗？")) return;
            setDataBusy("restore");
            void onRestoreData(file).then(() => onLoadStorageUsage().then(setStorage)).finally(() => setDataBusy(undefined));
          }} />
          <input ref={archiveInspectInput} hidden type="file" accept="application/gzip,application/x-gzip,.tar.gz" onChange={(event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            setArchivePreview(undefined);
            setArchiveFile(undefined);
            setDataBusy("inspect");
            void onInspectPortableArchive(file)
              .then((preview) => { setArchiveFile(file); setArchivePreview(preview); })
              .catch(() => setArchiveFile(undefined))
              .finally(() => setDataBusy(undefined));
          }} />
        </div>
        <p className="archive-preview-boundary"><ShieldCheck size={14} /><strong>只读预检 · 尚未导入</strong><span>只校验归档、统计内容并列出 Mac→Windows 路径处理方案，不覆盖当前数据。</span></p>
        {archivePreview ? (
          <div className="archive-preview-card" aria-live="polite">
            <div className="archive-preview-heading">
              <span><CheckCircle2 size={17} /><strong>归档校验通过</strong></span>
              <small>{new Date(archivePreview.manifest.createdAt).toLocaleString("zh-CN")} · {formatBytes(archivePreview.archiveBytes)}</small>
            </div>
            <div className="archive-preview-counts">
              <div><small>来源 / 运行</small><strong>{archivePreview.contents.sources} / {archivePreview.contents.runs}</strong></div>
              <div><small>草稿 / 素材</small><strong>{archivePreview.contents.drafts} / {archivePreview.contents.materials}</strong></div>
              <div><small>媒体 / 素材文件</small><strong>{archivePreview.contents.mediaFiles} / {archivePreview.contents.materialFiles}</strong></div>
              <div><small>可自动改写路径</small><strong>{archivePreview.relocation.counts.relocatable}</strong></div>
              <div className={archivePreview.relocation.counts.missing ? "warning" : ""}><small>归档缺失</small><strong>{archivePreview.relocation.counts.missing}</strong></div>
              <div className={archivePreview.relocation.counts.blocked ? "warning" : ""}><small>需人工重新绑定</small><strong>{archivePreview.relocation.counts.blocked}</strong></div>
            </div>
            {archivePreview.relocation.entries.some((entry) => entry.status === "missing" || entry.status === "blocked") ? (
              <div className="archive-preview-issues">
                <strong>导入前需要处理</strong>
                {archivePreview.relocation.entries.filter((entry) => entry.status === "missing" || entry.status === "blocked").slice(0, 8).map((entry) => (
                  <div key={`${entry.ownerType}-${entry.ownerId}-${entry.field}`}>
                    <span className={`archive-path-status ${entry.status}`}>{entry.status === "missing" ? "缺文件" : "需重绑"}</span>
                    <code title={entry.sourcePath}>{entry.sourcePath}</code>
                    <small>{entry.reason}</small>
                  </div>
                ))}
              </div>
            ) : <p className="archive-preview-ready"><Check size={14} />没有发现缺失文件或无法迁移的本机路径。</p>}
            <div className="archive-import-confirmation">
              <div>
                <strong>确认后将整体替换当前工作台</strong>
                <small>系统会先保留本机完整检查点；数据库、草稿图片和素材库全部验证成功后才提交，失败自动回滚。密钥不会被覆盖。</small>
              </div>
              <button
                type="button"
                className="secondary-button danger-button"
                disabled={Boolean(dataBusy) || !archiveFile}
                onClick={() => {
                  if (!archiveFile) return;
                  const attention = archivePreview.relocation.counts.missing + archivePreview.relocation.counts.blocked;
                  const warning = attention ? `\n\n注意：仍有 ${attention} 个路径需要导入后人工重新绑定。` : "";
                  if (!window.confirm(`这会用刚刚预检的归档覆盖当前工作台数据。系统会先创建可恢复检查点。${warning}\n\n确定执行吗？`)) return;
                  setDataBusy("import");
                  void onImportPortableArchive(archiveFile, archivePreview.confirmationToken)
                    .then(() => {
                      setArchivePreview(undefined);
                      setArchiveFile(undefined);
                      return onLoadStorageUsage().then(setStorage);
                    })
                    .finally(() => setDataBusy(undefined));
                }}
              >
                {dataBusy === "import" ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}
                确认覆盖并导入
              </button>
            </div>
            <p className="archive-preview-footer">SHA-256：<code>{archivePreview.archiveSha256}</code> · 确认有效至 {new Date(archivePreview.confirmationExpiresAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} · 当前仍未写入数据</p>
          </div>
        ) : null}
        <p className="data-safety-note"><ShieldCheck size={14} />恢复前会校验 SHA-256 并创建额外检查点；完整归档的 manifest 可逐文件核验，且始终排除钥匙串凭据。</p>
      </section>
      </div>
    </div>
  );
}
