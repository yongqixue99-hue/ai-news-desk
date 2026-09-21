import { useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw, Send, LoaderCircle } from "lucide-react";
import { socialDeliveryApi } from "../api";
import { socialPlatforms, type SocialDeliveryStatus, type SocialDeliveryReceipt } from "../../server/social-delivery-types";
import type { ArticleDraft } from "../types";

type Target = "wechat" | "xiaoheihe" | typeof socialPlatforms[number]["id"];
const names: Record<Target, string> = { wechat: "微信公众号", xiaoheihe: "小黑盒", zhihu: "知乎", baijiahao: "百家号", toutiao: "今日头条" };
interface Props {
  draft: ArticleDraft; dirty: boolean; disabled: boolean; wechatConfigured: boolean; publisherReady: boolean;
  save: () => Promise<ArticleDraft | undefined>;
  prepareWechat: () => Promise<unknown>; prepareXiaoheihe: () => Promise<unknown>;
  onBusy: (busy: boolean) => void;
  onOpenSettings: () => void;
}
export function MultiDeliveryPanel(props: Props) {
  const [selected, setSelected] = useState<Target[]>(["wechat"]);
  const [status, setStatus] = useState<SocialDeliveryStatus>();
  const [receipts, setReceipts] = useState<SocialDeliveryReceipt[]>([]);
  const [revisions, setRevisions] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<Partial<Record<Target, string>>>({});
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      const [connection, history] = await Promise.all([socialDeliveryApi.status(), socialDeliveryApi.receipts(props.draft.id)]);
      setStatus(connection); setReceipts(history.receipts); setRevisions(history.revisions);
    } finally { setRefreshing(false); }
  };
  useEffect(() => { void refresh().catch(error => setError(String(error))); }, [props.draft.id]);
  useEffect(() => {
    let current = true;
    void socialDeliveryApi.receipts(props.draft.id).then(history => { if (current) { setReceipts(history.receipts); setRevisions(history.revisions); } }).catch(error => { if (current) setError(String(error)); });
    return () => { current = false; };
  }, [props.draft.id, props.draft.updatedAt]);
  const run = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); props.onBusy(true); setError(""); setProgress({});
    try {
      const saved = await props.save();
      if (!saved) throw new Error("正文未能保存，未开始投递");
      await Promise.all(selected.map(async target => {
        setProgress(current => ({ ...current, [target]: "正在检查并投递…" }));
        try {
          let detail = "";
          if (target === "wechat") {
            if (!props.wechatConfigured) throw new Error("请先到设置填写 AppSecret 并测试草稿接口");
            if (!await props.prepareWechat()) throw new Error("微信没有返回草稿回执，请查看连接设置");
            detail = "已同步公众号草稿箱";
          } else if (target === "xiaoheihe") {
            await props.prepareXiaoheihe(); detail = "已填入小黑盒编辑器，请在平台检查";
          } else {
            const account = status?.accounts.find(account => account.id === target);
            if (!account?.available || !account.authenticated || !account.username || !account.accountId) throw new Error(account?.detail || "请先连接文章同步助手");
            const receipt = await socialDeliveryApi.deliver(saved.id, { platform: target, account: account.username, accountId: account.accountId, updatedAt: saved.updatedAt });
            detail = receipt.detail;
          }
          setProgress(current => ({ ...current, [target]: detail }));
        } catch (error) { setProgress(current => ({ ...current, [target]: error instanceof Error ? error.message : String(error) })); }
      }));
      await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { lock.current = false; setBusy(false); props.onBusy(false); }
  };
  const resolve = async (receipt: SocialDeliveryReceipt, resolution: "reviewed" | "not-received") => {
    const question = resolution === "reviewed" ? "已在目标平台核对账号、正文和全部图片？此操作只记录草稿核对，不代表公开发布。" : "已检查目标平台草稿箱和同步助手历史，确认这次文章没有送达？确认后才允许重试。";
    if (!window.confirm(question)) return;
    setError("");
    try { await socialDeliveryApi.resolve(props.draft.id, receipt.id, resolution); await refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };
  return <section className="multi-delivery">
    <div className="social-heading"><strong>选择这篇文章的投递平台</strong><button type="button" aria-label="刷新平台账号与回执" disabled={refreshing || busy} onClick={() => void refresh().catch(error => setError(String(error)))}><RefreshCw size={14} className={refreshing ? "spin" : ""} /></button></div>
    <div className="social-targets">{(Object.keys(names) as Target[]).map(target => {
      const social = status?.accounts.find(item => item.id === target);
      const reason = target === "wechat" ? props.wechatConfigured ? "已配置 · 同步草稿箱" : "待填写 AppSecret"
        : target === "xiaoheihe" ? props.publisherReady ? "填入助手已连接" : "待连接小黑盒助手"
          : social?.detail || "待连接文章同步助手";
      return <label key={target} className={selected.includes(target) ? "selected" : ""}>
        <input type="checkbox" checked={selected.includes(target)} disabled={busy || target === "toutiao"} onChange={event => setSelected(current => event.target.checked ? [...current, target] : current.filter(item => item !== target))} />
        <span><b>{names[target]}</b><small>{target === "toutiao" ? "待接入 · 暂不自动投递" : reason}</small></span>
      </label>;
    })}</div>
    <button type="button" className="primary-button full" disabled={props.disabled || busy || !selected.length} onClick={() => void run()}>{busy ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />}{busy ? "正在投递所选平台…" : `一键投递所选 ${selected.length} 个平台`}</button>
    <p className="social-hint">先保存当前稿件，各平台独立处理。同步到草稿箱后，由你检查并发布。知乎、百家号的新版本会新建草稿，同版本复用回执。</p>
    <div className="social-links"><a href="#schedule" onClick={(event) => { event.preventDefault(); props.onOpenSettings(); }}>连接设置</a>{socialPlatforms.map(platform => <a key={platform.id} href={platform.url} target="_blank" rel="noreferrer">{platform.name}后台 <ExternalLink size={11} /></a>)}</div>
    {Object.entries(progress).length ? <div className="social-progress" role="status">{Object.entries(progress).map(([id, detail]) => <p key={id}><b>{names[id as Target]}</b><span>{detail}</span></p>)}</div> : null}
    {error ? <p className="social-error" role="alert">{error}</p> : null}
    {receipts.length ? <details className="social-history" open><summary>投递记录（{receipts.length}）</summary>{receipts.map(receipt => <article key={receipt.id}>
      <strong>{names[receipt.platform]} · {receipt.account}</strong><small>{new Date(receipt.createdAt).toLocaleString()} · {!props.dirty && receipt.revisionHash === revisions[receipt.platform] ? "当前版本" : "历史版本"}</small>
      <b>{{ sending: "等待核对结果", unknown: "结果未知", reported: "助手已返回草稿回执", reviewed: "已人工核对草稿", "not-received": "已确认未收到" }[receipt.status]}</b>
      <p>{receipt.detail}</p><div className="social-actions">
      {receipt.url ? <a href={receipt.url} target="_blank" rel="noreferrer">打开草稿 <ExternalLink size={11} /></a> : <a href={socialPlatforms.find(item => item.id === receipt.platform)!.url} target="_blank" rel="noreferrer">打开平台核对</a>}
      {["reported", "sending", "unknown"].includes(receipt.status) ? <button disabled={busy} onClick={() => void resolve(receipt, "reviewed")}>已核对草稿</button> : null}
      {["sending", "unknown"].includes(receipt.status) ? <button disabled={busy} onClick={() => void resolve(receipt, "not-received")}>确认未收到，允许重试</button> : null}
      </div></article>)}</details> : null}
  </section>;
}
