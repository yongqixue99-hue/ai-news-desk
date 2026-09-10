import { useState } from "react";
import { ArrowLeft, ArrowRight, Download, ExternalLink, Image as ImageIcon, RefreshCw } from "lucide-react";
import type { ImageCollectionReport, SourceImage } from "../types";

const imageKind = (image: SourceImage) => image.captureKind === "table" ? "评测表格" : image.captureKind === "chart" ? "图表截图"
  : image.editorialOrigin === "article-screenshot" || /screenshot/.test(image.rights) ? "原文截图" : "原文图片";

export function StoryAssetGallery({ images, localCount, publishReadyCount, reports, busy, onCollect }: {
  images: SourceImage[]; localCount: number; publishReadyCount: number; busy: boolean; onCollect: () => void;
  reports?: ImageCollectionReport[];
}) {
  const [zoomed, setZoomed] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [failedUrl, setFailedUrl] = useState<string>();
  const selected = images.find((image) => image.id === selectedId) ?? images[0];
  const index = selected ? images.indexOf(selected) : 0;
  const previewUrl = selected?.publicPath || selected?.url;
  return <section className="story-asset-library" aria-label="原文图片与图表">
    <div className="asset-library-heading"><div><span className="asset-eyebrow">SOURCE MATERIALS</span><h3>让原文的图，也跟着文章走。</h3><p>收集正文配图、能力图表与评测表格，保留来源和清晰原图。</p></div>
      <button className="secondary-button" type="button" onClick={onCollect} disabled={busy}>{busy ? <RefreshCw className="spin" size={16} /> : <Download size={16} />} {busy ? "正在收集原文素材" : "收集原文图片与图表"}</button>
    </div>
    <div className="asset-inventory"><span><strong>{images.length}</strong> 已发现</span><span><strong>{localCount}</strong> 已保存到本地</span><span><strong>{publishReadyCount}</strong> 权利检查通过</span><small>本地图片可带入私人草稿；公开使用前单独核权。</small></div>
    {reports?.some((report) => report.status !== "checked") ? <div className="asset-collection-notes" role="status">{reports.filter((report) => report.status !== "checked").map((report) => <p key={report.url}><strong>{report.status === "unavailable" ? "这篇原文暂时无法读取" : "这篇原文仍有素材缺口"}</strong><span>{report.detail}</span><a href={report.url} target="_blank" rel="noreferrer">打开来源核对 <ExternalLink size={12} /></a></p>)}</div> : null}
    {selected ? <>
      <div className="asset-preview-layout">
        <div className={`asset-preview-stage${zoomed ? " zoomed" : ""}`}>
          {previewUrl && failedUrl !== previewUrl ? <img key={previewUrl} src={previewUrl} alt={selected.caption || imageKind(selected)} onError={() => setFailedUrl(previewUrl)} />
            : <div className="asset-preview-failed"><ImageIcon size={30} /><strong>图片暂时无法预览</strong><span>仍保留原文链接，可以打开来源核对。</span></div>}
        </div>
        <div className="asset-preview-info"><span className="asset-kind">{imageKind(selected)}</span><h4>{selected.caption || "来源配图"}</h4>
          <dl><div><dt>来自</dt><dd>{selected.attribution || "来源待核对"}</dd></div><div><dt>保存状态</dt><dd>{selected.localPath && selected.publicPath ? "已保存在本地" : "仅有原链接 · 等待下载"}</dd></div>
          {selected.width && selected.height ? <div><dt>尺寸</dt><dd>{selected.width} × {selected.height}</dd></div> : null}
          <div><dt>案例关系</dt><dd>{selected.evidenceNote || (selected.entityTags?.length ? `相关实体：${selected.entityTags.join("、")}；具体实验条件待核对` : "未单独记录具体案例，需对照来源与图注")}</dd></div>
          <div><dt>使用权</dt><dd>{selected.rights === "owned" ? "自有素材" : selected.rights === "licensed" ? "已记录授权，交付时复核" : selected.rights === "expired" ? "授权已过期" : "发布前待确认"}</dd></div><div><dt>允许平台</dt><dd>{selected.allowedPlatforms?.join("、") || "尚未记录"}</dd></div></dl>
          <button className="secondary-button" aria-pressed={zoomed} onClick={() => setZoomed(!zoomed)}>{zoomed ? "适应窗口" : "放大图片"}</button>
          <a className="text-button" href={selected.originalImageUrl || previewUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />查看完整图片</a>
          <a className="text-button" href={selected.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />打开原文出处</a>
          {selected.publicPath ? <a className="text-button" href={selected.publicPath} download><Download size={14} />下载本地图片</a> : null}
          <div className="asset-preview-controls"><button type="button" aria-label="上一张图片" disabled={index === 0} onClick={() => setSelectedId(images[index - 1]?.id)}><ArrowLeft size={17} /></button><span>{index + 1} / {images.length}</span><button type="button" aria-label="下一张图片" disabled={index === images.length - 1} onClick={() => setSelectedId(images[index + 1]?.id)}><ArrowRight size={17} /></button></div>
        </div>
      </div>
      <div className="asset-contact-sheet" aria-label="选择预览图片">{images.map((image, i) => <button type="button" key={`${image.id}:${image.sourceUrl}`} aria-pressed={image === selected} aria-label={`预览第 ${i + 1} 张：${image.caption || imageKind(image)}`} onClick={() => setSelectedId(image.id)}><img src={image.publicPath || image.url} alt="" loading="lazy" /><span>{String(i + 1).padStart(2, "0")} · {imageKind(image)}</span></button>)}</div>
    </> : <div className="asset-library-empty"><ImageIcon size={36} /><h4>还没有读取这篇文章的正文素材</h4><p>收集会保留原图链接，并尝试截取可见图表。无法访问的页面会保留缺口。</p></div>}
  </section>;
}
