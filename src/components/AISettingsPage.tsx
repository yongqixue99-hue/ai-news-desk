import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronRight,
  Cpu,
  Eye,
  FileSearch,
  FileCode2,
  ImagePlus,
  Images,
  KeyRound,
  Library,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import { siDeepseek, siOpenaigym, siQwen } from "simple-icons";
import type { MaterialMetadataInput } from "../api";
import { materialGovernanceView } from "../material-governance-view";
import { useDialogA11y } from "../hooks/useDialogA11y";
import { providerHealthPresentation } from "../../server/provider-health-presentation";
import type {
  AiProviderConfig,
  AiSettings,
  ArticleAgentRole,
  ArticleSkillConfig,
  ArticleSkillScope,
  ImageMaterial,
  ProviderHealthResult,
} from "../types";

const skillScopeLabels = {
  generation: "成稿",
  analysis: "分析",
  optimization: "优化",
  chat: "追问",
} as const;

const skillScopesForLabel = (skill: ArticleSkillConfig): ArticleSkillScope[] => Array.isArray(skill.scopes)
  ? skill.scopes.filter((scope): scope is ArticleSkillScope => scope in skillScopeLabels)
  : ["optimization"];

interface AISettingsPageProps {
  aiSettings: AiSettings;
  materials: ImageMaterial[];
  onSaveProvider: (
    providerId: string,
    patch: Partial<AiProviderConfig> & { apiKey?: string; clearApiKey?: boolean; active?: boolean },
  ) => Promise<void>;
  onTestProvider: (providerId: string) => Promise<ProviderHealthResult>;
  onSaveAgentRole: (role: ArticleAgentRole, providerId: string) => Promise<void>;
  onSaveWritingReviewMode: (mode: AiSettings["writingReviewMode"]) => Promise<void>;
  onSaveSkill: (skillId: string, enabled: boolean) => Promise<void>;
  onImportSkill: (path: string) => Promise<void>;
  onUploadMaterial: (file: File, metadata: MaterialMetadataInput) => Promise<void>;
  onImportMaterial: (url: string, metadata: MaterialMetadataInput) => Promise<void>;
  onDeleteMaterial: (materialId: string) => Promise<void>;
}

const rightsLabels: Record<ImageMaterial["rights"], string> = {
  owned: "自有／已授权",
  licensed: "许可使用",
  official: "官方来源（仍需复核）",
  "editorial-screenshot": "评论性截图",
  "check-required": "使用前确认",
  expired: "授权已到期",
};

const emptyMaterial: MaterialMetadataInput = {
  title: "",
  attribution: "",
  sourceUrl: "",
  tags: [],
  rights: "check-required",
  evidenceNote: "",
  evidencePath: "",
  licenseId: "",
  licenseUrl: "",
  modificationNote: "",
  allowedPlatforms: [],
  expiresAt: "",
  entityTags: [],
};

type MaterialCategory = "all" | "people" | "companies" | "generic" | "review";

const materialCategoryFor = (material: ImageMaterial): Exclude<MaterialCategory, "all" | "review"> => {
  const text = `${material.tags.join(" ")} ${material.entityTags.join(" ")} ${material.title}`.toLowerCase();
  if (/人物|portrait|founder|ceo|负责人|创始人/u.test(text)) return "people";
  if (/公司|品牌|logo|标识|company/u.test(text)) return "companies";
  return "generic";
};

const expiryEndOfDay = (value: string | undefined) => {
  if (!value?.trim()) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.trim();
  return new Date(`${value}T23:59:59.999+08:00`).toISOString();
};

const checkedAtLabel = (value: string) => new Date(value).toLocaleString("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const providerIconFor = (providerId: string) => {
  if (providerId === "qwen") return siQwen;
  if (providerId === "deepseek") return siDeepseek;
  if (providerId === "codex-cli" || providerId === "openai-api") return siOpenaigym;
  return undefined;
};

function ProviderBrandIcon({ provider }: { provider: AiProviderConfig }) {
  const icon = providerIconFor(provider.id);
  if (!icon) return <Cpu size={20} />;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" style={{ color: `#${icon.hex}` }}>
      <path fill="currentColor" d={icon.path} />
    </svg>
  );
}

export function AISettingsPage({
  aiSettings,
  materials,
  onSaveProvider,
  onTestProvider,
  onSaveAgentRole,
  onSaveWritingReviewMode,
  onSaveSkill,
  onImportSkill,
  onUploadMaterial,
  onImportMaterial,
  onDeleteMaterial,
}: AISettingsPageProps) {
  const activeProvider = aiSettings.providers.find((provider) => provider.id === aiSettings.activeProviderId);
  const analysisProvider = aiSettings.providers.find((provider) => provider.id === aiSettings.analysisProviderId);
  const optimizationProvider = aiSettings.providers.find((provider) => provider.id === aiSettings.optimizationProviderId);
  const [providerModal, setProviderModal] = useState<AiProviderConfig>();
  const [providerModel, setProviderModel] = useState("");
  const [providerVisionModel, setProviderVisionModel] = useState("");
  const [providerBaseUrl, setProviderBaseUrl] = useState("");
  const [providerApiKey, setProviderApiKey] = useState("");
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerTestBusy, setProviderTestBusy] = useState<string>();
  const [skillPath, setSkillPath] = useState("");
  const [skillBusy, setSkillBusy] = useState<string>();
  const [roleBusy, setRoleBusy] = useState<ArticleAgentRole>();
  const [writingModeBusy, setWritingModeBusy] = useState(false);
  const [materialComposerOpen, setMaterialComposerOpen] = useState(false);
  const [materialMode, setMaterialMode] = useState<"file" | "url">("file");
  const [materialFile, setMaterialFile] = useState<File>();
  const [materialUrl, setMaterialUrl] = useState("");
  const [materialMetadata, setMaterialMetadata] = useState<MaterialMetadataInput>(emptyMaterial);
  const [materialBusy, setMaterialBusy] = useState(false);
  const [materialSearch, setMaterialSearch] = useState("");
  const [materialCategory, setMaterialCategory] = useState<MaterialCategory>("all");
  const materialFileInput = useRef<HTMLInputElement>(null);
  const providerModelInputRef = useRef<HTMLInputElement>(null);

  const filteredMaterials = useMemo(() => {
    const query = materialSearch.trim().toLowerCase();
    return materials.filter((material) => {
      const matchesQuery = !query
        || `${material.title} ${material.attribution} ${material.tags.join(" ")} ${material.entityTags.join(" ")} ${material.rights}`.toLowerCase().includes(query);
      if (!matchesQuery) return false;
      if (materialCategory === "all") return true;
      if (materialCategory === "review") return materialGovernanceView(material).status === "blocked";
      return materialCategoryFor(material) === materialCategory;
    });
  }, [materialCategory, materialSearch, materials]);
  const usableMaterialCount = useMemo(
    () => materials.filter((material) => materialGovernanceView(material).status !== "blocked").length,
    [materials],
  );

  const openProvider = (provider: AiProviderConfig) => {
    setProviderModal(provider);
    setProviderModel(provider.model);
    setProviderVisionModel(provider.visionModel || "");
    setProviderBaseUrl(provider.baseUrl || "");
    setProviderApiKey("");
  };

  const closeProvider = () => {
    if (providerBusy) return;
    setProviderModal(undefined);
    setProviderApiKey("");
  };
  const providerDialogRef = useDialogA11y<HTMLElement>({
    open: Boolean(providerModal),
    onClose: closeProvider,
    initialFocusRef: providerModelInputRef,
  });

  const saveProvider = async () => {
    if (!providerModal) return;
    setProviderBusy(true);
    try {
      await onSaveProvider(providerModal.id, {
        model: providerModel,
        visionModel: providerVisionModel,
        baseUrl: providerBaseUrl,
        apiKey: providerApiKey || undefined,
      });
      closeProvider();
    } catch {
      // The parent notice contains the actionable API error.
    } finally {
      setProviderBusy(false);
    }
  };

  const activateProvider = async (provider: AiProviderConfig) => {
    setSkillBusy(`provider:${provider.id}`);
    try {
      await onSaveProvider(provider.id, { active: true });
    } catch {
      // The parent notice contains the actionable API error.
    } finally {
      setSkillBusy(undefined);
    }
  };

  const testProvider = async (provider: AiProviderConfig) => {
    setProviderTestBusy(provider.id);
    try {
      await onTestProvider(provider.id);
    } catch {
      // The parent notice contains the actionable API error.
    } finally {
      setProviderTestBusy(undefined);
    }
  };

  const toggleSkill = async (skill: ArticleSkillConfig) => {
    setSkillBusy(skill.id);
    try {
      await onSaveSkill(skill.id, !skill.enabled);
    } catch {
      // The parent notice contains the actionable API error.
    } finally {
      setSkillBusy(undefined);
    }
  };

  const assignAgentRole = async (role: ArticleAgentRole, provider: AiProviderConfig) => {
    setRoleBusy(role);
    try {
      await onSaveAgentRole(role, provider.id);
    } catch {
      // The parent notice contains the actionable API error.
    } finally {
      setRoleBusy(undefined);
    }
  };

  const saveWritingReviewMode = async (mode: AiSettings["writingReviewMode"]) => {
    setWritingModeBusy(true);
    try {
      await onSaveWritingReviewMode(mode);
    } catch {
      // The parent notice contains the actionable API error.
    } finally {
      setWritingModeBusy(false);
    }
  };

  const submitSkill = async () => {
    if (!skillPath.trim()) return;
    setSkillBusy("import");
    try {
      await onImportSkill(skillPath.trim());
      setSkillPath("");
    } catch {
      // The parent notice contains the actionable API error.
    } finally {
      setSkillBusy(undefined);
    }
  };

  const resetMaterialForm = () => {
    setMaterialFile(undefined);
    setMaterialUrl("");
    setMaterialMetadata(emptyMaterial);
    if (materialFileInput.current) materialFileInput.current.value = "";
  };

  const submitMaterial = async () => {
    if (!materialMetadata.title.trim()) return;
    setMaterialBusy(true);
    try {
      const metadata = {
        ...materialMetadata,
        title: materialMetadata.title.trim(),
        attribution: materialMetadata.attribution.trim() || "来源待补充",
        sourceUrl: materialMetadata.sourceUrl?.trim() || undefined,
        evidenceNote: materialMetadata.evidenceNote?.trim() || undefined,
        evidencePath: materialMetadata.evidencePath?.trim() || undefined,
        licenseId: materialMetadata.licenseId?.trim() || undefined,
        licenseUrl: materialMetadata.licenseUrl?.trim() || undefined,
        modificationNote: materialMetadata.modificationNote?.trim() || undefined,
        expiresAt: expiryEndOfDay(materialMetadata.expiresAt),
      };
      if (materialMode === "file" && materialFile) await onUploadMaterial(materialFile, metadata);
      else if (materialMode === "url" && materialUrl.trim()) await onImportMaterial(materialUrl.trim(), metadata);
      else return;
      resetMaterialForm();
      setMaterialComposerOpen(false);
    } catch {
      // The parent notice contains the actionable API error.
    } finally {
      setMaterialBusy(false);
    }
  };

  return (
    <div className="page settings-page ai-settings-page">
      <header className="page-header">
        <div>
          <h1>AI 设置</h1>
          <p>分别配置成稿、文章理解与优化模型，再组装可复用的 Skill。</p>
        </div>
      </header>

      <section className="ai-role-overview" aria-label="AI 工作角色">
        {[
          { id: "draft", label: "成稿", description: "生成快讯与正文", provider: activeProvider, icon: <Sparkles size={17} /> },
          { id: "analysis", label: "分析", description: "理解原文、核对事实", provider: analysisProvider, icon: <FileSearch size={17} /> },
          { id: "optimization", label: "优化", description: "诊断问题、提出改稿", provider: optimizationProvider, icon: <WandSparkles size={17} /> },
        ].map((slot) => {
          const health = slot.provider ? aiSettings.latestProviderHealth[slot.provider.id] : undefined;
          const presentation = slot.provider
            ? providerHealthPresentation(slot.provider, health)
            : { tone: "neutral" as const, label: "尚未选择", detail: "请先选择模型。", stale: false };
          return (
            <article className="ai-role-card" key={slot.id}>
              <span className="ai-role-icon">{slot.icon}</span>
              <div className="ai-role-copy">
                <span>{slot.label}<small>{slot.description}</small></span>
                <strong>{slot.provider?.name || "尚未选择"}</strong>
                <small>{slot.provider?.model || "未填写模型"}</small>
              </div>
              <div className={`ai-role-health ${presentation.tone}`} title={presentation.detail}>
                {presentation.tone === "success" ? <CheckCircle2 size={13} /> : presentation.tone === "error" ? <AlertTriangle size={13} /> : <RefreshCw size={13} />}
                <span>{presentation.label}</span>
              </div>
            </article>
          );
        })}
      </section>

      <section className="ai-settings-section provider-section">
        <div className="ai-section-heading">
          <span className="section-icon"><Bot size={20} /></span>
          <div><h2>AI 接口与 Agent 分工</h2><p>成稿、理解和改稿可以使用不同模型；API Key 只保存在这台 Mac 的系统钥匙串。</p></div>
          <span className="secure-note"><LockKeyhole size={14} />不写入项目文件</span>
        </div>
        <div className="provider-list">
          {aiSettings.providers.map((provider) => {
            const active = provider.id === aiSettings.activeProviderId;
            const activating = skillBusy === `provider:${provider.id}`;
            const testing = providerTestBusy === provider.id;
            const latestHealth = aiSettings.latestProviderHealth[provider.id];
            const healthView = providerHealthPresentation(provider, latestHealth);
            return (
              <article className={active ? "provider-row active" : "provider-row"} key={provider.id}>
                <span className={`provider-logo provider-logo-${provider.id}`}><ProviderBrandIcon provider={provider} /></span>
                <div className="provider-copy">
                  <div><strong>{provider.name}</strong>{active ? <span className="active-pill"><Check size={11} />正在使用</span> : null}</div>
                  <p>{provider.description}</p>
                  <div className="provider-capabilities">
                    <span>{provider.model || "未填写模型"}</span>
                    <span>文本成稿</span>
                    {provider.supportsVision ? <span className="vision">截图识别</span> : <span className="muted">不支持看图</span>}
                    {provider.kind === "codex-cli" ? <span className="native">原生 Skill</span> : <span>提示词 Skill</span>}
                  </div>
                </div>
                <div className="provider-key-state">
                  {provider.kind === "codex-cli" ? (
                    <span className={latestHealth?.status === "healthy" ? "configured" : ""}><CheckCircle2 size={14} />本机 ChatGPT 登录</span>
                  ) : provider.apiKeyConfigured ? (
                    <span className="configured"><ShieldCheck size={14} />已配置 {provider.apiKeyHint || "API Key"}</span>
                  ) : (
                    <span><KeyRound size={14} />未配置 API</span>
                  )}
                  <div className={`provider-health-readout ${healthView.tone}`} title={healthView.detail}>
                    {healthView.tone === "success" ? <CheckCircle2 size={13} /> : healthView.tone === "error" ? <AlertTriangle size={13} /> : <RefreshCw size={13} />}
                    <span>
                      <b>{healthView.label}</b>
                      <small>{latestHealth ? `上次 ${checkedAtLabel(latestHealth.lastCheckedAt)} · ${healthView.detail}` : healthView.detail}</small>
                    </span>
                  </div>
                </div>
                <div className="provider-agent-roles" aria-label={`${provider.name} 的文章 Agent 分工`}>
                  <span><BrainCircuit size={13} />文章 Agent</span>
                  <div>
                    <button
                      type="button"
                      className={aiSettings.analysisProviderId === provider.id ? "selected" : ""}
                      disabled={Boolean(roleBusy) || (provider.kind !== "codex-cli" && !provider.apiKeyConfigured)}
                      title="用这个模型解释原文、核对草稿并回答追问"
                      onClick={() => void assignAgentRole("analysis", provider)}
                    >
                      {roleBusy === "analysis" && aiSettings.analysisProviderId !== provider.id ? <LoaderCircle className="spin" size={12} /> : <FileSearch size={12} />}
                      分析
                    </button>
                    <button
                      type="button"
                      className={aiSettings.optimizationProviderId === provider.id ? "selected" : ""}
                      disabled={Boolean(roleBusy) || (provider.kind !== "codex-cli" && !provider.apiKeyConfigured)}
                      title="用这个模型检查问题并提出一版可应用的优化稿"
                      onClick={() => void assignAgentRole("optimization", provider)}
                    >
                      {roleBusy === "optimization" && aiSettings.optimizationProviderId !== provider.id ? <LoaderCircle className="spin" size={12} /> : <WandSparkles size={12} />}
                      优化
                    </button>
                  </div>
                </div>
                <div className="provider-actions">
                  <button
                    type="button"
                    className="secondary-button compact provider-test-button"
                    disabled={Boolean(providerTestBusy)}
                    title="优先检查模型列表；不生成草稿"
                    onClick={() => void testProvider(provider)}
                  >
                    {testing ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}
                    {testing ? "测试中" : "测试连接"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button compact"
                    aria-label={`配置 ${provider.name} API`}
                    aria-haspopup="dialog"
                    aria-controls="provider-config-dialog"
                    aria-expanded={providerModal?.id === provider.id}
                    onClick={() => openProvider(provider)}
                  >配置 API</button>
                  <button
                    type="button"
                    className={active ? "provider-enable active" : "provider-enable"}
                    disabled={active || activating || (provider.kind !== "codex-cli" && !provider.apiKeyConfigured)}
                    onClick={() => void activateProvider(provider)}
                  >
                    {activating ? <LoaderCircle className="spin" size={14} /> : active ? <Check size={14} /> : null}
                    {active ? "已启用" : "使用此 AI"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="ai-settings-section skill-section">
        <div className="ai-section-heading">
          <span className="section-icon"><Library size={20} /></span>
          <div><h2>Skill 库</h2><p>Skill 按任务隔离：取材规则负责核验，写作规则只在改稿时介入；每次实际使用都会形成快照。</p></div>
          <span className="section-count">{aiSettings.skills.filter((skill) => skill.enabled && skill.available !== false).length}/{aiSettings.skills.length} 可执行</span>
        </div>
        <div className="writing-review-mode" aria-label="写作审校模式">
          {([
            ["auto", "自动", "简讯和综合稿只做 lieflat 最小审校；明确评论稿才叠加 ra-人话。"],
            ["minimal", "只做最小去味", "严格按 lieflat 白名单定位，尽量不动原句。"],
            ["voice", "加强人话表达", "lieflat 后叠加 ra-人话，适合需要鲜明个人表达的稿件。"],
            ["off", "关闭风格审校", "保留事实核验，不注入去 AI 味写作 Skill。"],
          ] as const).map(([mode, label, description]) => (
            <button
              key={mode}
              type="button"
              className={aiSettings.writingReviewMode === mode ? "active" : ""}
              disabled={writingModeBusy}
              onClick={() => void saveWritingReviewMode(mode)}
            >
              <strong>{label}</strong>
              <span>{description}</span>
            </button>
          ))}
        </div>
        <div className="skill-list">
          {aiSettings.skills.map((skill) => (
            <article className={skill.available === false ? "skill-row unavailable" : "skill-row"} key={skill.id}>
              <span className="skill-file"><FileCode2 size={18} /></span>
              <div><strong>{skill.name}</strong><p>{skill.available === false ? "本地 SKILL.md 已不存在或内容为空；成稿时会自动跳过。" : skill.description}</p><small>{skill.available === false ? "路径不可用" : skill.builtIn ? "已预置" : "本地导入"} · {skill.compatibility === "codex-native" ? "Codex 原生工具" : "提示词规则"} · 用于 {skillScopesForLabel(skill).map((scope) => skillScopeLabels[scope]).join(" / ")}</small></div>
              <label className="switch" title={skill.enabled ? "停用 Skill" : "启用 Skill"}>
                <input type="checkbox" checked={skill.enabled && skill.available !== false} disabled={Boolean(skillBusy) || skill.available === false} onChange={() => void toggleSkill(skill)} />
                <span />
              </label>
            </article>
          ))}
        </div>
        <div className="skill-import-row">
          <div><Plus size={16} /><span><strong>导入本地 Skill</strong><small>填写 Skill 文件夹或 SKILL.md 的绝对路径</small></span></div>
          <label><input value={skillPath} onChange={(event) => setSkillPath(event.target.value)} placeholder="选择本机 .codex/skills 下的 Skill 路径" /><button type="button" className="secondary-button compact" disabled={!skillPath.trim() || skillBusy === "import"} onClick={() => void submitSkill()}>{skillBusy === "import" ? <LoaderCircle className="spin" size={14} /> : <Upload size={14} />}导入</button></label>
        </div>
      </section>

      <section className="ai-settings-section material-section">
        <div className="ai-section-heading">
          <span className="section-icon"><Images size={20} /></span>
          <div><h2>图片素材库</h2><p>素材会记录来源、授权证据、可用平台和到期时间；存在阻断项时仍可保存，但不能进入发布流程。</p></div>
          <button type="button" className="primary-button compact" onClick={() => setMaterialComposerOpen((open) => !open)}><ImagePlus size={15} />添加素材</button>
        </div>

        {materialComposerOpen ? (
          <div className="material-composer">
            <div className="material-mode-switch">
              <button type="button" className={materialMode === "file" ? "active" : ""} onClick={() => setMaterialMode("file")}>本地图片</button>
              <button type="button" className={materialMode === "url" ? "active" : ""} onClick={() => setMaterialMode("url")}>图片直链</button>
            </div>
            <div className="material-form-grid">
              {materialMode === "file" ? (
                <label className="material-file-field">
                  <span>图片文件</span>
                  <button type="button" className="secondary-button" onClick={() => materialFileInput.current?.click()}><Upload size={15} />{materialFile?.name || "选择 JPG、PNG、WebP 或 GIF"}</button>
                  <input ref={materialFileInput} hidden type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setMaterialFile(event.target.files?.[0])} />
                </label>
              ) : (
                <label><span>图片直链</span><input value={materialUrl} onChange={(event) => setMaterialUrl(event.target.value)} placeholder="https://…/image.jpg" /></label>
              )}
              <label><span>素材名称</span><input value={materialMetadata.title} onChange={(event) => setMaterialMetadata((current) => ({ ...current, title: event.target.value }))} placeholder="如：Sam Altman 演讲现场" /></label>
              <label><span>来源标注</span><input value={materialMetadata.attribution} onChange={(event) => setMaterialMetadata((current) => ({ ...current, attribution: event.target.value }))} placeholder="如：OpenAI 官方" /></label>
              <label><span>原始来源 URL</span><input value={materialMetadata.sourceUrl || ""} onChange={(event) => setMaterialMetadata((current) => ({ ...current, sourceUrl: event.target.value }))} placeholder="https://…（非自有素材必填）" /></label>
              <label><span>标签</span><input value={materialMetadata.tags.join("、")} onChange={(event) => setMaterialMetadata((current) => ({ ...current, tags: event.target.value.split(/[、,，]/).map((tag) => tag.trim()).filter(Boolean) }))} placeholder="OpenAI、Sam Altman" /></label>
              <label><span>使用权限</span><select value={materialMetadata.rights} onChange={(event) => setMaterialMetadata((current) => ({ ...current, rights: event.target.value as ImageMaterial["rights"] }))}>{Object.entries(rightsLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label><span>人物／品牌实体</span><input value={materialMetadata.entityTags.join("、")} onChange={(event) => setMaterialMetadata((current) => ({ ...current, entityTags: event.target.value.split(/[、,，]/).map((tag) => tag.trim()).filter(Boolean) }))} placeholder="OpenAI、Sam Altman（用于智能检索）" /></label>
              <label><span>授权到期日</span><input type="date" value={materialMetadata.expiresAt?.slice(0, 10) || ""} onChange={(event) => setMaterialMetadata((current) => ({ ...current, expiresAt: event.target.value }))} /><small>长期有效可留空；到期后自动阻断发布。</small></label>
              <fieldset className="material-platform-field">
                <legend>允许发布的平台</legend>
                <label className="material-platform-check"><input type="checkbox" checked={materialMetadata.allowedPlatforms.includes("xiaoheihe")} onChange={(event) => setMaterialMetadata((current) => ({ ...current, allowedPlatforms: event.target.checked ? [...new Set([...current.allowedPlatforms, "xiaoheihe"])] : current.allowedPlatforms.filter((platform) => platform !== "xiaoheihe") }))} /><span>小黑盒</span></label>
                <label className="material-platform-check"><input type="checkbox" checked={materialMetadata.allowedPlatforms.includes("wechat")} onChange={(event) => setMaterialMetadata((current) => ({ ...current, allowedPlatforms: event.target.checked ? [...new Set([...current.allowedPlatforms, "wechat"])] : current.allowedPlatforms.filter((platform) => platform !== "wechat") }))} /><span>微信公众号</span></label>
                <small>请按真实授权范围分别勾选；勾选一个平台不会自动推断另一个平台也可用。</small>
              </fieldset>
              <label className="material-evidence-note"><span>授权／来源证据说明</span><textarea rows={3} value={materialMetadata.evidenceNote || ""} onChange={(event) => setMaterialMetadata((current) => ({ ...current, evidenceNote: event.target.value }))} placeholder="如：品牌媒体包许可条款、拍摄者授权说明，或官方发布页中的来源说明" /></label>
              <label><span>证据文件路径</span><input value={materialMetadata.evidencePath || ""} onChange={(event) => setMaterialMetadata((current) => ({ ...current, evidencePath: event.target.value }))} placeholder="本机授权文件路径（可选）" /></label>
              {materialMetadata.rights === "licensed" ? <>
                <label><span>许可标识</span><input value={materialMetadata.licenseId || ""} onChange={(event) => setMaterialMetadata((current) => ({ ...current, licenseId: event.target.value }))} placeholder="如：CC-BY-4.0" /></label>
                <label><span>许可条款 URL</span><input value={materialMetadata.licenseUrl || ""} onChange={(event) => setMaterialMetadata((current) => ({ ...current, licenseUrl: event.target.value }))} placeholder="https://creativecommons.org/licenses/…" /></label>
                <label className="material-evidence-note"><span>对原图做了什么修改</span><textarea rows={2} value={materialMetadata.modificationNote || ""} onChange={(event) => setMaterialMetadata((current) => ({ ...current, modificationNote: event.target.value }))} placeholder="如：仅缩放，未裁切、调色或叠字" /></label>
              </> : null}
            </div>
            <div className="material-form-actions"><button type="button" className="secondary-button" onClick={() => { resetMaterialForm(); setMaterialComposerOpen(false); }}>取消</button><button type="button" className="primary-button" disabled={materialBusy || !materialMetadata.title.trim() || (materialMode === "file" ? !materialFile : !materialUrl.trim())} onClick={() => void submitMaterial()}>{materialBusy ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />}加入素材库</button></div>
          </div>
        ) : null}

        <div className="material-toolbar">
          <label><Search size={15} /><input value={materialSearch} onChange={(event) => setMaterialSearch(event.target.value)} placeholder="搜索名称、人物、公司或标签" /></label>
          <span>{materials.length} 张素材 · {usableMaterialCount} 张无阻断</span>
        </div>
        <div className="material-filter-tabs" role="group" aria-label="素材类型筛选">
          {([
            ["all", "全部"],
            ["people", "人物"],
            ["companies", "公司与标识"],
            ["generic", "通用示意"],
            ["review", "待处理版权"],
          ] as const).map(([value, label]) => (
            <button type="button" key={value} className={materialCategory === value ? "active" : ""} onClick={() => setMaterialCategory(value)}>{label}</button>
          ))}
        </div>
        {filteredMaterials.length ? (
          <div className="material-grid">
            {filteredMaterials.map((material) => {
              const governance = materialGovernanceView(material);
              return (
                <article className={`material-card governance-${governance.status}`} key={material.id}>
                  <div className="material-image-wrap"><img src={material.publicPath} alt={material.title} /><span className={material.rights}>{rightsLabels[material.rights]}</span></div>
                  <div className="material-card-copy">
                    <strong>{material.title}</strong>
                    <small>{material.attribution}</small>
                    {material.rights === "licensed" ? <small>{material.licenseId || "许可待补充"}{material.modificationNote ? ` · ${material.modificationNote}` : " · 修改说明待补充"}</small> : null}
                    <div>{material.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                    <div className={`material-governance-state ${governance.status}`} title={governance.detail}>
                      {governance.status === "allowed" ? <ShieldCheck size={12} /> : <AlertTriangle size={12} />}
                      <span><b>{governance.label}</b>{governance.detail}</span>
                    </div>
                    <div className="material-lifecycle-meta">
                      <span>{material.allowedPlatforms.includes("xiaoheihe") || material.allowedPlatforms.includes("*") ? "小黑盒已记录" : "未授权小黑盒"}</span>
                      <span>{material.allowedPlatforms.includes("wechat") || material.allowedPlatforms.includes("*") ? "公众号已记录" : "未授权公众号"}</span>
                      {material.expiresAt ? <span>到期 {material.expiresAt.slice(0, 10)}</span> : <span>无到期日</span>}
                    </div>
                  </div>
                  <button type="button" className="material-delete" aria-label={`删除 ${material.title}`} title="从素材库删除（已复制到草稿的图片不受影响）" onClick={() => { if (window.confirm(`从素材库删除“${material.title}”？已插入草稿的副本不会受影响。`)) void onDeleteMaterial(material.id).catch(() => undefined); }}><Trash2 size={14} /></button>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="material-empty"><Images size={27} /><strong>{materials.length ? "没有匹配的素材" : "素材库还是空的"}</strong><span>先加入图片并记录真实来源、授权证据与各平台使用范围；系统会把风险直接显示在素材卡片上。</span><button type="button" className="outline-accent-button" onClick={() => setMaterialComposerOpen(true)}>添加第一张素材 <ChevronRight size={14} /></button></div>
        )}
      </section>

      {providerModal ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeProvider(); }}>
          <section ref={providerDialogRef} id="provider-config-dialog" tabIndex={-1} className="source-modal provider-modal" role="dialog" aria-modal="true" aria-labelledby="provider-modal-title" aria-describedby="provider-modal-description">
            <button type="button" className="modal-close" aria-label={`关闭 ${providerModal.name} API 配置`} disabled={providerBusy} onClick={closeProvider}><X size={17} /></button>
            <span className="provider-modal-icon"><ProviderBrandIcon provider={providerModal} /></span>
            <h2 id="provider-modal-title">配置 {providerModal.name}</h2>
            <p id="provider-modal-description">{providerModal.kind === "codex-cli" ? "这里使用 Codex CLI 的 ChatGPT 登录态，不需要 API Key。" : "保存后密钥会进入本机受保护存储，项目状态里只记录是否已配置。"}</p>
            <label><span>文本模型</span><input ref={providerModelInputRef} value={providerModel} onChange={(event) => setProviderModel(event.target.value)} placeholder="模型名称" /></label>
            {providerModal.supportsVision ? <label><span>视觉模型</span><input value={providerVisionModel} onChange={(event) => setProviderVisionModel(event.target.value)} placeholder="为截图成稿入口预留（可选）" /></label> : null}
            {providerModal.kind !== "codex-cli" ? (
              <>
                <label><span>Base URL</span><input value={providerBaseUrl} onChange={(event) => setProviderBaseUrl(event.target.value)} placeholder="https://…/v1" /></label>
                <label><span>API Key</span><input type="password" autoComplete="new-password" value={providerApiKey} onChange={(event) => setProviderApiKey(event.target.value)} placeholder={providerModal.apiKeyConfigured ? `已保存 ${providerModal.apiKeyHint || "密钥"}；留空则不更改` : "输入 API Key"} /></label>
              </>
            ) : null}
            <div className="provider-modal-security"><LockKeyhole size={14} /><span>密钥不会通过 bootstrap 接口返回，也不会写进 .workflow/state.json。</span></div>
            <div className="modal-actions">
              {providerModal.kind !== "codex-cli" && providerModal.apiKeyConfigured ? <button type="button" className="danger-text-button" disabled={providerBusy} onClick={async () => { setProviderBusy(true); try { await onSaveProvider(providerModal.id, { clearApiKey: true }); closeProvider(); } catch { /* Parent notice owns the error. */ } finally { setProviderBusy(false); } }}>移除密钥</button> : null}
              <span className="modal-actions-spacer" />
              <button type="button" className="secondary-button" disabled={providerBusy} onClick={closeProvider}>取消</button>
              <button type="button" className="primary-button" disabled={providerBusy || !providerModel.trim() || (providerModal.kind !== "codex-cli" && !providerBaseUrl.trim())} onClick={() => void saveProvider()}>{providerBusy ? <LoaderCircle className="spin" size={15} /> : null}保存配置</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
