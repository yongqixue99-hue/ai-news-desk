import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, RotateCcw, X, ArchiveRestore } from "lucide-react";
import { api } from "../api";
import type { ArticleDraft } from "../types";
import type { DraftLibrarySelection, DraftTrashSelection, TrashedDraftSummary } from "../../server/draft-library.js";

interface Props {
  drafts: ArticleDraft[];
  current?: ArticleDraft;
  selectedDrafts?: ArticleDraft[];
  disabled: boolean;
  onCreate: () => Promise<void>;
  onTrash: (selection: DraftLibrarySelection[]) => Promise<void>;
  onRestore: (id: string) => Promise<void>;
  onRestoreMany: (selection: DraftTrashSelection[]) => Promise<void>;
}

export function DraftLibraryActions({ drafts, current, selectedDrafts, disabled, onCreate, onTrash, onRestore, onRestoreMany }: Props) {
  const [panel, setPanel] = useState<"delete" | "clear" | "trash" | "restore">();
  const [selection, setSelection] = useState<DraftLibrarySelection[]>([]);
  const [selectedTitle, setSelectedTitle] = useState("");
  const [selectedTitles, setSelectedTitles] = useState<string[]>([]);
  const [trashSearch, setTrashSearch] = useState("");
  const [restoreSelection, setRestoreSelection] = useState<TrashedDraftSummary[]>([]);
  const [trash, setTrash] = useState<TrashedDraftSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const locked = useRef(false);
  const close = () => { if (!locked.current) setPanel(undefined); };

  useEffect(() => {
    if (panel) {
      dialog.current?.showModal();
      cancel.current?.focus();
    } else {
      dialog.current?.close();
      trigger.current?.focus();
    }
  }, [panel]);

  useEffect(() => {
    if (panel !== "trash") return;
    let active = true;
    setLoading(true);
    api.draftTrash().then(items => { if (active) setTrash(items); })
      .catch(err => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [panel]);

  const open = (next: typeof panel, items: ArticleDraft[] = []) => {
    trigger.current = document.activeElement as HTMLElement;
    setError(""); setNotice("");
    setSelection(items.map(({ id, updatedAt }) => ({ id, updatedAt })));
    setSelectedTitle(items[0]?.title || "未命名草稿");
    setSelectedTitles(items.map(item => item.title || "未命名草稿"));
    if (next === "trash") setTrashSearch("");
    setPanel(next);
  };
  const run = async (action: () => Promise<void>, success: string) => {
    if (locked.current) return;
    locked.current = true; setPending(true); setError(""); setNotice("");
    try { await action(); setNotice(success); setPanel(undefined); }
    catch (err) { setError(err instanceof Error ? err.message : "操作失败，请重试"); }
    finally { locked.current = false; setPending(false); }
  };

  const filteredTrash = trash.filter(item => (item.title || "未命名草稿").toLocaleLowerCase("zh-CN").includes(trashSearch.trim().toLocaleLowerCase("zh-CN")));
  const deleteTargets = selectedDrafts ?? (current ? [current] : []);
  return <>
    <div className="draft-management-bar" role="group" aria-label="草稿管理">
      <button className="primary-button" disabled={disabled || pending} onClick={() => void run(onCreate, "已新建空白草稿") }><Plus size={15} />新建草稿</button>
      <button className="secondary-button" disabled={disabled || pending || !deleteTargets.length} onClick={() => open("delete", deleteTargets)}><Trash2 size={14} />{selectedDrafts ? `删除选中 (${selectedDrafts.length})` : "删除当前草稿"}</button>
      <span className="draft-management-spacer" />
      <button className="draft-management-link" disabled={disabled || pending || !drafts.length} onClick={() => open("clear", drafts)}>清空草稿</button>
      <button className="draft-management-link" disabled={disabled || pending} onClick={() => open("trash")}><ArchiveRestore size={14} />回收站</button>
    </div>
    {!panel && (notice || error) ? <div className={`draft-management-notice ${error ? "error" : ""}`} role={error ? "alert" : "status"}>{error || notice}<button aria-label="关闭操作提示" onClick={() => { setError(""); setNotice(""); }}><X size={13} /></button></div> : null}
    <dialog ref={dialog} className="draft-management-dialog" aria-labelledby="draft-management-title" aria-describedby="draft-management-description" onCancel={event => { event.preventDefault(); close(); }}>
      <header><h2 id="draft-management-title">{panel === "trash" ? "草稿回收站" : panel === "restore" ? `恢复 ${restoreSelection.length} 篇草稿？` : panel === "clear" ? `清空 ${selection.length} 篇草稿？` : selection.length > 1 ? `删除选中的 ${selection.length} 篇草稿？` : "删除这篇草稿？"}</h2><button aria-label="关闭草稿管理弹窗" disabled={pending} onClick={close}><X size={18} /></button></header>
      <p id="draft-management-description">{panel === "trash" ? "删除的草稿保留在这里，可随时恢复正文、配图和版本记录。" : panel === "restore" ? "将恢复下列草稿及原有配图、版本和交付记录，其他回收站条目保持原样。" : panel === "clear" ? "草稿库中的所有草稿（含历史旧稿）将移入回收站。已同步到平台的草稿不受影响。" : selection.length > 1 ? "下列选中草稿将移入回收站，之后可以恢复。已同步到平台的草稿不受影响。" : `“${selectedTitle}”将移入回收站，之后可以恢复。已同步到平台的草稿不受影响。`}</p>
      {panel === "delete" && selection.length > 1 ? <ul className="draft-management-selection">{selectedTitles.map((title, index) => <li key={selection[index].id}>{title}</li>)}</ul> : null}
      {panel === "restore" ? <ul className="draft-management-selection">{restoreSelection.map(item => <li key={item.id}>{item.title || "未命名草稿"}</li>)}</ul> : null}
      {panel === "trash" ? <>
        <div className="draft-trash-tools"><input aria-label="搜索回收站" placeholder="搜索已删除的草稿" value={trashSearch} onChange={event => setTrashSearch(event.target.value)} /><button className="secondary-button" disabled={pending || disabled || loading || !filteredTrash.length} onClick={() => { setRestoreSelection(filteredTrash); setPanel("restore"); }}>恢复当前结果 ({filteredTrash.length})</button></div>
        <div className="draft-trash-list">
        {loading ? <p role="status">正在读取回收站…</p> : !filteredTrash.length && !error ? <p>{trash.length ? "没有匹配的草稿" : "回收站为空"}</p> : filteredTrash.map(item => <div className="draft-trash-row" key={item.id}>
          <div><strong>{item.title || "未命名草稿"}</strong><small>删除于 {new Date(item.deletedAt).toLocaleString("zh-CN", { hour12: false })}</small></div>
          <button className="secondary-button" disabled={pending || disabled} aria-label={`恢复 ${item.title || "未命名草稿"}`} onClick={() => void run(() => onRestore(item.id), "草稿已恢复并打开")}><RotateCcw size={14} />恢复</button>
        </div>)}
      </div></> : null}
      {error ? <p className="draft-management-error" role="alert">{error}</p> : null}
      <footer><button ref={cancel} className="secondary-button" disabled={pending} onClick={close}>{panel === "trash" ? "关闭" : "取消"}</button>
        {panel === "restore" ? <button className="primary-button" disabled={pending || disabled} onClick={() => void run(() => onRestoreMany(restoreSelection), `已恢复 ${restoreSelection.length} 篇草稿`)}>{pending ? "正在恢复…" : "确认恢复"}</button> : panel !== "trash" ? <button className="primary-button" disabled={pending || disabled} onClick={() => void run(() => onTrash(selection), `已将 ${selection.length} 篇草稿移入回收站`)}>{pending ? "正在处理…" : panel === "clear" ? "确认清空" : "确认删除"}</button> : null}
      </footer>
    </dialog>
  </>;
}
