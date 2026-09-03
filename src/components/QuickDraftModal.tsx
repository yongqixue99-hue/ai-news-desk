import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  Check,
  FileImage,
  Image as ImageIcon,
  Link2,
  LoaderCircle,
  MessageSquareText,
  ScanText,
  Settings2,
  Upload,
  X,
} from "lucide-react";
import type { AiProviderConfig, EvidenceReviewSelection, IntakeReviewRecord } from "../types";
import { useDialogA11y } from "../hooks/useDialogA11y";
import { getRovingTabTarget } from "../hooks/rovingTabs";

const quickDraftModes = ["screenshot", "url", "x-post"] as const;
type QuickDraftMode = (typeof quickDraftModes)[number];

interface QuickDraftModalProps {
  provider: AiProviderConfig;
  initialReview?: IntakeReviewRecord;
  onClose: () => void;
  onOpenAiSettings: () => void;
  onSubmitUrl: (url: string) => Promise<IntakeReviewRecord>;
  onSubmitXPost: (url: string, text: string, author?: string) => Promise<IntakeReviewRecord>;
  onSubmitScreenshot: (file: File, note?: string) => Promise<IntakeReviewRecord>;
  onConfirmReview: (reviewId: string, selection: EvidenceReviewSelection) => Promise<void>;
}

export function QuickDraftModal({
  provider,
  initialReview,
  onClose,
  onOpenAiSettings,
  onSubmitUrl,
  onSubmitXPost,
  onSubmitScreenshot,
  onConfirmReview,
}: QuickDraftModalProps) {
  const [mode, setMode] = useState<QuickDraftMode>("screenshot");
  const [file, setFile] = useState<File>();
  const [url, setUrl] = useState("");
  const [xUrl, setXUrl] = useState("");
  const [xText, setXText] = useState("");
  const [xAuthor, setXAuthor] = useState("");
  const [note, setNote] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<IntakeReviewRecord | undefined>(initialReview);
  const [excludedText, setExcludedText] = useState<string[]>([]);
  const [includedNoise, setIncludedNoise] = useState<string[]>([]);
  const [includedImages, setIncludedImages] = useState<string[]>(() => (
    initialReview?.bundle.imageCandidates
      .filter((image) => image.selectedByDefault)
      .map((image) => image.id) ?? []
  ));
  const inputRef = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<Record<QuickDraftMode, HTMLButtonElement | null>>({ screenshot: null, url: null, "x-post": null });
  const dialogRef = useDialogA11y<HTMLElement>({ open: true, onClose: busy ? undefined : onClose, initialFocusRef: closeButtonRef });
  const previewUrl = useMemo(() => file ? URL.createObjectURL(file) : undefined, [file]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const acceptFile = (next?: File) => {
    if (!next || !["image/jpeg", "image/png", "image/webp"].includes(next.type)) return;
    setFile(next);
  };

  const submit = async () => {
    setBusy(true);
    try {
      const next = mode === "url"
        ? await onSubmitUrl(url.trim())
        : mode === "x-post"
          ? await onSubmitXPost(xUrl.trim(), xText.trim(), xAuthor.trim() || undefined)
          : file ? await onSubmitScreenshot(file, note.trim() || undefined) : undefined;
      if (!next) return;
      setReview(next);
      setIncludedImages(next.bundle.imageCandidates.filter((image) => image.selectedByDefault).map((image) => image.id));
    } catch {
      // The global notice owns the actionable error.
    } finally {
      setBusy(false);
    }
  };

  const confirmReview = async () => {
    if (!review) return;
    setBusy(true);
    try {
      await onConfirmReview(review.id, {
        excludedTextBlockIds: excludedText,
        includedNoiseBlockIds: includedNoise,
        includedImageIds: includedImages,
        note: note.trim() || undefined,
      });
      onClose();
    } catch {
      // The global notice owns the actionable error.
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = mode === "url"
    ? /^https?:\/\//i.test(url.trim())
    : mode === "x-post"
      ? /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/[^/]+\/status\/\d+/i.test(xUrl.trim())
      : Boolean(file && provider.supportsVision);

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    const nextIndex = getRovingTabTarget(quickDraftModes.length, currentIndex, event.key);
    if (nextIndex === null) return;
    event.preventDefault();
    const nextMode = quickDraftModes[nextIndex];
    setMode(nextMode);
    tabRefs.current[nextMode]?.focus();
  };

  return (
    <div
      className="modal-backdrop quick-draft-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onClose();
      }}
    >
      <section ref={dialogRef} tabIndex={-1} className={review ? "quick-draft-modal evidence-review-modal" : "quick-draft-modal"} role="dialog" aria-modal="true" aria-labelledby="quick-draft-title" aria-describedby="quick-draft-description">
        <header>
          <span className="quick-draft-icon"><ScanText size={20} /></span>
          <div>
            <h2 id="quick-draft-title">{review ? "复核提取证据" : "快速生成可编辑草稿"}</h2>
            <p id="quick-draft-description">{review ? "确认保留的正文、被剔除内容和候选图片，再进入成稿。" : "提交截图、网页链接或 X 原帖，先复核证据，再生成草稿。"}</p>
          </div>
          <button type="button" ref={closeButtonRef} className="modal-close" aria-label="关闭快速草稿" disabled={busy} onClick={onClose}><X size={17} /></button>
        </header>

        {review ? (
          <div className="evidence-review-body">
            <section className="evidence-original-pane">
              <h3>原始来源</h3>
              {review.bundle.source.kind === "screenshot" && review.bundle.source.publicPath ? <img src={review.bundle.source.publicPath} alt="用户提交的原始截图" /> : <a href={review.bundle.source.canonicalUrl || review.bundle.source.requestedUrl} target="_blank" rel="noreferrer"><Link2 size={15} />打开原网页</a>}
              <small>采集方式：{review.bundle.method === "screenshot-vision" ? "视觉模型 + OCR" : "网页正文提取"} · {new Date(review.bundle.capturedAt).toLocaleString("zh-CN")}</small>
              {review.bundle.warnings.map((warning) => <p className="evidence-warning" key={warning}>{warning}</p>)}
            </section>
            <section className="evidence-clean-pane">
              <h3>保留正文 <small>{review.bundle.cleanedTextBlocks.length} 块</small></h3>
              <div className="evidence-block-list">
                {review.bundle.cleanedTextBlocks.map((block) => <label key={block.id}><input type="checkbox" checked={!excludedText.includes(block.id)} onChange={(event) => setExcludedText((current) => event.target.checked ? current.filter((id) => id !== block.id) : [...current, block.id])} /><span>{block.text}</span></label>)}
              </div>
              <h3>被剔除内容 <small>{review.bundle.noiseBlocks.length} 块</small></h3>
              <div className="evidence-noise-list">
                {review.bundle.noiseBlocks.length ? review.bundle.noiseBlocks.map((block) => <label key={block.id}><input type="checkbox" checked={includedNoise.includes(block.id)} onChange={(event) => setIncludedNoise((current) => event.target.checked ? [...current, block.id] : current.filter((id) => id !== block.id))} /><span><b>{block.reason}</b>{block.text}</span></label>) : <p>提取器没有保留剔除明细；这一点已作为警告记录。</p>}
              </div>
              <h3>候选图片 <small>{includedImages.length}/{review.bundle.imageCandidates.length} 已选</small></h3>
              <div className="evidence-image-list">
                {review.bundle.imageCandidates.map((image) => <label key={image.id}><input type="checkbox" checked={includedImages.includes(image.id)} onChange={(event) => setIncludedImages((current) => event.target.checked ? [...current, image.id] : current.filter((id) => id !== image.id))} />{image.publicPath || image.url ? <img src={image.publicPath || image.url} alt={image.caption} /> : <ImageIcon size={20} />}<span>{image.caption}</span></label>)}
                {!review.bundle.imageCandidates.length ? <p>没有检测到可用正文图片；不会自动使用通用品牌图凑数。</p> : null}
              </div>
            </section>
          </div>
        ) : <>
        <div className="quick-draft-tabs" role="tablist" aria-label="导入方式" aria-orientation="horizontal">
          <button type="button" ref={(element) => { tabRefs.current.screenshot = element; }} id="quick-tab-screenshot" role="tab" aria-selected={mode === "screenshot"} aria-controls="quick-panel-screenshot" tabIndex={mode === "screenshot" ? 0 : -1} className={mode === "screenshot" ? "active" : ""} onKeyDown={(event) => handleTabKeyDown(event, 0)} onClick={() => setMode("screenshot")}>
            <FileImage size={16} />截图成稿
          </button>
          <button type="button" ref={(element) => { tabRefs.current.url = element; }} id="quick-tab-url" role="tab" aria-selected={mode === "url"} aria-controls="quick-panel-url" tabIndex={mode === "url" ? 0 : -1} className={mode === "url" ? "active" : ""} onKeyDown={(event) => handleTabKeyDown(event, 1)} onClick={() => setMode("url")}>
            <Link2 size={16} />链接成稿
          </button>
          <button type="button" ref={(element) => { tabRefs.current["x-post"] = element; }} id="quick-tab-x-post" role="tab" aria-selected={mode === "x-post"} aria-controls="quick-panel-x-post" tabIndex={mode === "x-post" ? 0 : -1} className={mode === "x-post" ? "active" : ""} onKeyDown={(event) => handleTabKeyDown(event, 2)} onClick={() => setMode("x-post")}>
            <MessageSquareText size={16} />X 原帖
          </button>
        </div>

        <div className="quick-provider-state">
          <span><Check size={13} />当前引擎：{provider.name}</span>
          <small>{mode === "screenshot" ? provider.supportsVision ? `使用 ${provider.visionModel || provider.model} 识图` : "当前引擎不支持识图" : mode === "x-post" ? "只填链接即可：用 X 官方 oEmbed 免费读取，确认后再成稿" : `使用 ${provider.model} 清理并成稿`}</small>
        </div>

        <div id="quick-panel-screenshot" className="quick-draft-panel" role="tabpanel" aria-labelledby="quick-tab-screenshot" hidden={mode !== "screenshot"}>
            {provider.supportsVision ? (
              <button
                type="button"
                className={dragging ? "screenshot-dropzone dragging" : file ? "screenshot-dropzone has-file" : "screenshot-dropzone"}
                onClick={() => inputRef.current?.click()}
                onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  acceptFile(event.dataTransfer.files[0]);
                }}
              >
                {previewUrl ? <img src={previewUrl} alt="待识别截图预览" /> : <Upload size={25} />}
                <span><strong>{file?.name || "点击选择，或把截图拖到这里"}</strong><small>支持 PNG、JPG、WebP，最大 15 MB</small></span>
              </button>
            ) : (
              <div className="vision-unavailable">
                <ImageIcon size={24} />
                <strong>当前 AI 不能读取截图</strong>
                <span>切换到 Codex、通义千问视觉模型或 OpenAI 视觉模型后再试。</span>
                <button type="button" className="secondary-button compact" onClick={onOpenAiSettings}><Settings2 size={14} />打开 AI 设置</button>
              </div>
            )}
            <input ref={inputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => acceptFile(event.target.files?.[0])} />
            <label className="quick-note-field">
              <span>补充要求 <small>可选</small></span>
              <textarea value={note} maxLength={600} onChange={(event) => setNote(event.target.value)} placeholder="例如：只保留测评结果，忽略评论区；语气写得更像快讯。" />
            </label>
            <div className="quick-workflow-preview" aria-label="截图处理步骤">
              <span>1 识别正文</span><span>2 剔除网页杂讯</span><span>3 裁出正文图片</span><span>4 生成草稿</span>
            </div>
        </div>
        <div id="quick-panel-url" className="quick-draft-panel link-panel" role="tabpanel" aria-labelledby="quick-tab-url" hidden={mode !== "url"}>
            <label>
              <span>网页链接</span>
              <div className="quick-url-input"><Link2 size={16} /><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/article" /></div>
            </label>
            <p>系统会识别正文区域、过滤导航与登录信息，并下载页面中与正文直接相关的候选图片。遇到登录墙或动态页面时，改用截图入口更稳定。</p>
        </div>
        <div id="quick-panel-x-post" className="quick-draft-panel link-panel x-post-panel" role="tabpanel" aria-labelledby="quick-tab-x-post" hidden={mode !== "x-post"}>
          <div className="x-post-free-note"><MessageSquareText size={18} /><span><strong>免费人工接力 · 只填链接即可</strong><small>浏览器助手只传当前原帖链接，工作台再用 X 官方 oEmbed 读取公开正文；不调用计费 X API，也不保存登录 Cookie。</small></span></div>
          <label>
            <span>X 原帖链接</span>
            <div className="quick-url-input"><Link2 size={16} /><input value={xUrl} onChange={(event) => setXUrl(event.target.value)} placeholder="https://x.com/OpenAI/status/..." /></div>
          </label>
          <label>
            <span>账号 <small>可选，会从链接自动识别</small></span>
            <input value={xAuthor} maxLength={80} onChange={(event) => setXAuthor(event.target.value)} placeholder="@OpenAI" />
          </label>
          <label>
            <span>粘贴帖子正文 <small>可选，官方读取失败时兜底</small></span>
            <textarea value={xText} maxLength={12000} onChange={(event) => setXText(event.target.value)} placeholder="通常留空；需要导入串文或官方 oEmbed 读取失败时再粘贴。" />
          </label>
          <p>导入后仍会显示“账号身份与上下文待核对”。oEmbed 不提供可直接入库的媒体原图；帖子带图时请另存官方原图或用“截图成稿”补充画面。</p>
        </div>
        </>}

        <footer>
          <span>{review ? "本次选择将作为不可变的成稿证据快照。" : "先提取并复核证据，不会直接把黑箱结果写进草稿。"}</span>
          <div><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button>{review ? <button type="button" className="primary-button" disabled={busy || review.bundle.cleanedTextBlocks.length === excludedText.length} onClick={() => void confirmReview()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{busy ? "正在创建草稿" : "确认证据并生成草稿"}</button> : <button type="button" className="primary-button" disabled={!canSubmit || busy} onClick={() => void submit()}>{busy ? <LoaderCircle className="spin" size={16} /> : <ScanText size={16} />}{busy ? "正在提取证据" : "提取并复核"}</button>}</div>
        </footer>
      </section>
    </div>
  );
}
