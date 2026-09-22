import { useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronDown, ImagePlus, LoaderCircle, Send, Settings2 } from "lucide-react";
import type { ArticleDraft, DraftImagePlacement, PublisherResult } from "../types";
import { XHH_FIXED_TOPICS, xiaoheiheSelection } from "../../server/xiaoheihe-publishing";
import { XiaoheiheFormatPanel } from "./XiaoheiheFormatPanel";

interface Props {
  draft: ArticleDraft;
  nextCompanion?: "Steam" | "数码硬件";
  busy: boolean;
  connected: boolean;
  stale: boolean;
  result?: PublisherResult;
  error: string;
  selectedImageIds: string[];
  onChange: (patch: Partial<ArticleDraft>) => void;
  onSend: () => void;
  onSettings: () => void;
  onUpload: (file: File) => Promise<DraftImagePlacement>;
  onConfirmPublished: () => void;
  publicationRemembered: boolean;
}

export function XiaoheiheDeliveryPanel({ draft, nextCompanion, busy, connected, stale, result, error, selectedImageIds, onChange, onSend, onSettings, onUpload, onConfirmPublished, publicationRemembered }: Props) {
  const selection = xiaoheiheSelection(draft, nextCompanion);
  const options = selection.options;
  const cover = draft.images.find(image => image.id === options.coverPlacementId);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const disabled = busy || uploading;
  const update = (patch: Partial<NonNullable<ArticleDraft["xiaoheiheOptions"]>>) => onChange({ xiaoheiheOptions: { ...options, ...patch } });
  const receiptUrl = result?.pageUrl && /^https:\/\/(www\.)?xiaoheihe\.cn\//u.test(result.pageUrl) ? result.pageUrl : "https://www.xiaoheihe.cn/creator/content";
  const planName = options.creationPlan === "none" ? "不参与" : options.creationPlan === "hot" ? "热点计划" : draft.contentFormat === "image-post" ? "图文计划" : "文章计划";
  return <section className="xhh-delivery" aria-label="小黑盒发布设置">
    <div className="xhh-delivery-heading"><div><strong>送到小黑盒</strong><p>正文、配图和发布设置一次填好</p></div><button className="xhh-icon-button" aria-label="小黑盒连接设置" title="连接设置" onClick={onSettings}><Settings2 size={16} /></button></div>
    <button className="primary-button full xhh-send" disabled={disabled} onClick={onSend}>{busy ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}{busy ? "正在准备并填入…" : "送到小黑盒"}</button>
    <p className="xhh-send-note">{connected ? "自动保存并检查，随后打开小黑盒供你发布" : "自动连接 Chrome 并填入，随后由你检查发布"}</p>
    {error ? <p className="delivery-error" role="alert">{error}</p> : null}
    {result ? <div className={`xhh-receipt ${result.ok && !stale ? "ready" : "attention"}`}>
      <div><strong>{result.ok ? stale ? "内容有更新，再送一次即可" : "已填好，可以前往检查" : "还有项目未填好"}</strong><a href={receiptUrl} target="_blank" rel="noreferrer">打开小黑盒 <ArrowUpRight size={14} /></a></div>
      {!result.ok ? result.steps.filter(step => !step.ok).map(step => <p key={step.name}>{step.name}：{step.detail}</p>) : null}
      <details><summary>填入明细</summary>{result.steps.map(step => <p key={step.name}>{step.ok ? "✓" : "!"} {step.name} · {step.detail}</p>)}{result.ok && !stale ? <button className="xhh-text-button" disabled={publicationRemembered || busy} onClick={onConfirmPublished}>{publicationRemembered ? "已记录发布" : "我已在小黑盒发布，记录本次交付"}</button> : null}</details>
    </div> : null}
    <div className="xhh-settings" inert={disabled}>
      <details className="xhh-disclosure"><summary><span><strong>社区与话题</strong><small>{selection.communities.join(" · ")} · {selection.topics.length} 个话题</small></span><ChevronDown size={15} /></summary>
        <label className="xhh-field"><span>主要社区</span><input aria-label="关联社区" list="xhh-community-options" value={draft.community} placeholder="盒友杂谈" onChange={event => onChange({ community: event.target.value, xiaoheiheOptions: options })} /><datalist id="xhh-community-options">{["盒友杂谈", "CodeX", "Steam", "数码硬件"].map(value => <option value={value} key={value} />)}</datalist></label>
        <p className="xhh-help">{selection.communities.length === 1 ? "盒友杂谈单独关联。" : `自动搭配 ${selection.communities[1]}，新稿在 Steam 和数码硬件之间轮换。`}</p>
        <span className="xhh-field-label">每篇自动带上</span><div className="xhh-fixed-topics">{XHH_FIXED_TOPICS.map(topic => <span key={topic}># {topic}</span>)}</div>
        <label className="xhh-field"><span>补充话题 <small>选填，最多 1 个</small></span><input aria-label="补充话题" value={selection.topics[4] ?? ""} placeholder="再加一个与本文相关的话题" onChange={event => onChange({ topics: [...XHH_FIXED_TOPICS, event.target.value].filter(Boolean), xiaoheiheOptions: options })} /></label>
      </details>
      <details className="xhh-disclosure"><summary><span><strong>创作计划</strong><small>{planName}{options.creationPlan !== "none" ? cover ? " · 已选封面" : " · 需要封面" : " · 可随时选择计划"}</small></span><ChevronDown size={15} /></summary>
        <div className="xhh-plan-options" role="group" aria-label="创作计划">{([ ["none", "不参与"], ["standard", draft.contentFormat === "image-post" ? "图文计划" : "文章计划"], ["hot", "热点计划"] ] as const).map(([value, label]) => <button key={value} aria-pressed={options.creationPlan === value} onClick={() => update({ creationPlan: value })}>{options.creationPlan === value ? <Check size={12} /> : null}{label}</button>)}</div>
        {options.creationPlan !== "none" ? <div className="xhh-cover-picker">
          <span className="xhh-field-label">内容封面</span>
          <button className={`xhh-cover-card ${cover ? "has-cover" : ""}`} onClick={() => fileInput.current?.click()}>
            <span><strong>{draft.title || "文章标题"}</strong><small>{uploading ? "正在上传…" : cover ? "点击更换封面" : "上传封面"}</small></span>{cover ? <img src={cover.image.publicPath || cover.image.url} alt="小黑盒内容封面" /> : <span className="xhh-cover-empty"><ImagePlus size={22} /></span>}
          </button>
          {draft.images.length ? <select aria-label="小黑盒封面" value={options.coverPlacementId ?? ""} onChange={event => update({ coverPlacementId: event.target.value || undefined })}><option value="">或使用草稿中的图片</option>{draft.images.map(image => <option key={image.id} value={image.id}>{image.caption || image.image.caption || "未命名图片"}</option>)}</select> : null}
          <input ref={fileInput} type="file" hidden accept="image/jpeg,image/png,image/webp" aria-label="上传小黑盒封面" onChange={async event => {
            const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
            setUploading(true); setUploadError("");
            try { const image = await onUpload(file); update({ coverPlacementId: image.id }); }
            catch (error) { setUploadError(error instanceof Error ? error.message : String(error)); }
            finally { setUploading(false); }
          }} />
          <p className="xhh-help">横图至少 900 × 480，最大 10 MB。封面独立于正文。</p>{uploadError ? <p role="alert" className="delivery-error">{uploadError}</p> : null}
          {cover && (cover.image.rights === "check-required" || cover.image.rights === "owned") ? <label className="inline-check xhh-cover-rights"><input type="checkbox" checked={cover.image.rights === "owned" && (cover.image.allowedPlatforms ?? []).some(platform => platform === "xiaoheihe" || platform === "*")} onChange={event => {
            const confirmed = event.target.checked;
            onChange({ images: draft.images.map(image => image.id !== cover.id ? image : { ...image, image: { ...image.image, rights: confirmed ? "owned" : "check-required", allowedPlatforms: confirmed ? [...new Set([...(image.image.allowedPlatforms ?? []), "xiaoheihe"])] : (image.image.allowedPlatforms ?? []).filter(platform => platform !== "xiaoheihe" && platform !== "*") } }) });
          }} /><span>我拥有此封面的使用权，可发布到小黑盒</span></label> : null}
        </div> : null}
      </details>
      <details className="xhh-disclosure"><summary><span><strong>发送形式</strong><small>{draft.contentFormat === "image-post" ? "图文图集" : "文章"} · 所有人可见</small></span><ChevronDown size={15} /></summary><XiaoheiheFormatPanel draft={draft} selectedIds={selectedImageIds} onChange={onChange} disabled={disabled} /></details>
    </div>
  </section>;
}
