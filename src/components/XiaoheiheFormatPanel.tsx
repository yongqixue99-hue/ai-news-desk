import { ArrowDown, ArrowUp, Check, FileText, Images } from "lucide-react";
import { imagePostCapacity } from "../../server/xiaoheihe-format.js";
import type { ArticleDraft } from "../types";

export function XiaoheiheFormatPanel({ draft, selectedIds, onChange, disabled }: { draft: ArticleDraft; selectedIds: string[]; onChange: (patch: Partial<ArticleDraft>) => void; disabled: boolean }) {
  const gallery = draft.contentFormat === "image-post";
  const setIds = (ids: string[]) => onChange({ imagePostImageIds: ids });
  const move = (index: number, offset: number) => {
    const ids = [...selectedIds];
    [ids[index], ids[index + offset]] = [ids[index + offset]!, ids[index]!];
    setIds(ids);
  };
  return <section className="utility-section xhh-format-panel">
    <h3>发送形式</h3>
    <div className="xhh-format-choice" role="group" aria-label="小黑盒发送形式">
      <button type="button" disabled={disabled} aria-pressed={!gallery} onClick={() => onChange({ contentFormat: "article" })}><FileText size={19} /><strong>文章</strong><small>正文穿插配图</small></button>
      <button type="button" disabled={disabled} aria-pressed={gallery} onClick={() => onChange({ contentFormat: "image-post", imagePostImageIds: draft.imagePostImageIds ?? selectedIds.slice(0, imagePostCapacity) })}><Images size={19} /><strong>图文</strong><small>图片滑动浏览</small></button>
    </div>
    <p className="xhh-format-hint">{gallery ? "按下方顺序上传图集，首图作为封面。正文转为纯文字；文章中的配图位置会保留，方便切回。" : "保留正文排版与配图位置。点击填入后自动保存、检查并填写分区与话题。"}</p>
    {gallery ? <><div className="xhh-gallery-heading"><strong>图集 {selectedIds.length} / {imagePostCapacity}</strong><small>工作台容量</small></div>
      <div className="xhh-gallery-order">{selectedIds.map((id, index) => { const placement = draft.images.find(image => image.id === id); return <div key={id}>
        <span>{index === 0 ? "封面" : index + 1}</span><span>{placement?.caption || placement?.image.caption || "图片"}</span>
        <button type="button" aria-label={`图片 ${index + 1} 上移`} disabled={disabled || index === 0} onClick={() => move(index, -1)}><ArrowUp size={13} /></button><button type="button" aria-label={`图片 ${index + 1} 下移`} disabled={disabled || index === selectedIds.length - 1} onClick={() => move(index, 1)}><ArrowDown size={13} /></button>
      </div>; })}</div>
      <div className="xhh-gallery-picker">{draft.images.map(placement => { const index = selectedIds.indexOf(placement.id); return <button type="button" key={placement.id} aria-label={`${index >= 0 ? "移出" : "加入"}图集：${placement.caption || placement.image.caption}`} aria-pressed={index >= 0} disabled={disabled || (index < 0 && selectedIds.length >= imagePostCapacity)} onClick={() => setIds(index >= 0 ? selectedIds.filter(id => id !== placement.id) : [...selectedIds, placement.id])}>
        <img src={placement.image.publicPath || placement.image.url} alt={placement.caption || placement.image.caption} loading="lazy" /><span>{index >= 0 ? <><Check size={12} />{index + 1}</> : "选择"}</span>
      </button>; })}</div>
      {!draft.images.length ? <p className="xhh-format-hint">请先在配图面板加入原图或截图。</p> : null}
    </> : null}
  </section>;
}
