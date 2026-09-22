import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Copy, ExternalLink, Image as ImageIcon, Info, LoaderCircle, RefreshCw, Send, Settings2 } from "lucide-react";
import { api } from "../api";
import { bodyHtmlFor } from "../editor-utils";
import { currentPlatformPublicationConfirmation } from "../publication-view";
import { wechatMetadataFor } from "../../server/wechat-metadata.js";
import { buildDraftEvidenceView } from "../../server/draft-evidence-view.js";
import type { WeChatDraftMetadata } from "../../server/types.js";
import type { ArticleDraft, WeChatChannelSettings, WeChatDraftSyncReceipt, WeChatConnectionResult } from "../types";
export type { WeChatDraftMetadata } from "../../server/types.js";

type DeliveryView = Awaited<ReturnType<typeof api.primaryDeliveryStatus>>;
interface WeChatDraftPanelProps {
  draft: ArticleDraft; settings: WeChatChannelSettings; metadata?: WeChatDraftMetadata;
  dirty: boolean; saving: boolean; busy: boolean; copiedFormatted: boolean;
  onMetadataChange?: (metadata: WeChatDraftMetadata) => void;
  onSaveDraft: () => Promise<unknown>;
  onSync: (input: WeChatDraftMetadata) => Promise<WeChatDraftSyncReceipt | undefined>;
  onCopyFormatted: () => Promise<void>; onConfirmPublished: () => Promise<void>;
  onOpenSettings: () => void; onFix?: (tab: "images" | "sources") => void;
}
const count = (value: string) => Array.from(value.trim()).length;
const timeLabel = (value: string) => new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

export function WeChatDraftPanel(props: WeChatDraftPanelProps) {
  const { draft, settings, dirty, saving, busy, onFix } = props;
  const [localMetadata, setLocalMetadata] = useState(() => wechatMetadataFor(draft, settings));
  const metadata = props.metadata ?? localMetadata;
  const updateMetadata = props.onMetadataChange ?? setLocalMetadata;
  const [view, setView] = useState<DeliveryView>();
  const [connection, setConnection] = useState<WeChatConnectionResult>();
  const [checking, setChecking] = useState(false);
  const [working, setWorking] = useState(false);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState(draft.wechatDraft);
  const [confirming, setConfirming] = useState(false);
  const lock = useRef(false);
  const configured = Boolean(settings.appId && settings.appSecretConfigured);
  useEffect(() => { setLocalMetadata(wechatMetadataFor(draft, settings)); setError(""); setView(undefined); }, [draft.id]);
  useEffect(() => setReceipt(draft.wechatDraft), [draft.wechatDraft]);
  useEffect(() => {
    let active = true;
    void api.primaryDeliveryStatus(draft.id).then(result => { if (active) setView(result); }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [draft.id, draft.updatedAt, draft.wechatDraft]);
  useEffect(() => {
    let active = true;
    setConnection(undefined);
    if (!configured) return;
    setChecking(true);
    void api.testWeChatConnection().then(result => { if (active) setConnection(result); }).catch(err => { if (active) setConnection({ ok: false, status: "error", checkedAt: new Date().toISOString(), detail: err.message }); }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [configured, settings.appId]);
  const refreshConnection = async () => {
    setChecking(true); setError("");
    try { setConnection(await api.testWeChatConnection()); setView(await api.primaryDeliveryStatus(draft.id)); }
    catch (err) { setError(err instanceof Error ? err.message : "检查失败，请重试"); }
    finally { setChecking(false); }
  };
  const used = [...new Set([...bodyHtmlFor(draft).matchAll(/data-media-id=["']([^"']+)["']/gu)].map(match => match[1]))];
  const coverId = metadata.coverPlacementId || used[0];
  const cover = draft.images.find(image => image.id === coverId);
  const evidence = buildDraftEvidenceView(draft);
  const localIssues = [
    ...(!count(draft.title) || count(draft.title) > 32 ? ["公众号标题需要 1–32 个字"] : []),
    ...(count(metadata.author) > 16 ? ["公众号作者不能超过 16 个字"] : []),
    ...(count(metadata.digest) > 120 ? ["公众号摘要不能超过 120 个字"] : []),
    ...(!cover ? ["请先选择一张已授权的公众号封面"] : []),
    ...(draft.contentFormat === "image-post" ? ["公众号当前支持文章，请切换为文章后同步"] : []),
  ];
  const issues = [...new Set([...localIssues, ...(!dirty ? view?.wechatPreflight.blockers.filter(issue => !issue.startsWith("公众号尚未连接")) ?? [] : [])])];
  const unresolved = view?.wechat.unresolved;
  const stale = dirty || view?.wechat.status === "changed";
  const publication = dirty ? undefined : currentPlatformPublicationConfirmation(draft, "wechat");
  const disabled = busy || saving || working;
  const send = async () => {
    if (lock.current) return;
    lock.current = true; setWorking(true); setError(""); setPhase("正在保存、同步并核对…");
    try {
      // The workspace owns the single save + send transaction and keeps the editor locked.
      const result = await props.onSync(metadata);
      if (!result) throw new Error("微信没有返回发送结果，请核对草稿箱");
      setReceipt(result); setPhase(result.verification === "verified" ? "已同步并回读核对" : "已接收，待核对");
    } catch (err) { setError(err instanceof Error ? err.message : "同步失败，请重试"); }
    finally {
      try { setView(await api.primaryDeliveryStatus(draft.id)); } catch { /* The send error is more useful. */ }
      lock.current = false; setWorking(false);
    }
  };
  const resolveUnknown = async () => {
    if (!unresolved || !window.confirm("请先打开公众号草稿箱检查。确认本次文章没有收到，再允许重新发送；如果已经收到，请保留平台草稿，不要重发。")) return;
    setWorking(true); setError("");
    try { await api.resolveWeChatAttempt(draft.id, unresolved.id); setView(await api.primaryDeliveryStatus(draft.id)); }
    catch (err) { setError(err instanceof Error ? err.message : "核对记录失败"); }
    finally { setWorking(false); }
  };
  const confirmPublished = async () => {
    if (!window.confirm("已在微信公众平台手动发布这篇文章？这里仅记录发布结果。")) return;
    setConfirming(true); setError("");
    try { await props.onConfirmPublished(); } catch (err) { setError(err instanceof Error ? err.message : "记录失败"); } finally { setConfirming(false); }
  };

  return <div className="primary-delivery-panel wechat-primary">
    <div className="delivery-account">
      <div><strong>{settings.accountName || "微信公众号"}</strong><span className={connection?.ok ? "is-ready" : ""}>{!configured ? "尚未连接" : checking ? "正在检查草稿接口…" : connection?.ok ? "草稿接口可用" : "连接需要处理"}</span></div>
      <button aria-label="公众号连接设置" disabled={disabled} onClick={props.onOpenSettings}><Settings2 size={15} /></button>
      {configured ? <button aria-label="重新检查公众号连接" disabled={checking || disabled} onClick={() => void refreshConnection()}><RefreshCw size={15} className={checking ? "spin" : ""} /></button> : null}
    </div>
    {connection && !connection.ok ? <div className="delivery-issue" role="status"><Info size={16} /><div><strong>先处理公众号连接</strong><p>{connection.detail}</p><button disabled={disabled} onClick={props.onOpenSettings}>去处理连接</button></div></div> : null}
    {!configured ? <div className="delivery-issue"><Info size={16} /><div><strong>连接公众号后自动同步</strong><p>接口不可用时，复制后粘贴到公众号编辑器。</p><button disabled={disabled} onClick={props.onOpenSettings}>连接公众号</button></div></div> : null}
    {unresolved ? <div className="delivery-issue" role="alert"><Info size={16} /><div><strong>上次发送结果待核对</strong><p>连接中断，尚不确定微信是否收到。先检查草稿箱，避免重复创建。</p><button disabled={disabled} onClick={() => void resolveUnknown()}>已核对未收到，允许重试</button></div></div> : null}
    <div className="delivery-main-action">
      <button className="primary-button full" disabled={disabled || checking || !configured || connection?.ok !== true || Boolean(unresolved) || issues.length > 0} onClick={() => void send()}>
        {working || saving ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}
        {working ? phase : receipt && !view?.wechat.accountChanged ? stale ? "更新公众号草稿" : receipt.verification !== "verified" ? "重新核对微信草稿" : "检查并同步最新版本" : "同步到公众号草稿箱"}
      </button>
      <div className="delivery-action-links"><button disabled={disabled} onClick={() => void props.onCopyFormatted().catch(err => setError(err.message))}><Copy size={13} />{props.copiedFormatted ? "已复制" : "复制公众号排版"}</button><a href="https://mp.weixin.qq.com/" target="_blank" rel="noreferrer">打开公众号后台<ExternalLink size={12} /></a></div>
      <p className="delivery-boundary">保存 → 检查 → 同步草稿，由你在平台发布</p>
    </div>
    {error ? <p className="delivery-error" role="alert">{error}</p> : null}
    {receipt ? <div className={`delivery-result ${stale || receipt.verification !== "verified" ? "is-pending" : "is-ready"}`} role="status"><CheckCircle2 size={16} /><div><strong>{view?.wechat.accountChanged ? "公众号已切换，将新建草稿" : stale ? "本地有修改，尚未更新到微信" : receipt.verification === "verified" ? "已同步并回读核对" : "微信已接收，等待内容核对"}</strong><p>{timeLabel(receipt.syncedAt)} · {receipt.imageCount} 张正文图</p>{receipt.verificationDetail ? <small>{receipt.verificationDetail}</small> : null}</div></div> : null}
    <section className="delivery-cover">
      <div className="delivery-section-heading"><strong>封面</strong><button disabled={disabled} onClick={() => onFix?.("images")}>管理配图</button></div>
      <div className="delivery-cover-row">{cover ? <img src={cover.image.publicPath || cover.image.url} alt={cover.caption || "公众号封面"} /> : <span className="delivery-cover-empty"><ImageIcon size={22} /></span>}
      <label><span>选择封面图片</span><select aria-label="公众号封面" value={coverId || ""} disabled={disabled} onChange={event => updateMetadata({ ...metadata, coverPlacementId: event.target.value || undefined })}><option value="">请选择封面</option>{draft.images.map(image => <option key={image.id} value={image.id}>{image.caption || image.image.caption || "未命名图片"}</option>)}</select><small>{used.length} 张正文图 · 封面可单独选择</small></label></div>
    </section>
    <details className="delivery-options"><summary>作者与摘要 <span>{metadata.author || "未填作者"}</span></summary><div className="delivery-fields">
      <label><span>作者 <small>{count(metadata.author)}/16</small></span><input aria-label="公众号作者" value={metadata.author} disabled={disabled} onChange={event => updateMetadata({ ...metadata, author: event.target.value })} placeholder="可留空" /></label>
      <label><span>摘要 <small>{count(metadata.digest)}/120</small></span><textarea aria-label="公众号摘要" value={metadata.digest} disabled={disabled} onChange={event => updateMetadata({ ...metadata, digest: event.target.value })} placeholder="留空由微信提取正文" /></label>
      <label><span>原文链接</span><input aria-label="公众号原文链接" value={metadata.contentSourceUrl} disabled={disabled} onChange={event => updateMetadata({ ...metadata, contentSourceUrl: event.target.value })} placeholder="https://…（可留空）" /></label>
    </div></details>
    {issues.length ? <section className="delivery-blockers"><strong>需要处理 · {issues.length} 项</strong><ul>{issues.map(issue => <li key={issue}><span>{issue}</span>{/图片|配图|封面/u.test(issue) ? <button disabled={disabled} onClick={() => onFix?.("images")}>配图</button> : /事实|来源|证据|转载/u.test(issue) ? <button disabled={disabled} onClick={() => onFix?.("sources")}>资料</button> : null}</li>)}</ul></section> : <p className="delivery-check-ok"><CheckCircle2 size={14} />{dirty ? "修改将在发送前保存并重新检查" : "当前稿件检查通过"}</p>}
    <details className="delivery-options"><summary>核对与发布记录</summary><div className="delivery-detail-copy"><p>{evidence.factDecisionCount ? `${evidence.factDecisionCount} 项事实需要确认` : "没有需要你确认的事实"}</p><p>成功同步是保存到草稿箱，最终发布在微信后台完成。</p>{receipt && !stale && receipt.verification === "verified" ? <button className="secondary-button full" disabled={disabled || confirming || Boolean(publication)} onClick={() => void confirmPublished()}>{publication ? "已记录发布" : confirming ? "正在记录…" : "我已在微信后台发布"}</button> : null}</div></details>
  </div>;
}
