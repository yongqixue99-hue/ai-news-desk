import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Copy, ExternalLink, Image as ImageIcon, Info, LoaderCircle, MessageSquareText, Settings2, ShieldCheck } from "lucide-react";
import { bodyHtmlFor } from "../editor-utils";
import { currentPlatformPublicationConfirmation } from "../publication-view";
import { buildDraftEvidenceView } from "../../server/draft-evidence-view.js";
import type { ArticleDraft, WeChatChannelSettings, WeChatDraftSyncReceipt } from "../types";

interface WeChatDraftPanelProps {
  draft: ArticleDraft;
  settings: WeChatChannelSettings;
  metadata?: WeChatDraftMetadata;
  dirty: boolean;
  saving: boolean;
  busy: boolean;
  copiedFormatted: boolean;
  onMetadataChange?: (metadata: WeChatDraftMetadata) => void;
  onSaveDraft: () => Promise<unknown>;
  onSync: (input: { author?: string; digest?: string; contentSourceUrl?: string }) => Promise<WeChatDraftSyncReceipt | undefined>;
  onCopyFormatted: () => Promise<void>;
  onConfirmPublished: () => Promise<void>;
  onOpenSettings: () => void;
}

export interface WeChatDraftMetadata {
  author: string;
  digest: string;
  contentSourceUrl: string;
}

const characterCount = (value: string) => Array.from(value.trim()).length;
const metadataFor = (draft: ArticleDraft, settings: WeChatChannelSettings): WeChatDraftMetadata => ({
  author: settings.defaultAuthor,
  digest: Array.from(draft.take.trim()).slice(0, 120).join(""),
  contentSourceUrl: draft.provenance.originalUrl || "",
});
const formatSyncTime = (value: string) => new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
}).format(new Date(value));

export function WeChatDraftPanel({ draft, settings, metadata: controlledMetadata, dirty, saving, busy, copiedFormatted, onMetadataChange, onSaveDraft, onSync, onCopyFormatted, onConfirmPublished, onOpenSettings }: WeChatDraftPanelProps) {
  const [localMetadata, setLocalMetadata] = useState(() => metadataFor(draft, settings));
  const metadata = controlledMetadata ?? localMetadata;
  const updateMetadata = onMetadataChange ?? setLocalMetadata;
  const controlled = controlledMetadata !== undefined;
  const { author, digest, contentSourceUrl } = metadata;
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [confirmingPublished, setConfirmingPublished] = useState(false);
  const [receipt, setReceipt] = useState(draft.wechatDraft);

  useEffect(() => {
    if (!controlled) setLocalMetadata(metadataFor(draft, settings));
    setReceipt(draft.wechatDraft);
    setSyncError("");
  }, [controlled, draft.id, settings.defaultAuthor]);
  useEffect(() => setReceipt(draft.wechatDraft), [draft.wechatDraft]);

  const insertedImages = useMemo(() => {
    const placements = new Map(draft.images.map((placement) => [placement.id, placement]));
    return [...bodyHtmlFor(draft).matchAll(/data-media-id=["']([^"']+)["']/g)]
      .map((match) => placements.get(match[1]))
      .filter((placement): placement is ArticleDraft["images"][number] => Boolean(placement));
  }, [draft.bodyHtml, draft.images]);
  const cover = insertedImages[0];
  const evidenceView = buildDraftEvidenceView(draft);
  const imagePermissionIssues = insertedImages.filter((placement) => {
    const platforms = placement.image.allowedPlatforms
      ?? (placement.image.rights === "owned" ? ["*"] : []);
    return ["check-required", "expired"].includes(placement.image.rights)
      || !platforms.some((platform) => platform === "wechat" || platform === "*")
      || !placement.image.localPath;
  }).length;
  const checks = [
    { label: `标题 ${characterCount(draft.title)}/32 字`, ok: characterCount(draft.title) > 0 && characterCount(draft.title) <= 32 },
    { label: `作者 ${characterCount(author)}/16 字`, ok: characterCount(author) <= 16 },
    { label: `摘要 ${characterCount(digest)}/120 字`, ok: characterCount(digest) <= 120 },
    { label: cover ? `已选首张正文图为封面` : "正文缺少封面图", ok: Boolean(cover) },
    { label: imagePermissionIssues ? `${imagePermissionIssues} 张图缺少微信许可或本地文件` : `已检查 ${insertedImages.length} 张正文图`, ok: imagePermissionIssues === 0 },
    { label: evidenceView.factDecisionCount ? `${evidenceView.factDecisionCount} 项事实需要确认` : "没有需要你确认的事实", ok: evidenceView.factDecisionCount === 0 },
    { label: evidenceView.attentionClaims.length ? `${evidenceView.attentionClaims.length} 条事实证据不足` : "事实证据可交付", ok: evidenceView.attentionClaims.length === 0 },
    { label: evidenceView.sourceRightsDecisionCount ? "原文工作副本的使用权待确认" : "没有原文转载限制", ok: evidenceView.sourceRightsDecisionCount === 0 },
  ];
  const configured = Boolean(settings.appId && settings.appSecretConfigured);
  const wechatPublication = dirty ? undefined : currentPlatformPublicationConfirmation(draft, "wechat");
  const stale = Boolean(receipt && (dirty || (!wechatPublication && receipt.localDraftUpdatedAt !== draft.updatedAt)));
  const canSync = configured && draft.contentFormat !== "image-post" && checks.every((check) => check.ok);

  const sync = async () => {
    setSyncing(true);
    setSyncError("");
    try {
      if (dirty) await onSaveDraft();
      const result = await onSync({ author, digest, contentSourceUrl });
      if (!result) {
        setSyncError("同步未完成，请按页面顶部提示处理后重试。");
        return;
      }
      setReceipt(result);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncing(false);
    }
  };

  const confirmPublished = async () => {
    if (!window.confirm("请确认：你已经在微信公众平台手动完成发布。系统不会代替你发布，只会记录本次结果。")) return;
    setConfirmingPublished(true);
    setSyncError("");
    try {
      await onConfirmPublished();
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error));
    } finally {
      setConfirmingPublished(false);
    }
  };

  return (
    <>
      <section className="utility-section wechat-draft-summary">
        <div className="wechat-draft-channel-row">
          <div className={configured ? "wechat-channel-mark ready" : "wechat-channel-mark"}><MessageSquareText size={18} /></div>
          <div><strong>{settings.accountName || "微信公众号尚未命名"}</strong><small>{configured ? `AppID ${settings.appId.slice(0, 6)}… · 密钥已在本机保存` : "先连接公众号，才能同步到草稿箱"}</small></div>
          <button type="button" onClick={onOpenSettings}><Settings2 size={13} />{configured ? "管理" : "去连接"}</button>
        </div>
        <p className="wechat-manual-boundary"><ShieldCheck size={14} />系统没有发布或群发操作；同步完成后仍需你登录微信公众平台预览并点击发布。</p>
      </section>

      <section className="utility-section wechat-cover-section">
        <div className="inspector-heading"><h3>封面与正文图片</h3><span>首张正文图作封面</span></div>
        {cover ? (
          <div className="wechat-cover-card">
            <img src={cover.image.publicPath || cover.image.url} alt={cover.caption || cover.image.caption || "公众号封面"} />
            <div><strong>{cover.caption || cover.image.caption || "未命名封面"}</strong><small>{insertedImages.length} 张正文图会自动转为微信可用 JPG，并压缩到 1 MB 内</small></div>
          </div>
        ) : (
          <div className="wechat-cover-empty"><ImageIcon size={21} /><span><strong>还没有封面</strong><small>在正文中插入一张已授权图片；素材托盘中的未插入图片不会被上传。</small></span></div>
        )}
      </section>

      <section className="utility-section wechat-metadata-section">
        <h3>公众号信息</h3>
        <label><span>作者 <small>{characterCount(author)}/16</small></span><input value={author} maxLength={16} onChange={(event) => updateMetadata({ ...metadata, author: event.target.value })} placeholder="可留空" /></label>
        <label><span>摘要 <small>{characterCount(digest)}/120</small></span><textarea value={digest} maxLength={120} onChange={(event) => updateMetadata({ ...metadata, digest: event.target.value })} placeholder="默认取文章观点，可在同步前调整" /></label>
        <label><span>原文链接 <small>可留空</small></span><input value={contentSourceUrl} onChange={(event) => updateMetadata({ ...metadata, contentSourceUrl: event.target.value })} placeholder="https://…" /></label>
      </section>

      <section className="utility-section">
        <div className="inspector-heading"><h3>同步前检查</h3><span>服务端会再次验证</span></div>
        <div className="publish-checklist wechat-checklist">
          {checks.map((item) => <span key={item.label} className={item.ok ? "ok" : "warning"}>{item.ok ? <CheckCircle2 size={15} /> : <Info size={15} />}{item.label}</span>)}
        </div>
        {draft.contentFormat === "image-post" ? <p className="preflight-error">微信公众号当前只支持文章格式，不支持小黑盒截图图文稿。</p> : null}
      </section>

      {receipt ? (
        <section className={stale ? "wechat-receipt stale" : "wechat-receipt current"}>
          <div>{stale ? <Info size={16} /> : <CheckCircle2 size={16} />}<span><strong>{stale ? "微信草稿落后于本地内容" : "微信草稿与本地一致"}</strong><small>{receipt.operation === "created" ? "已新建" : receipt.operation === "updated" ? "已原位更新" : "未重复上传"} · {formatSyncTime(receipt.syncedAt)} · {receipt.imageCount} 张图</small></span></div>
          <a href="https://mp.weixin.qq.com/" target="_blank" rel="noreferrer">打开公众平台<ExternalLink size={12} /></a>
          {!stale ? (
            <div className="wechat-publication-confirm">
              <p>{wechatPublication ? "已记录你在微信后台完成发布。" : "发布仍需你在微信后台操作；完成后再回来确认。"}</p>
              <button type="button" disabled={busy || confirmingPublished || Boolean(wechatPublication)} onClick={() => void confirmPublished()}>
                {wechatPublication ? <><CheckCircle2 size={13} />已确认发布</> : confirmingPublished ? <><LoaderCircle className="spin" size={13} />正在记录…</> : "我已在微信后台发布"}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
      {syncError ? <p className="preflight-error wechat-sync-error">{syncError}</p> : null}

      <div className="wechat-sync-actions">
        <button type="button" className="secondary-button full wechat-copy-fallback" disabled={busy || saving} onClick={() => void onCopyFormatted()}>
          <Copy size={16} />{copiedFormatted ? "公众号排版已复制" : "复制公众号排版"}
        </button>
        <button type="button" className="primary-button full" disabled={busy || saving || syncing || !canSync} onClick={() => void sync()}>
          {busy || saving || syncing ? <LoaderCircle className="spin" size={17} /> : <MessageSquareText size={17} />}
          {receipt ? "更新公众号草稿" : "同步到公众号草稿箱"}
        </button>
        <p className={!configured || !canSync ? "publish-guidance blocked" : "publish-guidance"}>
          {!configured ? "接口不可用时，复制后粘贴到公众号编辑器；需要自动同步时再连接公众号。" : canSync ? "只创建或更新草稿，绝不会自动发布。" : "请先处理上方标记的问题；也可以先复制排版到公众号编辑器。"}
        </p>
      </div>
    </>
  );
}
