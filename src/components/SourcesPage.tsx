import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookmarkMinus,
  BookmarkPlus,
  Check,
  CircleCheck,
  CircleHelp,
  CircleX,
  Globe2,
  Layers3,
  LoaderCircle,
  Plus,
  Power,
  PowerOff,
  Radio,
  RefreshCw,
  Save,
  Search,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { collectionTopics } from "../../server/topics.js";
import { sourceRoleFor, sourceTopicIds } from "../../server/source-routing.js";
import { useDialogA11y } from "../hooks/useDialogA11y";
import type { CollectionTopicId, SourceConfig, SourcePreset, SourceRole } from "../types";

interface SourcesPageProps {
  sources: SourceConfig[];
  sourcePresets: SourcePreset[];
  onSave: (source: SourceConfig, patch: Partial<SourceConfig>) => Promise<void>;
  onAdd: (source: Partial<SourceConfig>) => Promise<void>;
  onDelete: (sourceId: string) => Promise<void>;
  onBatch: (sourceIds: string[], patch: { enabled?: boolean; selected?: boolean }) => Promise<void>;
  onTest: (sourceId: string) => Promise<void>;
  onCreatePreset: (name: string, sourceIds: string[]) => Promise<void>;
  onApplyPreset: (presetId: string) => Promise<void>;
  onDeletePreset: (presetId: string) => Promise<void>;
}

type PurposeFilter = "all" | SourceRole;
type HealthFilter = "all" | "attention" | NonNullable<SourceConfig["health"]>;
type SourceCollectionState = "disabled" | "manual" | "default";
type XCredentialStatus = { configured: boolean; hint?: string };

const collectionStateFor = (source: SourceConfig): SourceCollectionState => (
  !source.enabled ? "disabled" : source.selected ? "default" : "manual"
);

const responseJson = async <T,>(response: Response): Promise<T> => {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `请求失败（HTTP ${response.status}）`);
  return body;
};

const sourceRoleLabels: Record<SourceRole, string> = {
  official: "官方一手",
  verification: "独立核验",
  research: "研究／政策",
  discovery: "综合发现",
  community: "社区热点",
};

const blankSource = (): Partial<SourceConfig> => ({
  name: "",
  kind: "rss",
  homepageUrl: "",
  url: "",
  topicIds: ["ai"],
  category: "ai-news",
  role: "verification",
  discoveryOnly: false,
});

const formatTimestamp = (value?: string, fallback = "尚未记录") => {
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

const sourceMatchesQuery = (source: SourceConfig, query: string) => [
  source.name,
  source.homepageUrl,
  source.url,
  source.query,
  source.note,
  ...(source.routes ?? []).flatMap((route) => [route.label, route.homepageUrl, route.url, route.query]),
].some((value) => value?.toLocaleLowerCase().includes(query));

export function SourcesPage({
  sources,
  sourcePresets,
  onSave,
  onAdd,
  onDelete,
  onBatch,
  onTest,
  onCreatePreset,
  onApplyPreset,
  onDeletePreset,
}: SourcesPageProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<SourceConfig>>(blankSource());
  const [query, setQuery] = useState("");
  const [topicFilter, setTopicFilter] = useState<"all" | CollectionTopicId>("all");
  const [purposeFilter, setPurposeFilter] = useState<PurposeFilter>("all");
  const [healthFilter, setHealthFilter] = useState<HealthFilter>("all");
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [testingSourceId, setTestingSourceId] = useState<string>();
  const [presetName, setPresetName] = useState("");
  const [presetBusyId, setPresetBusyId] = useState<string>();
  const [creatingPreset, setCreatingPreset] = useState(false);
  const [xCredential, setXCredential] = useState<XCredentialStatus>({ configured: false });
  const [xToken, setXToken] = useState("");
  const [xCredentialBusy, setXCredentialBusy] = useState(false);
  const [xCredentialError, setXCredentialError] = useState("");
  const sourceNameInputRef = useRef<HTMLInputElement>(null);
  const closeSourceModal = () => setAdding(false);
  const sourceDialogRef = useDialogA11y<HTMLElement>({
    open: adding,
    onClose: closeSourceModal,
    initialFocusRef: sourceNameInputRef,
  });
  const sourceIdKey = sources.map((source) => source.id).join("\u0000");

  useEffect(() => {
    const available = new Set(sourceIdKey.split("\u0000").filter(Boolean));
    setCheckedIds((current) => {
      if ([...current].every((sourceId) => available.has(sourceId))) return current;
      return new Set([...current].filter((sourceId) => available.has(sourceId)));
    });
  }, [sourceIdKey]);

  useEffect(() => {
    let active = true;
    void fetch("/api/x/status")
      .then((response) => responseJson<XCredentialStatus>(response))
      .then((status) => { if (active) setXCredential(status); })
      .catch((error) => { if (active) setXCredentialError(error instanceof Error ? error.message : String(error)); });
    return () => { active = false; };
  }, []);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredSources = useMemo(() => sources.filter((source) => {
    if (normalizedQuery && !sourceMatchesQuery(source, normalizedQuery)) return false;
    if (topicFilter !== "all" && !sourceTopicIds(source).includes(topicFilter)) return false;
    if (purposeFilter !== "all" && sourceRoleFor(source) !== purposeFilter) return false;
    const health = source.health ?? "unknown";
    if (healthFilter === "attention" && health !== "warning" && health !== "error" && health !== "unknown") return false;
    if (healthFilter !== "all" && healthFilter !== "attention" && health !== healthFilter) return false;
    return true;
  }), [healthFilter, normalizedQuery, purposeFilter, sources, topicFilter]);
  const healthSummary = useMemo(() => sources.reduce((summary, source) => {
    const health = source.health ?? "unknown";
    summary[health] += 1;
    return summary;
  }, { healthy: 0, warning: 0, error: 0, unknown: 0 }), [sources]);
  const visibleIds = filteredSources.map((source) => source.id);
  const allVisibleChecked = visibleIds.length > 0 && visibleIds.every((sourceId) => checkedIds.has(sourceId));

  const toggleChecked = (sourceId: string) => {
    setCheckedIds((current) => {
      const next = new Set(current);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setCheckedIds((current) => {
      const next = new Set(current);
      if (allVisibleChecked) visibleIds.forEach((sourceId) => next.delete(sourceId));
      else visibleIds.forEach((sourceId) => next.add(sourceId));
      return next;
    });
  };

  const runBatch = async (patch: { enabled?: boolean; selected?: boolean }) => {
    if (!checkedIds.size || bulkBusy) return;
    setBulkBusy(true);
    try {
      await onBatch([...checkedIds], patch);
    } finally {
      setBulkBusy(false);
    }
  };

  const testSource = async (sourceId: string) => {
    if (testingSourceId) return;
    setTestingSourceId(sourceId);
    try {
      await onTest(sourceId);
    } finally {
      setTestingSourceId(undefined);
    }
  };

  const createPreset = async () => {
    if (!presetName.trim() || !checkedIds.size || creatingPreset) return;
    setCreatingPreset(true);
    try {
      await onCreatePreset(presetName, [...checkedIds]);
      setPresetName("");
    } finally {
      setCreatingPreset(false);
    }
  };

  const applyPreset = async (presetId: string) => {
    if (presetBusyId) return;
    setPresetBusyId(presetId);
    try {
      await onApplyPreset(presetId);
    } finally {
      setPresetBusyId(undefined);
    }
  };

  const removePreset = async (presetId: string) => {
    if (presetBusyId) return;
    setPresetBusyId(presetId);
    try {
      await onDeletePreset(presetId);
    } finally {
      setPresetBusyId(undefined);
    }
  };

  const toggleDraftTopic = (topicId: CollectionTopicId) => {
    const current = draft.topicIds ?? ["ai"];
    const next = current.includes(topicId)
      ? current.length === 1 ? current : current.filter((id) => id !== topicId)
      : [...current, topicId];
    setDraft({ ...draft, topicIds: next });
  };

  const saveXCredential = async () => {
    if (xCredentialBusy || xToken.trim().length < 16) return;
    setXCredentialBusy(true);
    setXCredentialError("");
    try {
      const status = await responseJson<XCredentialStatus>(await fetch("/api/x/token", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bearerToken: xToken.trim() }),
      }));
      setXCredential(status);
      setXToken("");
      const defaultXSource = sources.find((source) => source.id === "x-ai-official");
      if (defaultXSource && (!defaultXSource.enabled || !defaultXSource.selected)) {
        await onSave(defaultXSource, { enabled: true, selected: true });
      }
    } catch (error) {
      setXCredentialError(error instanceof Error ? error.message : String(error));
    } finally {
      setXCredentialBusy(false);
    }
  };

  const clearXCredential = async () => {
    if (xCredentialBusy) return;
    setXCredentialBusy(true);
    setXCredentialError("");
    try {
      const status = await responseJson<XCredentialStatus>(await fetch("/api/x/token", { method: "DELETE" }));
      setXCredential(status);
      setXToken("");
    } catch (error) {
      setXCredentialError(error instanceof Error ? error.message : String(error));
    } finally {
      setXCredentialBusy(false);
    }
  };

  const submit = async () => {
    try {
      await onAdd(draft);
      setDraft(blankSource());
      setAdding(false);
    } catch {
      // The parent surface already displays the API error.
    }
  };

  return (
    <div className="page settings-page sources-page">
      <header className="page-header">
        <div><h1>新闻源</h1><p>筛选、测试和组合来源；默认采集集合会直接用于下一次心跳。</p></div>
        <button type="button" className="primary-button" aria-haspopup="dialog" aria-controls="source-editor-dialog" aria-expanded={adding} onClick={() => setAdding(true)}><Plus size={17} />添加新闻源</button>
      </header>

      <div className="settings-intro">
        <Radio size={20} />
        <div><strong>官网入口与采集接口分开</strong><span>单源测试只检查 RSS、索引接口或官网可达性，不会启动成稿；采集时仍会回到原文核验。</span></div>
      </div>

      <section className="x-credential-panel" aria-labelledby="x-credential-heading">
        <div className="x-credential-copy">
          <strong id="x-credential-heading">X 官方账号采集</strong>
          <span>通过 X API v2 读取账号白名单中的公开原帖；不读取私信、不执行点赞，也不会代你发帖。</span>
          <small>Bearer Token 仅保存在当前 Windows 用户的 DPAPI 安全存储。X 开发者访问可能按用量计费，请留意自己的套餐和额度。</small>
        </div>
        <div className="x-credential-form">
          <input
            type="password"
            value={xToken}
            onChange={(event) => setXToken(event.target.value)}
            placeholder={xCredential.configured ? `已配置 ${xCredential.hint ?? ""}` : "粘贴 X API Bearer Token"}
            aria-label="X API Bearer Token"
            autoComplete="off"
          />
          <button type="button" onClick={saveXCredential} disabled={xCredentialBusy || xToken.trim().length < 16}>
            {xCredentialBusy ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}
            保存并启用 X 官方源
          </button>
          {xCredential.configured ? <button type="button" className="secondary-button" onClick={() => window.confirm("确定删除本机保存的 X Bearer Token 吗？") && clearXCredential()} disabled={xCredentialBusy}>删除 Token</button> : null}
        </div>
        <span className={`x-credential-state ${xCredential.configured ? "configured" : ""}`}>{xCredential.configured ? `已安全配置 ${xCredential.hint ?? ""}` : "尚未配置，X 来源默认停用"}</span>
        {xCredentialError ? <span className="x-credential-error" role="alert">{xCredentialError}</span> : null}
      </section>

      <section className="source-presets" aria-labelledby="source-presets-heading">
        <div className="source-presets-heading">
          <div><Layers3 size={17} /><span><strong id="source-presets-heading">来源组合</strong><small>先勾选下方来源，再保存为本机工作流预设。</small></span></div>
          <div className="source-preset-create">
            <input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="例如：AI 官方源" maxLength={40} />
            <button type="button" onClick={createPreset} disabled={!presetName.trim() || !checkedIds.size || creatingPreset}>{creatingPreset ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}保存组合</button>
          </div>
        </div>
        <div className="source-preset-list">
          {sourcePresets.map((preset) => (
            <div className="source-preset-card" key={preset.id}>
              <span><strong>{preset.name}</strong><small>{preset.sourceIds.length} 个来源</small></span>
              <button type="button" onClick={() => applyPreset(preset.id)} disabled={Boolean(presetBusyId)}>{presetBusyId === preset.id ? <LoaderCircle className="spin" size={13} /> : <BookmarkPlus size={13} />}应用</button>
              <button type="button" className="icon-button" aria-label={`删除来源组合 ${preset.name}`} onClick={() => window.confirm(`确定删除来源组合“${preset.name}”吗？`) && removePreset(preset.id)} disabled={Boolean(presetBusyId)}><Trash2 size={13} /></button>
            </div>
          ))}
          {!sourcePresets.length ? <span className="source-preset-empty">还没有来源组合。</span> : null}
        </div>
      </section>

      <section className="source-health-overview" aria-label="新闻源健康概览">
        <div><span>来源健康</span><strong>{healthSummary.healthy} 个正常</strong><small>{healthSummary.warning + healthSummary.error + healthSummary.unknown} 个需要关注 · 其中 {healthSummary.unknown} 个尚未检查</small></div>
        <button type="button" className={healthFilter === "attention" ? "active" : undefined} onClick={() => setHealthFilter(healthFilter === "attention" ? "all" : "attention")}>
          <TriangleAlert size={15} />{healthFilter === "attention" ? "显示全部来源" : "只看需关注来源"}
        </button>
      </section>

      <div className="source-manager-tools">
        <label className="source-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、地址或备注" />{query ? <button type="button" onClick={() => setQuery("")} aria-label="清空搜索"><X size={14} /></button> : null}</label>
        <div className="source-filters">
          <label><span>频道</span><select value={topicFilter} onChange={(event) => setTopicFilter(event.target.value as "all" | CollectionTopicId)}><option value="all">全部</option>{collectionTopics.map((topic) => <option key={topic.id} value={topic.id}>{topic.label}</option>)}</select></label>
          <label><span>分类</span><select value={purposeFilter} onChange={(event) => setPurposeFilter(event.target.value as PurposeFilter)}><option value="all">全部</option>{Object.entries(sourceRoleLabels).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select></label>
          <label><span>健康</span><select value={healthFilter} onChange={(event) => setHealthFilter(event.target.value as HealthFilter)}><option value="all">全部</option><option value="attention">需关注</option><option value="healthy">正常</option><option value="warning">需检查</option><option value="error">失败</option><option value="unknown">未检查</option></select></label>
        </div>
        <span>显示 {filteredSources.length} / {sources.length}</span>
      </div>

      <div className={`source-bulk-toolbar ${checkedIds.size ? "active" : ""}`} aria-live="polite">
        <strong>{checkedIds.size ? `已勾选 ${checkedIds.size} 个来源` : "勾选来源后可批量维护"}</strong>
        <div>
          <button type="button" disabled={!checkedIds.size || bulkBusy} onClick={() => runBatch({ enabled: true })}><Power size={14} />启用</button>
          <button type="button" disabled={!checkedIds.size || bulkBusy} onClick={() => runBatch({ enabled: false })}><PowerOff size={14} />停用</button>
          <button type="button" disabled={!checkedIds.size || bulkBusy} onClick={() => runBatch({ selected: true })}><BookmarkPlus size={14} />加入默认采集</button>
          <button type="button" disabled={!checkedIds.size || bulkBusy} onClick={() => runBatch({ selected: false })}><BookmarkMinus size={14} />移出默认采集</button>
        </div>
      </div>

      <div className="source-manager-table">
        <div className="source-manager-head">
          <label className="source-row-select" title="勾选当前筛选结果"><input type="checkbox" checked={allVisibleChecked} onChange={toggleAllVisible} aria-label="勾选当前筛选结果" /></label>
          <span>采集状态</span><span>新闻源</span><span>类型</span><span>用途</span><span>健康</span><span />
        </div>
        {filteredSources.map((source) => {
          const health = source.health ?? "unknown";
          const role = sourceRoleFor(source);
          const healthLabel = health === "healthy" ? "正常" : health === "warning" ? "需检查" : health === "error" ? "失败" : "未检查";
          const healthIcon = health === "healthy" ? <CircleCheck size={15} /> : health === "warning" ? <TriangleAlert size={15} /> : health === "error" ? <CircleX size={15} /> : <CircleHelp size={15} />;
          const topicSummary = collectionTopics.filter((topic) => sourceTopicIds(source).includes(topic.id)).map((topic) => topic.label).join("／");
          const homepageUrl = source.homepageUrl ?? source.routes?.find((route) => route.homepageUrl)?.homepageUrl ?? source.url;
          const failureCount = source.consecutiveFailures ?? 0;
          const testing = testingSourceId === source.id;
          const collectionState = collectionStateFor(source);
          return (
            <div className={`source-manager-row ${checkedIds.has(source.id) ? "checked" : ""}`} key={source.id}>
              <label className="source-row-select"><input type="checkbox" checked={checkedIds.has(source.id)} onChange={() => toggleChecked(source.id)} aria-label={`勾选新闻源 ${source.name}`} /></label>
              <select
                className={`source-collection-state state-${collectionState}`}
                value={collectionState}
                aria-label={`${source.name} 的采集状态`}
                onChange={(event) => {
                  const next = event.target.value as SourceCollectionState;
                  void onSave(source, { enabled: next !== "disabled", selected: next === "default" });
                }}
              >
                <option value="disabled">停用</option>
                <option value="manual">可手动使用</option>
                <option value="default">默认采集</option>
              </select>
              <div className="managed-source-name"><strong>{source.name}</strong><span>{topicSummary}{source.note ? ` · ${source.note}` : ""}</span></div>
              <span className="source-kind">{source.kind === "rss" ? "RSS" : source.kind === "hackernews" ? "HN" : source.kind === "zhihu" ? "知乎 CLI" : source.kind === "last30days" ? "30 天社区" : source.kind === "github" ? "GitHub" : source.kind === "x" ? "X 官方" : "新闻检索"}</span>
              <span className={`source-role-badge ${role}`}>{sourceRoleLabels[role]}</span>
              <span className={`source-health ${health}`} title={source.lastHealthDetail}>
                {healthIcon}<span><strong>{healthLabel} · 检查 {formatTimestamp(source.lastCheckedAt, "尚未")}</strong><small>最后成功 {formatTimestamp(source.lastSuccessfulAt, "尚无")}{failureCount ? ` · 连续失败 ${failureCount} 次` : ""}</small></span>
              </span>
              <div className="row-actions">
                <button type="button" className="source-test-button" onClick={() => testSource(source.id)} disabled={Boolean(testingSourceId)} title="只测试这个来源">{testing ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}<span>测试</span></button>
                {homepageUrl ? <a className="source-homepage-link" href={homepageUrl} target="_blank" rel="noreferrer" title="打开官方网站"><Globe2 size={15} /><span>官网</span></a> : null}
                <button type="button" aria-label={`删除新闻源 ${source.name}`} onClick={() => window.confirm(`确定删除新闻源“${source.name}”吗？`) && onDelete(source.id)} title="删除新闻源"><Trash2 size={16} /></button>
              </div>
            </div>
          );
        })}
        {!filteredSources.length ? <div className="source-manager-empty">没有匹配的新闻源。</div> : null}
      </div>

      {adding ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeSourceModal(); }}>
          <section ref={sourceDialogRef} id="source-editor-dialog" tabIndex={-1} className="source-modal" role="dialog" aria-modal="true" aria-labelledby="add-source-heading" aria-describedby="add-source-description">
            <button type="button" className="modal-close" aria-label="关闭新闻源编辑器" onClick={closeSourceModal}><X size={18} /></button>
            <h2 id="add-source-heading">添加新闻源</h2>
            <p id="add-source-description">官网地址用于展示和人工查看；RSS 或检索式只在后台采集。选择频道后，它会出现在工作台对应模块中。</p>
            <label><span>名称</span><input ref={sourceNameInputRef} value={draft.name ?? ""} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：某公司官方博客" /></label>
            <label><span>官网地址</span><input value={draft.homepageUrl ?? ""} onChange={(event) => setDraft({ ...draft, homepageUrl: event.target.value })} placeholder="https://example.com/" /></label>
            <label><span>类型</span><select value={draft.kind} onChange={(event) => {
              const kind = event.target.value as SourceConfig["kind"];
              const community = kind === "zhihu" || kind === "last30days" || kind === "github";
              setDraft({
                ...draft,
                kind,
                ...(kind === "x" ? { homepageUrl: "https://x.com/", role: "official" as const, discoveryOnly: false } : {}),
                ...(community ? { role: "community" as const, discoveryOnly: true } : {}),
              });
            }}><option value="rss">RSS</option><option value="google_news">Google News 查询</option><option value="hackernews">Hacker News</option><option value="x">X 官方账号</option><option value="zhihu">知乎 CLI</option><option value="last30days">Last30days 社区趋势</option><option value="github">GitHub 项目动态</option></select></label>
            {draft.kind === "rss" ? <label><span>采集接口</span><input value={draft.url ?? ""} onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder="https://example.com/feed.xml" /></label> : null}
            {draft.kind === "google_news" ? <label><span>检索式</span><input value={draft.query ?? ""} onChange={(event) => setDraft({ ...draft, query: event.target.value })} placeholder="AI OpenAI Anthropic" /></label> : null}
            {draft.kind === "zhihu" ? <label><span>知乎检索词</span><input value={draft.query ?? ""} onChange={(event) => setDraft({ ...draft, query: event.target.value })} placeholder="人工智能 大模型 科技" /></label> : null}
            {draft.kind === "last30days" ? <label><span>趋势领域（可选）</span><input value={draft.query ?? ""} onChange={(event) => setDraft({ ...draft, query: event.target.value })} placeholder="留空则跟随工作台频道和关键词" /></label> : null}
            {draft.kind === "github" ? <label><span>仓库列表</span><input value={draft.query ?? ""} onChange={(event) => setDraft({ ...draft, query: event.target.value })} placeholder="owner/repo, owner/repo" /></label> : null}
            {draft.kind === "x" ? <label><span>官方账号白名单</span><input value={draft.query ?? ""} onChange={(event) => setDraft({ ...draft, query: event.target.value })} placeholder="OpenAI, AnthropicAI, GoogleDeepMind" /></label> : null}
            <label><span>来源分类</span><select disabled={draft.kind === "x"} value={draft.role ?? "verification"} onChange={(event) => { const role = event.target.value as SourceRole; setDraft({ ...draft, role, discoveryOnly: role === "discovery" || role === "community" ? true : draft.discoveryOnly }); }}>{Object.entries(sourceRoleLabels).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select></label>
            <div className="source-topic-field"><span>适用频道</span><div className="source-topic-picker">{collectionTopics.map((topic) => <button type="button" key={topic.id} className={draft.topicIds?.includes(topic.id) ? "selected" : undefined} aria-pressed={draft.topicIds?.includes(topic.id)} onClick={() => toggleDraftTopic(topic.id)}>{draft.topicIds?.includes(topic.id) ? <Check size={12} /> : null}{topic.label}</button>)}</div></div>
            <label className="inline-check"><input type="checkbox" disabled={draft.kind === "x"} checked={draft.discoveryOnly} onChange={(event) => setDraft({ ...draft, discoveryOnly: event.target.checked })} /><span>{draft.kind === "x" ? "白名单账号按官方一手来源处理" : "仅作选题发现，成稿时必须另找一手来源"}</span></label>
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={closeSourceModal}>取消</button><button type="button" className="primary-button" onClick={submit} disabled={!draft.name || !draft.homepageUrl || (draft.kind === "rss" && !draft.url) || (draft.kind === "x" && !draft.query?.trim())}><Save size={16} />保存新闻源</button></div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
