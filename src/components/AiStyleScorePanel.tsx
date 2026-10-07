import { useEffect, useState } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import type { ArticleDraft } from "../types";
import type { AiStyleResult } from "ai-style-score";
import { api } from "../api";
import { draftDocumentKey } from "../../server/draft-document.js";
import { bodyHtmlFor, textFromHtml } from "../editor-utils";

const bandLabel: Record<AiStyleResult["band"], string> = {
  low: "较少文风问题",
  some: "有些地方可检查",
  high: "多处值得检查",
  very_high: "建议逐段检查",
};

export function AiStyleScorePanel({ draft }: { draft: ArticleDraft }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState<"key" | "score" | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AiStyleResult>();
  const [scoredKey, setScoredKey] = useState("");
  const documentKey = draftDocumentKey(draft);
  const text = textFromHtml(bodyHtmlFor(draft)).trim();
  const stale = Boolean(result && scoredKey !== documentKey);

  useEffect(() => {
    let active = true;
    void api.aiStyleKeyStatus().then((status) => { if (active) setConfigured(status.configured); })
      .catch(() => { if (active) setError("无法读取本机 Jev 配置"); });
    return () => { active = false; };
  }, []);

  useEffect(() => { setResult(undefined); setScoredKey(""); setError(""); }, [draft.id]);

  const saveKey = async () => {
    setBusy("key"); setError("");
    try {
      await api.saveAiStyleKey(keyInput);
      setKeyInput(""); setConfigured(true);
    } catch (error) { setError(error instanceof Error ? error.message : "密钥保存失败"); }
    finally { setBusy(null); }
  };

  const removeKey = async () => {
    setBusy("key"); setError("");
    try { await api.deleteAiStyleKey(); setConfigured(false); setResult(undefined); }
    catch (error) { setError(error instanceof Error ? error.message : "密钥删除失败"); }
    finally { setBusy(null); }
  };

  const score = async () => {
    setBusy("score"); setError("");
    const submittedKey = documentKey;
    try { setResult(await api.scoreAiStyle(text)); setScoredKey(submittedKey); }
    catch (error) { setError(error instanceof Error ? error.message : "评分暂时失败"); }
    finally { setBusy(null); }
  };

  return <section className="ai-style-panel" aria-label="AI 味评分">
    <div className="ai-style-heading"><div><span>JEV · 文风检查</span><h3>AI 味评分</h3></div><Sparkles size={17} /></div>
    <p>检查空泛套话、模板结构、夸张断言和重复填充。评分只作审稿线索，不判断作者身份，也不改变草稿。</p>
    {configured === false ? <div className="ai-style-key-setup">
      <label htmlFor="draft-jev-api-key">TypeSafe API Key</label>
      <input id="draft-jev-api-key" type="password" autoComplete="off" value={keyInput} onChange={(event) => setKeyInput(event.target.value)} placeholder="粘贴 Jev API Key" />
      <button type="button" className="secondary-button" disabled={busy !== null || keyInput.trim().length < 20} onClick={() => void saveKey()}>验证并保存到本机</button>
      <small>密钥保存在当前用户的钥匙串或 Windows DPAPI。</small>
    </div> : null}
    {configured === true ? <div className="ai-style-actions">
      <button type="button" className="secondary-button" disabled={busy !== null || Array.from(text).length < 80} onClick={() => void score()}>
        {busy === "score" ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}
        {busy === "score" ? "正在评分…" : result ? "重新评分当前稿" : "给当前稿评分"}
      </button>
      <button type="button" className="text-button" disabled={busy !== null} onClick={() => void removeKey()}>移除密钥</button>
    </div> : configured === null ? <small>正在检查本机接口配置…</small> : null}
    {configured && Array.from(text).length < 80 ? <small>正文至少 80 字才能评分。</small> : null}
    {error ? <p className="ai-style-error" role="alert">{error}</p> : null}
    {stale ? <p className="ai-style-stale" role="status">正文或标题已修改，旧分数不再对应当前稿；请重新评分。</p> : null}
    {result && !stale ? <div className="ai-style-result">
      <div className="ai-style-overall"><strong>{result.score}<small>/100</small></strong><span>{bandLabel[result.band]}<small>分数越高，越值得检查</small></span></div>
      <div className="ai-style-dimensions">{result.dimensions.map((dimension) => <div key={dimension.id}>
        <div className="ai-style-dimension-head"><strong>{dimension.label}</strong><span>{dimension.score}</span></div>
        <div className="ai-style-meter"><span style={{ width: `${dimension.score}%` }} /></div>
        <p>{dimension.guidance}</p>
        <small>档位分布集中度 {dimension.confidence}%（非准确率）</small>
      </div>)}</div>
      <small>{result.model} · {result.characters} 字 · 文风问题评分，不是 AI 作者概率</small>
    </div> : null}
  </section>;
}
