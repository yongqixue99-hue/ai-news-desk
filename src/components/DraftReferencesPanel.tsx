import { useRef, useState } from "react";
import { ExternalLink, ImagePlus, LoaderCircle, Plus, X } from "lucide-react";
import type { ArticleDraft, DraftReference } from "../../server/types";

interface Props {
  draft: ArticleDraft;
  onAdd: (input: string) => void;
  onUpload: (file: File) => Promise<void>;
  onRead: (reference: DraftReference) => Promise<void>;
  onRemove: (id: string) => void;
  reading: string[];
}

export function DraftReferencesPanel({ draft, onAdd, onUpload, onRead, onRemove, reading }: Props) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const add = () => {
    try { onAdd(input); setInput(""); setError(""); }
    catch (error) { setError(error instanceof Error ? error.message : "添加失败"); }
  };
  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true); setError("");
    try { await onUpload(file); }
    catch (error) { setError(error instanceof Error ? error.message : "截图添加失败"); }
    finally { setUploading(false); }
  };
  return <section className="draft-references" aria-label="写作资料">
    <div className="inspector-heading"><h3>写作资料</h3><span>{draft.references?.length ?? 0} 条</span></div>
    <p className="reference-hint">放在手边，边看边写。资料不会自动进入正文。</p>
    <div className="reference-input" onDragOver={event => event.preventDefault()} onDrop={event => {
      event.preventDefault(); void upload(event.dataTransfer.files[0]);
    }}>
      <textarea aria-label="链接或资料文字" placeholder="粘贴链接、资料文字或截图…" value={input} onChange={event => setInput(event.target.value)}
        onPaste={event => { const file = [...event.clipboardData.items].find(item => item.type.startsWith("image/"))?.getAsFile(); if (file) { event.preventDefault(); void upload(file); } }}
        onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && input.trim()) { event.preventDefault(); add(); } }} />
      <div className="reference-input-actions">
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择资料截图" hidden onChange={event => { void upload(event.target.files?.[0]); event.target.value = ""; }} />
        <button type="button" disabled={uploading} onClick={() => fileInput.current?.click()}>{uploading ? <LoaderCircle size={14} className="spin" /> : <ImagePlus size={14} />}添加截图</button>
        <button type="button" className="primary-button" disabled={!input.trim()} onClick={add}><Plus size={14} />加入资料</button>
      </div>
    </div>
    {error ? <p role="alert" className="reference-error">{error}</p> : null}
    <div className="reference-list">{(draft.references ?? []).map(reference => {
      const image = draft.images.find(image => image.id === reference.imagePlacementId)?.image;
      return <article className="reference-item" key={reference.id}>
        <div className="reference-item-heading"><strong>{reference.title}</strong><button type="button" aria-label={`移除资料：${reference.title}`} onClick={() => onRemove(reference.id)}><X size={14} /></button></div>
        {reference.url ? <a href={reference.url} target="_blank" rel="noreferrer">{new URL(reference.url).hostname}<ExternalLink size={12} /></a> : null}
        {reference.author ? <small>作者：{reference.author}</small> : null}
        {image?.publicPath ? <a href={image.publicPath} target="_blank" rel="noreferrer"><img src={image.publicPath} alt={reference.title} /></a> : null}
        {reference.text ? <details open={reference.kind === "note"}><summary>{reference.kind === "note" ? "资料文字" : "查看原文摘录"}</summary><div className="reference-text">{reference.text}</div></details> : null}
        {reference.kind === "link" && reference.readStatus !== "read" ? <div className="reference-read-state">
          <small>{reading.includes(reference.id) ? "正在读取原文，正文可以继续编辑" : reference.readStatus === "unavailable" ? "原文暂不可读，链接已保留" : "链接已保存"}</small>
          {!reading.includes(reference.id) ? <button type="button" onClick={() => void onRead(reference)}>读取原文</button> : null}
        </div> : null}
      </article>;
    })}</div>
  </section>;
}
