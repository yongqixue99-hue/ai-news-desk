import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw, Send, LoaderCircle, Check, CircleAlert } from "lucide-react";
import { socialDeliveryApi } from "../api";
import { socialPlatforms, socialTargetActive, socialTitleProblem, type SocialDeliveryStatus, type SocialDeliveryReceipt, type SocialDeliveryBatch } from "../../server/social-delivery-types";
import type { ArticleDraft } from "../types";

type Target = typeof socialPlatforms[number]["id"];
const names: Record<Target, string> = { zhihu: "知乎", baijiahao: "百家号", toutiao: "今日头条" };
const preferenceKey = "newsdesk.social-platforms.v1";
const initialSelection = (): Target[] => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(preferenceKey) || "null");
    if (Array.isArray(value)) return socialPlatforms.filter(p => value.includes(p.id)).map(p => p.id);
  } catch { /* Storage can be unavailable in the desktop webview. */ }
  return ["baijiahao"];
};
interface Props {
  draft: ArticleDraft; dirty: boolean; disabled: boolean;
  save: () => Promise<ArticleDraft | undefined>;
  onBusy: (busy: boolean) => void;
  onOpenSettings: () => void;
}
export function MultiDeliveryPanel(props: Props) {
  const [selected, setSelected] = useState<Target[]>(initialSelection);
  const [status, setStatus] = useState<SocialDeliveryStatus>();
  const [receipts, setReceipts] = useState<SocialDeliveryReceipt[]>([]);
  const [revisions, setRevisions] = useState<Record<string, string>>({});
  const [batch, setBatch] = useState<SocialDeliveryBatch>();
  const [submitting, setSubmitting] = useState(false);
  const [opening, setOpening] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  const mounted = useRef(true);
  const waiting = Boolean(batch?.targets.some(socialTargetActive));
  const busy = submitting || waiting;
  const automaticCount = selected.filter(id => socialPlatforms.find(p => p.id === id)?.enabled).length;
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [connection, batches] = await Promise.all([socialDeliveryApi.status(), socialDeliveryApi.batches(props.draft.id)]);
      const history = await socialDeliveryApi.receipts(props.draft.id);
      if (mounted.current) { setStatus(connection); setReceipts(history.receipts); setRevisions(history.revisions); setBatch(batches[0]); }
    } finally { if (mounted.current) setRefreshing(false); }
  }, [props.draft.id]);
  useEffect(() => { mounted.current = true; void refresh().catch(error => { if (mounted.current) setError(String(error)); }); return () => { mounted.current = false; }; }, [refresh]);
  useEffect(() => { props.onBusy(busy); return () => props.onBusy(false); }, [busy, props.onBusy]);
  useEffect(() => {
    if (!waiting) return;
    let active = true; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { await refresh(); } catch { if (active) setError("暂时无法读取进度，正在重新连接；不会重复发送"); }
      if (active) timer = setTimeout(() => void poll(), 3_000);
    };
    timer = setTimeout(() => void poll(), 1_000);
    return () => { active = false; clearTimeout(timer); };
  }, [waiting, refresh]);
  useEffect(() => { try { localStorage.setItem(preferenceKey, JSON.stringify(selected)); } catch { /* Optional UI preference. */ } }, [selected]);
  const run = async () => {
    if (lock.current || busy) return;
    lock.current = true; setSubmitting(true); setError(""); setNotice("");
    try {
      const saved = await props.save();
      if (!saved) throw new Error("正文未能保存，未开始交付");
      const accounts = Object.fromEntries((status?.accounts ?? []).filter(a => a.authenticated && a.accountId && a.username).map(a => [a.id, { account: a.username, accountId: a.accountId }]));
      const next = await socialDeliveryApi.start(saved.id, { platforms: selected, updatedAt: saved.updatedAt, accounts });
      if (mounted.current) { setBatch(next); if (next.browserError) setError(next.browserError); }
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : String(error)); }
    finally { lock.current = false; if (mounted.current) setSubmitting(false); }
  };
  const open = async () => {
    setOpening(true); setError("");
    try { const result = await socialDeliveryApi.open(selected); setNotice(result.detail); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setOpening(false); }
  };
  const cancel = async () => {
    if (!batch) return;
    try { setBatch(await socialDeliveryApi.cancel(props.draft.id, batch.id)); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
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
    <div className="social-heading"><strong>选择交付平台</strong><button type="button" aria-label="刷新平台账号与回执" disabled={refreshing || submitting} onClick={() => void refresh().catch(error => setError(String(error)))}><RefreshCw size={14} className={refreshing ? "spin" : ""} /></button></div>
    <div className="social-targets">{socialPlatforms.map(platform => {
      const account = status?.accounts.find(item => item.id === platform.id);
      const problem = selected.includes(platform.id) ? socialTitleProblem(platform.id, props.draft.title) : "";
      return <label key={platform.id} className={selected.includes(platform.id) ? "selected" : ""}>
        <input type="checkbox" checked={selected.includes(platform.id)} disabled={busy} onChange={event => setSelected(current => event.target.checked ? [...current, platform.id] : current.filter(item => item !== platform.id))} />
        <span className="social-platform-copy"><span className="social-platform-name"><b>{platform.name}</b><em>{platform.enabled ? `标题 ${platform.titleMin}–${platform.titleMax} 字` : "仅打开入口"}</em></span><small>{platform.enabled ? account?.detail || "正在检测连接…" : "自动存稿尚未接通 · 标题 2–30 字"}</small>{problem ? <small className="social-error">{problem}</small> : null}</span>
      </label>;
    })}</div>
    <button type="button" className="primary-button full" disabled={props.disabled || busy || !automaticCount} onClick={() => void run()}>{busy ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />}{submitting ? "保存并开始交付…" : waiting ? "交付处理中…" : `存入 ${automaticCount} 个平台草稿箱`}</button>
    <div className="social-toolbar"><button className="social-open" type="button" disabled={opening || !selected.length} onClick={() => void open()}><ExternalLink size={13} />{opening ? "正在打开…" : "打开所选平台 / 登录"}</button><a href="#schedule" onClick={event => { event.preventDefault(); props.onOpenSettings(); }}>连接设置</a></div>
    {selected.includes("toutiao") ? <p className="social-hint social-limit-note">头条会打开文章编辑页，当前不会自动填入。页面自动保存需另行核验，暂不计入存稿数量。</p> : null}
    {!status?.connected ? <p className="social-hint">网站登录与同步连接是两件事。已登录账号不用重登；连接助手后会自动继续。</p> : null}
    {batch ? <div className="social-progress" role="status"><div className="social-progress-heading"><strong>{waiting ? "正在交付" : "本次结果"}</strong>{batch.targets.some(t => socialTargetActive(t) && t.status !== "sending") ? <button type="button" onClick={() => void cancel()}>取消等待</button> : null}</div>{batch.targets.map(target => {
      const receipt = receipts.find(item => item.id === target.receiptId);
      return <div className={`social-target-result ${target.status}`} key={target.platform}>{socialTargetActive(target) ? <LoaderCircle size={14} className="spin" /> : target.status === "reported" ? <Check size={14} /> : <CircleAlert size={14} />}<div><b>{names[target.platform]}</b><p>{target.detail}</p>{receipt?.url ? <button type="button" className="social-open" onClick={() => openReceipt(receipt)}>查看草稿 <ExternalLink size={11} /></button> : null}</div></div>;
    })}</div> : null}
    {notice ? <p className="social-hint" role="status">{notice}</p> : null}
    {error ? <p className="social-error" role="alert">{error}</p> : null}
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
