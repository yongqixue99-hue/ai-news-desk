import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw, Send, LoaderCircle, Check, CircleAlert } from "lucide-react";
import { api, deliveryBatchApi, socialDeliveryApi } from "../api";
import { socialPlatforms, socialTitleProblem, type SocialDeliveryReceipt } from "../../server/social-delivery-types";
import { socialArticleTitle } from "../../server/social-metadata";
import { deliveryPlatforms, deliveryTargetActive, retryableDeliveryPlatforms, type DeliveryPlatform, type DeliveryBatch, type DeliveryBatchView } from "../../server/delivery-batch-types";
import type { ArticleDraft } from "../types";

type Target = DeliveryPlatform;
const names: Record<Target, string> = { wechat: "微信公众号", xiaoheihe: "小黑盒", zhihu: "知乎", baijiahao: "百家号", toutiao: "今日头条" };
const preferenceKey = "newsdesk.social-platforms.v1";
const initialSelection = (): Target[] => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(preferenceKey) || "null");
    if (Array.isArray(value)) return deliveryPlatforms.filter(p => value.includes(p.id)).map(p => p.id);
  } catch { /* Storage can be unavailable in the desktop webview. */ }
  return ["baijiahao"];
};
interface Props {
  draft: ArticleDraft; dirty: boolean; disabled: boolean;
  prepare: (platforms: DeliveryPlatform[]) => Promise<ArticleDraft | undefined>;
  onBusy: (busy: boolean) => void;
  onOpenSettings: () => void;
  onDelivered: (latest: ArticleDraft, sent: ArticleDraft) => void;
  onChange: (patch: Partial<ArticleDraft>) => void;
}
export function MultiDeliveryPanel(props: Props) {
  const [selected, setSelected] = useState<Target[]>(initialSelection);
  const [connections, setConnections] = useState<DeliveryBatchView["platforms"]>([]);
  const [receipts, setReceipts] = useState<SocialDeliveryReceipt[]>([]);
  const [revisions, setRevisions] = useState<Record<string, string>>({});
  const [batch, setBatch] = useState<DeliveryBatch>();
  const [submitting, setSubmitting] = useState(false);
  const [opening, setOpening] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [progressError, setProgressError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  const sentDraft = useRef<ArticleDraft | undefined>(undefined);
  const acknowledged = useRef<string | undefined>(undefined);
  const mounted = useRef(true);
  const progressGeneration = useRef(0);
  const progressController = useRef<AbortController | undefined>(undefined);
  const connectionController = useRef<AbortController | undefined>(undefined);
  const connectionRead = useRef<Promise<void> | undefined>(undefined);
  const nextConnectionRead = useRef(0);
  const waiting = Boolean(batch?.targets.some(deliveryTargetActive));
  const busy = submitting || waiting;
  const automaticCount = selected.filter(id => deliveryPlatforms.find(p => p.id === id)?.automatic).length;
  const retryable = retryableDeliveryPlatforms(batch);
  const refresh = useCallback(async () => {
    const generation = ++progressGeneration.current;
    progressController.current?.abort();
    const controller = new AbortController(); progressController.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]);
    const current = () => mounted.current && generation === progressGeneration.current && !controller.signal.aborted;
    setRefreshing(true);
    // History is optional: its failure or delay must not hide durable delivery progress.
    void socialDeliveryApi.receipts(props.draft.id, signal).then(history => {
      if (current()) { setReceipts(history.receipts); setRevisions(history.revisions); setHistoryError(""); }
    }).catch(() => { if (current()) setHistoryError("历史回执暂时无法读取，交付进度仍会更新。"); });
    try {
      const view = await deliveryBatchApi.view(props.draft.id, signal);
      if (current()) { setBatch(view.batches[0]); setProgressError(""); }
    } catch {
      if (current()) setProgressError("暂时无法读取进度，已保留上次结果；不会重复发送。");
    } finally { if (current()) setRefreshing(false); }
  }, [props.draft.id]);
  const refreshConnections = useCallback(() => {
    if (connectionRead.current) return connectionRead.current;
    const controller = new AbortController(); connectionController.current = controller;
    nextConnectionRead.current = Date.now() + 10_000;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]);
    const reading = deliveryBatchApi.connections(props.draft.id, signal).then(platforms => {
      if (mounted.current && !controller.signal.aborted) { setConnections(platforms); setConnectionError(""); }
    }).catch(() => {
      if (mounted.current && !controller.signal.aborted) { setConnections([]); setConnectionError("账号检测暂不可用，可直接交付后自动检查"); }
    }).finally(() => { if (connectionRead.current === reading) connectionRead.current = undefined; });
    connectionRead.current = reading;
    return reading;
  }, [props.draft.id]);
  useEffect(() => {
    mounted.current = true; void refresh(); void refreshConnections();
    return () => { mounted.current = false; progressController.current?.abort(); connectionController.current?.abort(); };
  }, [refresh, refreshConnections]);
  useEffect(() => { props.onBusy(busy); return () => props.onBusy(false); }, [busy, props.onBusy]);
  useEffect(() => {
    if (!waiting) return;
    let active = true; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh();
      if (active && Date.now() >= nextConnectionRead.current) void refreshConnections();
      if (active) timer = setTimeout(() => void poll(), 3_000);
    };
    timer = setTimeout(() => void poll(), 1_000);
    return () => { active = false; clearTimeout(timer); };
  }, [waiting, refresh, refreshConnections]);
  useEffect(() => { try { localStorage.setItem(preferenceKey, JSON.stringify(selected)); } catch { /* Optional UI preference. */ } }, [selected]);
  useEffect(() => {
    if (!batch || batch.targets.some(deliveryTargetActive) || !sentDraft.current || acknowledged.current === batch.id) return;
    const sent = sentDraft.current; let active = true;
    void api.draft(sent.id).then(latest => {
      if (active && mounted.current) { acknowledged.current = batch.id; props.onDelivered(latest, sent); }
    }).catch(() => { if (active) setError("暂时无法读取交付后的保存版本，请刷新后继续编辑"); });
    return () => { active = false; };
  }, [batch, props.onDelivered]);
  const acceptBatch = (next: DeliveryBatch) => {
    // A mutation receipt is newer than any already running progress read.
    progressGeneration.current++; progressController.current?.abort();
    setRefreshing(false); setProgressError(""); setBatch(next);
  };
  const run = async (platforms = selected, retryOf?: string) => {
    if (lock.current || busy) return;
    lock.current = true; setSubmitting(true); setError(""); setNotice("");
    try {
      const saved = await props.prepare(platforms);
      if (!saved) throw new Error("正文未能保存，未开始交付");
      sentDraft.current = saved;
      const accountBindings = Object.fromEntries(connections.filter(connection => platforms.includes(connection.id) && connection.accountBinding).map(connection => [connection.id, connection.accountBinding!]));
      const next = await deliveryBatchApi.start(saved.id, { platforms, updatedAt: saved.updatedAt, retryOf, accountBindings });
      if (mounted.current) { acceptBatch(next); if (next.browserError) setError(next.browserError); }
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : String(error)); }
    finally { lock.current = false; if (mounted.current) setSubmitting(false); }
  };
  const open = async () => {
    setOpening(true); setError("");
    try { const result = await deliveryBatchApi.open(selected); setNotice(result.detail); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setOpening(false); }
  };
  const cancel = async () => {
    if (!batch) return;
    try { const next = await deliveryBatchApi.cancel(props.draft.id, batch.id); if (mounted.current) acceptBatch(next); }
    catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : String(error)); }
  };
  const openReceipt = (receipt: SocialDeliveryReceipt) => {
    void socialDeliveryApi.openReceipt(props.draft.id, receipt.id).catch(error => setError(error instanceof Error ? error.message : String(error)));
  };
  const resolve = async (receipt: SocialDeliveryReceipt, resolution: "reviewed" | "not-received") => {
    const question = resolution === "reviewed" ? "已在目标平台核对账号、正文和全部图片？此操作只记录草稿核对。" : "已检查目标平台草稿箱和同步助手历史，确认这次文章没有送达？确认后才允许重试。";
    if (!window.confirm(question)) return;
    setError("");
    try { await socialDeliveryApi.resolve(props.draft.id, receipt.id, resolution); await refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };
  return <section className="multi-delivery">
    <div className="social-heading"><strong>选择交付平台</strong><button type="button" aria-label="刷新平台账号与回执" disabled={refreshing || submitting} onClick={() => { void refresh(); void refreshConnections(); }}><RefreshCw size={14} className={refreshing ? "spin" : ""} /></button></div>
    <div className="social-targets">{deliveryPlatforms.map(platform => {
      const connection = connections.find(item => item.id === platform.id);
      const rule = socialPlatforms.find(item => item.id === platform.id);
      const problem = selected.includes(platform.id) && rule?.enabled ? socialTitleProblem(rule.id, socialArticleTitle(props.draft, rule.id)) : "";
      return <label key={platform.id} className={selected.includes(platform.id) ? "selected" : ""}>
        <input type="checkbox" checked={selected.includes(platform.id)} disabled={busy} onChange={event => setSelected(current => event.target.checked ? [...current, platform.id] : current.filter(item => item !== platform.id))} />
        <span className="social-platform-copy"><span className="social-platform-name"><b>{platform.name}</b><em>{rule ? platform.automatic ? `标题 ${rule.titleMin}–${rule.titleMax} 字` : "仅打开入口" : platform.id === "wechat" ? "核对草稿箱" : "填入编辑页"}</em></span><small>{platform.automatic ? connection?.detail || connectionError || "正在检测连接…" : "自动存稿尚未接通 · 标题 2–30 字"}</small>{problem ? <small className="social-error">{problem}</small> : null}</span>
      </label>;
    })}</div>
    {selected.some(id => socialPlatforms.some(platform => platform.id === id && platform.enabled)) ? <details className="social-variants"><summary>平台标题与封面 <span>默认沿用原稿</span></summary><p className="social-hint">随草稿自动保存，原稿标题与正文保留。</p>{socialPlatforms.filter(platform => platform.enabled && selected.includes(platform.id)).map(platform => {
      const metadata = props.draft.socialMetadata?.[platform.id] ?? {};
      const change = (patch: Partial<typeof metadata>) => props.onChange({ socialMetadata: { ...props.draft.socialMetadata, [platform.id]: { ...metadata, ...patch } } });
      return <fieldset key={platform.id} disabled={busy || props.disabled}><legend>{platform.name}</legend>
        <label>平台标题<input aria-label={`${platform.name}平台标题`} value={metadata.title ?? ""} placeholder={props.draft.title || "沿用原稿标题"} onChange={event => change({ title: event.target.value })} /></label>
        <label>封面<select aria-label={`${platform.name}封面`} value={metadata.coverPlacementId ?? ""} onChange={event => change({ coverPlacementId: event.target.value })}><option value="">正文第一张图片</option>{props.draft.images.map(placement => <option key={placement.id} value={placement.id}>{placement.caption || placement.image.caption || "图片"}</option>)}{metadata.coverPlacementId && !props.draft.images.some(image => image.id === metadata.coverPlacementId) ? <option value={metadata.coverPlacementId}>原封面已移除，请重新选择</option> : null}</select></label>
        {metadata.title || metadata.coverPlacementId ? <button type="button" className="social-open" onClick={() => change({ title: "", coverPlacementId: "" })}>恢复原稿设置</button> : null}
      </fieldset>;
    })}</details> : null}
    <button type="button" className="primary-button full" disabled={props.disabled || busy || opening || !selected.length} onClick={() => automaticCount ? void run() : void open()}>{busy || opening ? <LoaderCircle className="spin" size={15} /> : automaticCount ? <Send size={15} /> : <ExternalLink size={15} />}{submitting ? "保存并开始交付…" : waiting ? "交付处理中…" : opening ? "正在打开…" : automaticCount ? selected.includes("xiaoheihe") ? `交付到 ${automaticCount} 个平台` : `存入 ${automaticCount} 个平台草稿箱` : "打开今日头条编辑页"}</button>
    {props.dirty && automaticCount > 0 ? <p className="social-hint">交付时自动保存当前修改</p> : null}
    <div className="social-toolbar"><button className="social-open" type="button" disabled={opening || !selected.length} onClick={() => void open()}><ExternalLink size={13} />{opening ? "正在打开…" : "打开所选平台 / 登录"}</button><a href="#schedule" onClick={event => { event.preventDefault(); props.onOpenSettings(); }}>连接设置</a></div>
    {selected.includes("toutiao") ? <p className="social-hint social-limit-note">头条会打开文章编辑页，当前不会自动填入。页面自动保存需另行核验，暂不计入存稿数量。</p> : null}

    {batch ? <div className="social-progress" role="status"><div className="social-progress-heading"><strong>{waiting ? "正在交付" : "本次结果"}</strong>{batch.targets.some(t => deliveryTargetActive(t) && t.status !== "sending") ? <button type="button" onClick={() => void cancel()}>取消等待</button> : null}</div>{batch.targets.map(target => {
      const receipt = receipts.find(item => item.id === target.receiptId);
      return <div className={`social-target-result ${target.status}`} key={target.platform}>{deliveryTargetActive(target) ? <LoaderCircle size={14} className="spin" /> : ["verified", "filled", "reported"].includes(target.status) ? <Check size={14} /> : <CircleAlert size={14} />}<div><b>{names[target.platform]}</b><p>{target.detail}</p>{receipt?.url ? <button type="button" className="social-open" onClick={() => openReceipt(receipt)}>查看草稿 <ExternalLink size={11} /></button> : target.url ? <a href={target.url} target="_blank" rel="noreferrer">打开平台核对 <ExternalLink size={11} /></a> : null}</div></div>;
    })}{retryable.length && !waiting ? <button type="button" className="secondary-button social-retry" disabled={props.disabled || submitting} onClick={() => void run(retryable, batch.id)}>重试未完成的平台（{retryable.length}）</button> : null}</div> : null}
    {notice ? <p className="social-hint" role="status">{notice}</p> : null}
    {error ? <p className="social-error" role="alert">{error}</p> : null}
    {progressError ? <p className="social-error" role="alert">{progressError}</p> : null}
    {historyError ? <p className="social-hint" role="status">{historyError}</p> : null}
    {receipts.length ? <details className="social-history"><summary>历史回执 · {receipts.length}</summary>{receipts.map(receipt => <article key={receipt.id}>
      <strong>{names[receipt.platform]} · {receipt.account}</strong><small>{new Date(receipt.createdAt).toLocaleString()} · {!props.dirty && receipt.revisionHash === revisions[receipt.platform] ? "当前版本" : "历史版本"}</small>
      <b>{{ sending: "等待核对结果", unknown: "结果未知", reported: "助手已返回草稿回执", reviewed: "已人工核对草稿", "not-received": "已确认未收到" }[receipt.status]}</b>
      <p>{receipt.detail}</p><div className="social-actions">
      <button type="button" onClick={() => receipt.url ? openReceipt(receipt) : void socialDeliveryApi.open([receipt.platform]).catch(error => setError(String(error)))}>打开草稿核对 <ExternalLink size={11} /></button>
      {["reported", "sending", "unknown"].includes(receipt.status) ? <button disabled={busy} onClick={() => void resolve(receipt, "reviewed")}>已核对草稿</button> : null}
      {["sending", "unknown"].includes(receipt.status) ? <button disabled={busy} onClick={() => void resolve(receipt, "not-received")}>确认未收到，允许重试</button> : null}
      </div></article>)}</details> : null}
  </section>;
}
