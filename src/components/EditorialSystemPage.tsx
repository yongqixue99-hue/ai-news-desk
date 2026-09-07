import { useEffect, useState } from "react";
import { Check, ExternalLink, LoaderCircle, RefreshCw, Save, Trash2, X } from "lucide-react";
import { completionAvailability } from "../../server/editorial-controls.js";
import { collectionTopics } from "../../server/topics.js";
import type {
  AiSettings,
  EditorialProfile,
  EditorialSuggestionStatus,
  EditorialSystemView,
  Settings,
} from "../types";

interface EditorialSystemPageProps {
  view: EditorialSystemView;
  settings: Settings;
  aiSettings: AiSettings;
  busy: boolean;
  onSaveProfile: (profile: Partial<EditorialProfile>) => Promise<void>;
  onDecision: (suggestionId: string, decision: Exclude<EditorialSuggestionStatus, "pending">) => Promise<void>;
  onSettings: (patch: Partial<Settings>) => Promise<void>;
  onReadNow: () => Promise<void>;
  onOpenSources: () => void;
  onOpenRun: (runId: string) => void;
  onToggleWritingMemory: (memoryId: string, enabled: boolean) => Promise<void>;
  onDeleteWritingMemory: (memoryId: string) => Promise<void>;
}

interface ProfileDraft {
  positioning: string;
  audience: string;
  goals: string;
  preferredTopicIds: EditorialProfile["preferredTopicIds"];
  voiceGuidelines: string;
  redLines: string;
}

const profileDraftFor = (profile: EditorialProfile): ProfileDraft => ({
  positioning: profile.positioning,
  audience: profile.audience,
  goals: profile.goals.join("\n"),
  preferredTopicIds: [...profile.preferredTopicIds],
  voiceGuidelines: profile.voiceGuidelines.join("\n"),
  redLines: profile.redLines.join("\n"),
});

const lines = (value: string) => value.split("\n").map((entry) => entry.trim()).filter(Boolean);

const formatTime = (value?: string, fallback = "尚无记录") => {
  if (!value) return fallback;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
};

const runStatusLabel = (status?: string) => ({
  queued: "等待读取",
  collecting: "正在读取",
  scoring: "正在整理",
  extracting: "正在提取",
  ready: "读取完成",
  generating: "正在成稿",
  complete: "读取完成",
  failed: "读取失败",
  cancelled: "已取消",
}[status ?? ""] ?? "尚未运行");

const suggestionStatusLabel: Record<EditorialSuggestionStatus, string> = {
  pending: "待决定",
  adopted: "已采纳",
  ignored: "已忽略",
};

export function EditorialSystemPage({
  view,
  settings,
  aiSettings,
  busy,
  onSaveProfile,
  onDecision,
  onSettings,
  onReadNow,
  onOpenSources,
  onOpenRun,
  onToggleWritingMemory,
  onDeleteWritingMemory,
}: EditorialSystemPageProps) {
  const [profileDraft, setProfileDraft] = useState(() => profileDraftFor(view.profile));
  const [profileBusy, setProfileBusy] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState<string>();
  const [memoryBusy, setMemoryBusy] = useState<string>();

  useEffect(() => {
    setProfileDraft(profileDraftFor(view.profile));
  }, [view.profile.updatedAt]);

  const pendingSuggestions = view.suggestions.filter((suggestion) => suggestion.status === "pending");
  const suggestionHistory = view.suggestions.filter((suggestion) => suggestion.status !== "pending");

  const toggleTopic = (topicId: EditorialProfile["preferredTopicIds"][number]) => {
    setProfileDraft((current) => ({
      ...current,
      preferredTopicIds: current.preferredTopicIds.includes(topicId)
        ? current.preferredTopicIds.filter((entry) => entry !== topicId)
        : [...current.preferredTopicIds, topicId],
    }));
  };

  const saveProfile = async () => {
    setProfileBusy(true);
    try {
      await onSaveProfile({
        positioning: profileDraft.positioning,
        audience: profileDraft.audience,
        goals: lines(profileDraft.goals),
        preferredTopicIds: profileDraft.preferredTopicIds,
        voiceGuidelines: lines(profileDraft.voiceGuidelines),
        redLines: lines(profileDraft.redLines),
      });
    } finally {
      setProfileBusy(false);
    }
  };

  const decide = async (suggestionId: string, decision: "adopted" | "ignored") => {
    setDecisionBusy(suggestionId);
    try {
      await onDecision(suggestionId, decision);
    } finally {
      setDecisionBusy(undefined);
    }
  };

  const toggleMemory = async (memoryId: string, enabled: boolean) => {
    setMemoryBusy(memoryId);
    try {
      await onToggleWritingMemory(memoryId, enabled);
    } finally {
      setMemoryBusy(undefined);
    }
  };

  const deleteMemory = async (memoryId: string, label: string) => {
    if (!window.confirm(`删除“${label}”这条编辑记忆？以后仍可从新的真实修改中重新学习。`)) return;
    setMemoryBusy(memoryId);
    try {
      await onDeleteWritingMemory(memoryId);
    } finally {
      setMemoryBusy(undefined);
    }
  };

  const completion = completionAvailability(settings, aiSettings);
  const profileDirty = JSON.stringify(profileDraft) !== JSON.stringify(profileDraftFor(view.profile));
  const hasProfile = Boolean(view.profile.positioning || view.profile.audience || view.profile.voiceGuidelines.length || view.profile.goals.length || view.profile.redLines.length);
  const memoryEnabled = settings.writingMemoryEnabled !== false;
  const [settingBusy, setSettingBusy] = useState(false);
  const changeSettings = async (patch: Partial<Settings>) => {
    setSettingBusy(true);
    try { await onSettings(patch); } finally { setSettingBusy(false); }
  };
  const toggle = (key: "editorialProfileEnabled" | "writingMemoryEnabled" | "inlineCompletionEnabled" | "personalizationEnabled" | "scheduleEnabled" | "officialMonitorEnabled", label: string) => (
    <label className="editorial-switch strategy-switch">
      <input type="checkbox" aria-label={label} checked={settings[key] !== false} disabled={settingBusy} onChange={(event) => void changeSettings({ [key]: event.target.checked })} />
      <span aria-hidden="true" />{settings[key] !== false ? "开启" : "关闭"}
    </label>
  );
  return (
    <div className="page editorial-system-page strategy-page">
      <header className="page-header strategy-header">
        <div><span className="strategy-eyebrow">你的编辑偏好</span><h1>内容策略</h1><p>优先发现重要变化，也给有趣、有用的题材留位置。</p></div>
        <a className="secondary-button" href="#today">去选今天的题 <ExternalLink size={14} /></a>
      </header>
      <div className="strategy-layout">
        <div className="strategy-main">
          <section className="strategy-section" aria-labelledby="strategy-selection-title">
            <div className="strategy-section-heading"><span className="strategy-number">01</span><div><h2 id="strategy-selection-title">选什么题</h2><p>用于今日推荐和新闻工作台，保存后生效。</p></div></div>
            <fieldset className="strategy-mode-options"><legend className="sr-only">推荐范围</legend>
              {([{ value: "focused", title: "精选推荐", copy: "重要进展优先，另留有趣实践；不凑满数量。" }, { value: "balanced", title: "广泛浏览", copy: "保留常规动态，适合主动找题时展开看。" }] as const).map((mode) => (
                <label key={mode.value} className={settings.recommendationMode === mode.value || (!settings.recommendationMode && mode.value === "focused") ? "selected" : ""}>
                  <input type="radio" name="recommendation-mode" value={mode.value} checked={(settings.recommendationMode || "focused") === mode.value} disabled={settingBusy} onChange={() => void changeSettings({ recommendationMode: mode.value })} />
                  <span><strong>{mode.title}</strong><small>{mode.copy}</small></span>
                </label>
              ))}
            </fieldset>
            <div className="strategy-control-row"><div><strong>参考选题反馈</strong><p>{settings.personalizationEnabled ? "已接入今日与新闻排序，参考你明确标记的兴趣。" : "已暂停偏好排序，已有反馈保留。"}</p></div>{toggle("personalizationEnabled", "参考选题反馈")}</div>
            <p className="strategy-footnote">热度未知不等于没有价值。推荐标签是选题提示，证据强度独立核验。</p>
          </section>
          <section id="editorial-profile" className="strategy-section" aria-labelledby="strategy-writing-title">
            <div className="strategy-section-heading"><span className="strategy-number">02</span><div><h2 id="strategy-writing-title">文章怎么写</h2><p>{settings.editorialProfileEnabled === false ? "已暂停应用，填写的档案会保留。" : hasProfile ? "已接入下一次成稿和 Tab 补全。" : "已开启，填写并保存后用于成稿和 Tab 补全。"}</p></div>{toggle("editorialProfileEnabled", "应用写作档案")}</div>
            <div className="strategy-profile-fields">
              <label><span id="profile-positioning-label">内容定位</span><textarea aria-labelledby="profile-positioning-label" rows={2} value={profileDraft.positioning} placeholder="例如：把重要 AI 变化和有趣实践讲清楚" onChange={(event) => setProfileDraft({ ...profileDraft, positioning: event.target.value })} /></label>
              <label><span id="profile-audience-label">写给谁看</span><textarea aria-labelledby="profile-audience-label" rows={2} value={profileDraft.audience} placeholder="例如：关心 AI、愿意尝试新工具的普通读者" onChange={(event) => setProfileDraft({ ...profileDraft, audience: event.target.value })} /></label>
              <label className="strategy-field-wide"><span id="profile-voice-label">表达偏好 <small>每行一条</small></span><textarea aria-labelledby="profile-voice-label" rows={2} value={profileDraft.voiceGuidelines} placeholder={'用真实变化吸引读者\n少铺垫，多讲具体场景'} onChange={(event) => setProfileDraft({ ...profileDraft, voiceGuidelines: event.target.value })} /></label>
            </div>
            <details className="strategy-details"><summary>更多约束 <span>关注主题、目标与红线</span></summary><div className="strategy-details-body">
              <fieldset className="strategy-topics"><legend>长期关注主题 <small>仅轻微调整排序，不扩大采集频道</small></legend><div className="editorial-topic-chips">{collectionTopics.map((topic) => <button type="button" key={topic.id} aria-pressed={profileDraft.preferredTopicIds.includes(topic.id)} className={profileDraft.preferredTopicIds.includes(topic.id) ? "selected" : ""} onClick={() => toggleTopic(topic.id)}>{topic.label}</button>)}</div></fieldset>
              <div className="strategy-profile-fields"><label><span id="profile-goals-label">内容目标</span><textarea aria-labelledby="profile-goals-label" rows={2} value={profileDraft.goals} onChange={(event) => setProfileDraft({ ...profileDraft, goals: event.target.value })} /></label><label><span id="profile-redLines-label">不可违反的红线</span><textarea aria-labelledby="profile-redLines-label" rows={2} value={profileDraft.redLines} placeholder="不把传闻写成事实" onChange={(event) => setProfileDraft({ ...profileDraft, redLines: event.target.value })} /></label></div>
            </div></details>
            <div className="strategy-save-row"><small>{profileDirty ? "有未保存的修改" : view.profile.updatedAt ? "已保存 · " + formatTime(view.profile.updatedAt) : "尚未填写档案"}</small><button type="button" className="primary-button" disabled={profileBusy || !profileDirty} onClick={() => void saveProfile()}>{profileBusy ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}保存写作档案</button></div>
          </section>
        </div>
        <aside className="strategy-sidebar">
          <section className="strategy-section" aria-labelledby="strategy-tab-title">
            <div className="strategy-section-heading"><span className="strategy-number">03</span><div><h2 id="strategy-tab-title">Tab 续写</h2></div>{toggle("inlineCompletionEnabled", "启用 Tab 补全")}</div>
            <p>停笔后给出短建议，按 Tab 采纳，Esc 忽略。只使用当前稿件的冻结素材。</p>
            <div className={"strategy-runtime " + (completion.ready ? "ready" : "paused")}><strong>{completion.ready ? "配置就绪" : "暂未运行"}</strong><span>{completion.reason}</span>{completion.providerName ? <small>{completion.providerName} · {completion.model}</small> : null}</div>
            <p className="strategy-footnote">配置就绪不代表已经验证模型响应；请求时会显示结果。可在编辑器中随时关闭。</p>
            <a className="text-button" href="#ai-settings">配置补全模型 <ExternalLink size={12} /></a>
          </section>
          <section className="strategy-section" aria-labelledby="automatic-reading-title">
            <div className="strategy-section-heading"><span className="strategy-number">04</span><div><h2 id="automatic-reading-title">自动读源</h2></div>{toggle("scheduleEnabled", "每日自动读源")}</div>
            <div className="strategy-schedule"><label htmlFor="strategy-time">每天</label><input id="strategy-time" type="time" value={settings.scheduleTime} disabled={!settings.scheduleEnabled || settingBusy} onChange={(event) => void changeSettings({ scheduleTime: event.target.value })} /><span>本机运行时读取</span></div>
            <div className="strategy-control-row"><div><strong>官方来源增量检查</strong><p className="strategy-footnote">模型与产品更新按小时检查，技术目录每 12 小时读取。只收录候选，打开文章时再补正文与原图。</p></div>{toggle("officialMonitorEnabled", "官方来源增量检查")}</div><div className="strategy-schedule"><label htmlFor="official-poll-interval">检查间隔</label><select id="official-poll-interval" value={settings.officialMonitorIntervalMinutes ?? 60} disabled={!settings.officialMonitorEnabled || settingBusy} onChange={event => void changeSettings({ officialMonitorIntervalMinutes: Number(event.target.value) })}><option value={30}>30 分钟</option><option value={60}>1 小时</option><option value={120}>2 小时</option><option value={240}>4 小时</option></select></div><p className="strategy-footnote">仅检查已启用且已选中的官方来源；连续失败会延长间隔。最近触发：{formatTime(settings.lastOfficialPollAt)}</p>
            <div className="strategy-read-status"><span>{runStatusLabel(view.automaticReading.lastStatus)}</span><small>{formatTime(view.automaticReading.lastReadAt)}</small></div>
            {view.automaticReading.lastError ? <p className="editorial-inline-error">{view.automaticReading.lastError}</p> : null}
            <details className="strategy-details"><summary>{view.automaticReading.sourceIds.length} 个已选来源</summary><div className="editorial-source-strip">{view.automaticReading.sourceNames.map((name) => <span key={name}>{name}</span>)}</div></details>
            <div className="strategy-side-actions"><button type="button" className="secondary-button" onClick={onOpenSources}>管理来源</button><button type="button" className="primary-button" disabled={busy || !view.automaticReading.sourceIds.length} onClick={() => void onReadNow()}>{busy ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}立即读取</button></div>
            {view.automaticReading.lastRunId ? <button type="button" className="text-button" onClick={() => onOpenRun(view.automaticReading.lastRunId!)}>查看最近定时运行</button> : null}
          </section>
        </aside>
      </div>
      <section className="strategy-records" aria-label="学习与运行记录">
        <div className="strategy-control-row"><div><h2>从修改中学习</h2><p>{!memoryEnabled ? "应用已关闭；保留记录和单条设置。" : view.writingMemories.applicationUnlocked ? "已达到应用门槛；下方启用的偏好用于成稿和补全。" : "样本还不够，正在积累；目前不影响写作。"}</p></div>{toggle("writingMemoryEnabled", "应用写作记忆")}</div>
        <div className="strategy-learning-summary"><span>有效手动修改 <strong>{view.writingMemories.effectiveEditCount} / {view.writingMemories.applicationThreshold}</strong></span><span>近期选题反馈 <strong>{view.memory.feedbackCount}</strong></span><span>确认发布 <strong>{view.memory.publishedCount}</strong></span></div>
        <details className="strategy-details"><summary>查看记忆与依据 <span>{view.writingMemories.memories.length} 条写作偏好</span></summary><div className="strategy-details-body">
          <div className="writing-memory-list">{view.writingMemories.memories.map((memory) => <article key={memory.id} className={memory.enabled ? "" : "disabled"}><div><strong>{memory.label}</strong><span>{memory.evidenceCount} 次依据 · {!memoryEnabled || !memory.enabled ? "已暂停" : view.writingMemories.applicationUnlocked ? "已应用" : "等待样本"}</span>{memory.evidence[0] ? <small>{memory.evidence[0].summary}</small> : null}</div><div className="writing-memory-actions"><button type="button" disabled={memoryBusy === memory.id} onClick={() => void toggleMemory(memory.id, !memory.enabled)}>{memory.enabled ? "关闭" : "启用"}</button><button type="button" aria-label={"删除" + memory.label} disabled={memoryBusy === memory.id} onClick={() => void deleteMemory(memory.id, memory.label)}><Trash2 size={12} /></button></div></article>)}</div>
          {!view.writingMemories.memories.length ? <p>有真实修改后，这里才会出现可解释的偏好。</p> : null}
          <div className="editorial-signal-groups"><span>近 30 天来源反馈</span><div>{[...view.memory.preferredSources, ...view.memory.avoidedSources].map((signal) => <em key={signal.name}>{signal.name} {signal.score > 0 ? "+" : ""}{signal.score}</em>)}</div></div>
        </div></details>
        <details className="strategy-details"><summary>来源与方向建议 <span>{pendingSuggestions.length} 条待处理</span></summary><div className="strategy-details-body editorial-suggestion-list">
          {pendingSuggestions.map((suggestion) => <article key={suggestion.id}><div><strong>{suggestion.label}</strong><p>{suggestion.reason}</p></div><div className="editorial-suggestion-actions"><button type="button" disabled={decisionBusy === suggestion.id} onClick={() => void decide(suggestion.id, "adopted")}><Check size={13} />采纳</button><button type="button" disabled={decisionBusy === suggestion.id} onClick={() => void decide(suggestion.id, "ignored")}><X size={13} />忽略</button></div></article>)}
          {!pendingSuggestions.length ? <p>目前没有需要处理的建议。</p> : null}
          {suggestionHistory.length ? <details className="strategy-details"><summary>已处理 {suggestionHistory.length} 条</summary>{suggestionHistory.map((suggestion) => <p key={suggestion.id}>{suggestionStatusLabel[suggestion.status]} · {suggestion.label}</p>)}</details> : null}
        </div></details>
        <details className="strategy-details" open={view.qualityBaseline.failed ? true : undefined}><summary>规则检查 <span>{view.qualityBaseline.passed} / {view.qualityBaseline.total} 样本通过</span></summary><div className="strategy-details-body"><p>这是编辑规则的回归结果，不代表每篇文章都已核实。事实与图片权利仍在各篇草稿和交付时检查，不能通过关闭偏好来绕过。</p>{view.qualityBaseline.failed ? <p className="editorial-inline-error">有 {view.qualityBaseline.failed} 条回归样本失败，需要修复。</p> : null}</div></details>
      </section>
    </div>
  );
}
