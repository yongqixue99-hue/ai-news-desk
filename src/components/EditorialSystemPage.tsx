import { useEffect, useMemo, useState } from "react";
import {
  BookOpenCheck,
  BrainCircuit,
  Check,
  Clock3,
  ExternalLink,
  History,
  LoaderCircle,
  Radio,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { collectionTopics } from "../../server/topics.js";
import type {
  EditorialProfile,
  EditorialSuggestionStatus,
  EditorialSystemView,
  Settings,
} from "../types";

interface EditorialSystemPageProps {
  view: EditorialSystemView;
  settings: Settings;
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
  const topicLabel = useMemo(() => new Map(collectionTopics.map((topic) => [topic.id, topic.label])), []);

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

  return (
    <div className="page editorial-system-page">
      <header className="page-header editorial-system-header">
        <div>
          <span className="editorial-kicker"><ShieldCheck size={14} /> 人负责方向，Agent 负责整理</span>
          <h1>内容策略</h1>
          <p>这里管理长期档案、近期记忆和自动读源；实时选题统一在今日编辑台处理。</p>
        </div>
        <div className="page-header-actions">
          <button type="button" className="secondary-button" onClick={onOpenSources}>
            <Settings2 size={16} />管理信息源
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={busy || view.automaticReading.sourceIds.length === 0}
            onClick={() => void onReadNow()}
          >
            {busy ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
            立即读取
          </button>
        </div>
      </header>

      <section className="editorial-auto-read" aria-labelledby="automatic-reading-title">
        <div className="editorial-auto-read-icon"><Radio size={21} /></div>
        <div className="editorial-auto-read-copy">
          <div className="editorial-section-title-row">
            <div>
              <h2 id="automatic-reading-title">每日自动读源</h2>
              <p>只访问新闻源页面中同时“启用并选入”的来源，结果进入候选池，不自动写稿。</p>
            </div>
            <label className="editorial-switch">
              <input
                type="checkbox"
                checked={settings.scheduleEnabled}
                onChange={(event) => void onSettings({ scheduleEnabled: event.target.checked })}
              />
              <span aria-hidden="true" />
              {settings.scheduleEnabled ? "已开启" : "已关闭"}
            </label>
          </div>
          <div className="editorial-read-meta">
            <label>
              <Clock3 size={14} />每天
              <input
                type="time"
                value={settings.scheduleTime}
                disabled={!settings.scheduleEnabled}
                onChange={(event) => void onSettings({ scheduleTime: event.target.value })}
              />
              自动读取
            </label>
            <span><strong>{view.automaticReading.sourceIds.length}</strong> 个有效来源</span>
            <span className={`editorial-run-status status-${view.automaticReading.lastStatus ?? "idle"}`}>
              {runStatusLabel(view.automaticReading.lastStatus)} · {formatTime(view.automaticReading.lastReadAt)}
            </span>
            {view.automaticReading.lastRunId ? (
              <button type="button" className="text-button" onClick={() => onOpenRun(view.automaticReading.lastRunId!)}>
                查看运行 <ExternalLink size={12} />
              </button>
            ) : null}
          </div>
          <div className="editorial-source-strip">
            {view.automaticReading.sourceNames.length ? view.automaticReading.sourceNames.map((name) => (
              <span key={name}>{name}</span>
            )) : (
              <button type="button" className="editorial-empty-link" onClick={onOpenSources}>还没有有效来源，去选择</button>
            )}
          </div>
          {view.automaticReading.lastError ? <p className="editorial-inline-error">{view.automaticReading.lastError}</p> : null}
        </div>
      </section>

      <div className="editorial-two-column">
        <section id="editorial-profile" className="editorial-card editorial-profile-card">
          <div className="editorial-section-title-row">
            <div>
              <span className="editorial-card-kicker">硬约束</span>
              <h2>长期编辑档案</h2>
              <p>只有你可以修改。系统会读取它，但不会根据短期流量覆盖它。</p>
            </div>
            <ShieldCheck size={21} />
          </div>
          <div className="editorial-profile-fields">
            <label>
              <span>内容定位</span>
              <textarea rows={3} value={profileDraft.positioning} placeholder="例如：为普通读者解释重要科技变化" onChange={(event) => setProfileDraft({ ...profileDraft, positioning: event.target.value })} />
            </label>
            <label>
              <span>核心读者</span>
              <textarea rows={3} value={profileDraft.audience} placeholder="他们是谁、已经知道什么、最关心什么" onChange={(event) => setProfileDraft({ ...profileDraft, audience: event.target.value })} />
            </label>
            <fieldset>
              <legend>长期关注主题</legend>
              <div className="editorial-topic-chips">
                {collectionTopics.map((topic) => {
                  const selected = profileDraft.preferredTopicIds.includes(topic.id);
                  return <button type="button" key={topic.id} className={selected ? "selected" : ""} aria-pressed={selected} onClick={() => toggleTopic(topic.id)}>{selected ? <Check size={12} /> : null}{topic.label}</button>;
                })}
              </div>
            </fieldset>
            <label>
              <span>内容目标 <small>每行一条</small></span>
              <textarea rows={3} value={profileDraft.goals} placeholder={'解释影响\n提供可核验来源'} onChange={(event) => setProfileDraft({ ...profileDraft, goals: event.target.value })} />
            </label>
            <label>
              <span>表达偏好 <small>每行一条</small></span>
              <textarea rows={3} value={profileDraft.voiceGuidelines} placeholder={'先说结论\n用具体例子解释术语'} onChange={(event) => setProfileDraft({ ...profileDraft, voiceGuidelines: event.target.value })} />
            </label>
            <label>
              <span>不可违反的红线 <small>每行一条</small></span>
              <textarea rows={3} value={profileDraft.redLines} placeholder={'不把传闻写成事实\n不使用震惊体'} onChange={(event) => setProfileDraft({ ...profileDraft, redLines: event.target.value })} />
            </label>
          </div>
          <div className="editorial-card-actions">
            <small>上次保存：{formatTime(view.profile.updatedAt)}</small>
            <button type="button" className="primary-button" disabled={profileBusy} onClick={() => void saveProfile()}>
              {profileBusy ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}保存长期档案
            </button>
          </div>
        </section>

        <div className="editorial-side-stack">
          <section className="editorial-card editorial-memory-card">
            <div className="editorial-section-title-row">
              <div>
                <span className="editorial-card-kicker soft">软信号 · 最近 30 天</span>
                <h2>近期编辑记忆</h2>
              </div>
              <History size={20} />
            </div>
            <div className="editorial-memory-stats">
              <div><strong>{view.memory.feedbackCount}</strong><span>明确反馈</span></div>
              <div><strong>{view.memory.publishedCount}</strong><span>确认发布</span></div>
            </div>
            {view.memory.feedbackCount ? (
              <div className="editorial-signal-groups">
                <div>
                  <span>近期偏好来源</span>
                  <div>{view.memory.preferredSources.map((signal) => <em key={signal.name}>{signal.name} +{signal.score}</em>)}</div>
                </div>
                {view.memory.avoidedSources.length ? <div><span>近期回避来源</span><div>{view.memory.avoidedSources.map((signal) => <em className="negative" key={signal.name}>{signal.name} {signal.score}</em>)}</div></div> : null}
                {view.memory.topicSignals.length ? <div><span>主题信号</span><div>{view.memory.topicSignals.map((signal) => <em key={signal.topicId}>{topicLabel.get(signal.topicId) ?? signal.topicId} {signal.score > 0 ? "+" : ""}{signal.score}</em>)}</div></div> : null}
              </div>
            ) : <p className="editorial-empty-copy">还没有足够记录。请在候选池明确标记“感兴趣 / 不感兴趣”，或确认一次真实发布。</p>}
            <div className="writing-memory-panel">
              <div className="writing-memory-heading">
                <span><BrainCircuit size={14} />初稿 → 终稿偏好</span>
                <strong>{view.writingMemories.effectiveEditCount}/{view.writingMemories.applicationThreshold}</strong>
              </div>
              <p>{view.writingMemories.applicationUnlocked
                ? "已解锁：启用的偏好会进入后续写稿，但不会改变事实、引语或证据评分。"
                : `还需 ${Math.max(0, view.writingMemories.applicationThreshold - view.writingMemories.effectiveEditCount)} 次有效手动编辑才会应用；现在只记录，不影响生成。`}</p>
              {view.writingMemories.memories.length ? (
                <div className="writing-memory-list">
                  {view.writingMemories.memories.map((memory) => (
                    <article key={memory.id} className={memory.enabled ? "" : "disabled"}>
                      <div>
                        <strong>{memory.label}</strong>
                        <span>{memory.evidenceCount} 次证据 · {memory.applicable ? "生成时生效" : memory.enabled ? "等待解锁" : "已关闭"}</span>
                        {memory.evidence[0] ? <small>{memory.evidence[0].summary}</small> : null}
                      </div>
                      <div className="writing-memory-actions">
                        <button type="button" disabled={memoryBusy === memory.id} onClick={() => void toggleMemory(memory.id, !memory.enabled)}>{memory.enabled ? "关闭" : "启用"}</button>
                        <button type="button" aria-label={`删除${memory.label}`} disabled={memoryBusy === memory.id} onClick={() => void deleteMemory(memory.id, memory.label)}><Trash2 size={12} /></button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : <small className="writing-memory-empty">保存几次真实修改后，这里会出现可解释的偏好，而不是猜测你的文风。</small>}
            </div>
            <p className="editorial-memory-note">记忆只改变建议优先级，不会覆盖长期档案，也不会改变事实评分。</p>
          </section>

          <section className="editorial-card editorial-suggestions-card">
            <div className="editorial-section-title-row">
              <div>
                <span className="editorial-card-kicker">需人工审批</span>
                <h2>策略建议</h2>
              </div>
              <Sparkles size={20} />
            </div>
            {pendingSuggestions.length ? (
              <div className="editorial-suggestion-list">
                {pendingSuggestions.map((suggestion) => (
                  <article key={suggestion.id}>
                    <div><span>{suggestion.confidence === "high" ? "高置信" : suggestion.confidence === "medium" ? "中置信" : "低置信"}</span><strong>{suggestion.label}</strong><p>{suggestion.reason}</p></div>
                    <div className="editorial-suggestion-actions">
                      <button type="button" disabled={decisionBusy === suggestion.id} onClick={() => void decide(suggestion.id, "adopted")}><Check size={13} />采纳</button>
                      <button type="button" disabled={decisionBusy === suggestion.id} onClick={() => void decide(suggestion.id, "ignored")}><X size={13} />忽略</button>
                    </div>
                  </article>
                ))}
              </div>
            ) : <p className="editorial-empty-copy">目前没有需要处理的建议。系统不会为了显得聪明而凑建议。</p>}
            {suggestionHistory.length ? (
              <details className="editorial-suggestion-history">
                <summary>查看已处理建议（{suggestionHistory.length}）</summary>
                {suggestionHistory.map((suggestion) => <div key={suggestion.id}><span>{suggestionStatusLabel[suggestion.status]}</span><strong>{suggestion.label}</strong><small>{formatTime(suggestion.decidedAt)}</small></div>)}
              </details>
            ) : null}
          </section>
        </div>
      </div>

      <section className="editorial-brief-section editorial-today-handoff" aria-labelledby="editorial-today-handoff-title">
        <div className="editorial-brief-heading">
          <div>
            <span className="editorial-card-kicker">实时选题已统一到今日编辑台</span>
            <h2 id="editorial-today-handoff-title">今天写什么，请去今日编辑台</h2>
            <p>内容策略保留长期方向和学习记录；{view.brief.hardWindowHours} 小时窗口内的事件、证据与下一步动作统一在今日页判断。</p>
          </div>
          <a className="primary-button" href="#today"><BookOpenCheck size={15} />打开今日编辑台</a>
        </div>
        <div className="editorial-brief-stats" aria-label="最近一次实时选题整理摘要">
          <span><strong>{view.brief.mustReads.length}</strong> 个候选已交给今日页</span>
          <span><strong>{view.brief.excludedDuplicateCount}</strong> 条重复已合并</span>
          <span><strong>{view.brief.excludedStaleCount}</strong> 条旧闻已排除</span>
        </div>
        {view.brief.coverageGaps.length ? (
          <div className="editorial-coverage-gap">今日页仍缺少：{view.brief.coverageGaps.map((topicId) => topicLabel.get(topicId) ?? topicId).join("、")}</div>
        ) : null}
      </section>
    </div>
  );
}
