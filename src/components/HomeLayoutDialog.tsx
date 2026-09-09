import { useState } from "react";
import { ArrowDown, ArrowUp, Check, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { api } from "../api";
import { defaultHomeLayout, type HomeLayout, type HomeSource } from "../../server/home-layout.js";
import { useDialogA11y } from "../hooks/useDialogA11y";

export function HomeLayoutDialog({ initial, onClose, onSaved }: { initial: HomeLayout; onClose: () => void; onSaved: (layout: HomeLayout) => void }) {
  const [layout, setLayout] = useState(() => structuredClone(initial));
  const [name, setName] = useState("");
  const [source, setSource] = useState<HomeSource>("news");
  const [keyword, setKeyword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const ref = useDialogA11y({ open: true, onClose: () => { if (!busy) onClose(); } });
  const move = (index: number, direction: number) => setLayout((current) => {
    const columns = [...current.columns]; [columns[index], columns[index + direction]] = [columns[index + direction]!, columns[index]!];
    return { ...current, columns };
  });
  const add = () => {
    const label = name.trim();
    if (!label || layout.columns.length >= 12) return;
    setLayout((current) => ({ ...current, columns: [...current.columns, { id: `custom-${crypto.randomUUID()}`, label, source, keyword: keyword.trim() || undefined }] }));
    setName(""); setKeyword("");
  };
  const save = async () => {
    setBusy(true); setError(undefined);
    try { onSaved(await api.saveHomeLayout(layout)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "栏目设置未保存，请重试。"); }
    finally { setBusy(false); }
  };
  return <div className="home-layout-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="home-layout-dialog" role="dialog" aria-modal="true" aria-labelledby="home-layout-title" tabIndex={-1} ref={ref}>
      <header><div><span className="desk-eyebrow">我的首页</span><h2 id="home-layout-title">自定义栏目</h2></div><button type="button" className="home-icon-button" aria-label="关闭栏目设置" disabled={busy} onClick={onClose}><X size={20} /></button></header>
      <div className="home-layout-body"><p className="home-dialog-hint">调整顺序，保留常看的来源；也可以按关键词建立关注栏目。</p>
        <ol className="home-column-settings">{layout.columns.map((column, index) => <li key={column.id}>
          <span className="home-column-number">{String(index + 1).padStart(2, "0")}</span>
          <div><strong>{column.label}</strong><small>{defaultHomeLayout.columns.find((item) => item.source === column.source)?.label}{column.keyword ? ` · ${column.keyword}` : ""}</small></div>
          <button type="button" className="home-icon-button" aria-label={`上移 ${column.label}`} disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} /></button>
          <button type="button" className="home-icon-button" aria-label={`下移 ${column.label}`} disabled={busy || index === layout.columns.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></button>
          <button type="button" className="home-icon-button" aria-label={`移除 ${column.label}`} disabled={busy || layout.columns.length === 1} onClick={() => setLayout((current) => ({ ...current, columns: current.columns.filter((item) => item.id !== column.id) }))}><Trash2 size={15} /></button>
        </li>)}</ol>
        <div className="home-available-columns">{defaultHomeLayout.columns.filter((preset) => !layout.columns.some((column) => column.id === preset.id)).map((preset) => <button type="button" key={preset.id} disabled={busy || layout.columns.length >= 12} onClick={() => setLayout((current) => ({ ...current, columns: [...current.columns, { ...preset }] }))}><Plus size={13} />添加{preset.label}</button>)}</div>
        <div className="home-new-column"><h3>添加关注栏目</h3><div className="home-new-column-fields">
          <label>栏目名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：AI 编程" maxLength={24} disabled={busy} /></label>
          <label>内容来源<select value={source} disabled={busy} onChange={(event) => setSource(event.target.value as HomeSource)}>{defaultHomeLayout.columns.map((preset) => <option key={preset.source} value={preset.source}>{preset.label}</option>)}</select></label>
          <label>关键词<input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="选填，例如 Codex" maxLength={120} disabled={busy} /></label>
        </div><div className="home-new-column-footer"><small>筛选已有内容；添加栏目不会自动启用新来源或调用 AI。</small><button type="button" className="secondary-button" disabled={busy || !name.trim() || layout.columns.length >= 12} onClick={add}><Plus size={14} />添加栏目</button></div></div>
        <label className="home-drafts-toggle"><span><strong>显示“继续写作”</strong><small>在右侧保留最近编辑的一篇稿件</small></span><input type="checkbox" checked={layout.showDrafts} disabled={busy} onChange={(event) => setLayout((current) => ({ ...current, showDrafts: event.target.checked }))} /></label>
        {error ? <p className="home-layout-error" role="alert">{error}</p> : null}
      </div>
      <footer><button type="button" className="text-button" disabled={busy} onClick={() => setLayout(structuredClone(defaultHomeLayout))}><RotateCcw size={14} />恢复默认</button><button type="button" className="primary-button" disabled={busy} onClick={() => void save()}><Check size={15} />{busy ? "保存中…" : "保存设置"}</button></footer>
    </section>
  </div>;
}
