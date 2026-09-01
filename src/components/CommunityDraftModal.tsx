import { useRef, useState } from "react";
import {
  BookOpenText,
  Newspaper,
  Check,
  FileText,
  Image as ImageIcon,
  Languages,
  Layers3,
  LoaderCircle,
  ShieldAlert,
  X,
} from "lucide-react";
import { useDialogA11y } from "../hooks/useDialogA11y";
import type { AiProviderConfig, Candidate } from "../types";

export type CommunityDraftMode = "article" | "source" | "translation" | "curation";

interface CommunityDraftModalProps {
  candidate: Candidate;
  provider: AiProviderConfig;
  onClose: () => void;
  onCreate: (candidateId: string, mode: CommunityDraftMode) => Promise<void>;
}

const options: Array<{
  mode: CommunityDraftMode;
  label: string;
  description: string;
  icon: typeof FileText;
}> = [
  {
    mode: "article",
    label: "先读来源，再写新闻",
    description: "以关联文章、项目或公告为事实主干；社区只作补充，少量评论不会撑成正文。",
    icon: Newspaper,
  },
  {
    mode: "source",
    label: "导入私有原文素材",
    description: "不经过模型改写，保留讨论顺序供你编辑；不代表可以整篇转载发布。",
    icon: FileText,
  },
  {
    mode: "translation",
    label: "忠实翻译素材",
    description: "逐块翻译，保持段落顺序、数字、专名和限定条件，适合你继续专项修改。",
    icon: Languages,
  },
  {
    mode: "curation",
    label: "社区观点素材包",
    description: "只有你明确想研究讨论本身时再用，整理观点与原句，不冒充新闻稿。",
    icon: Layers3,
  },
];

export function CommunityDraftModal({
  candidate,
  provider,
  onClose,
  onCreate,
}: CommunityDraftModalProps) {
  const hasLinkedSource = Boolean(candidate.engagement?.discussionUrl
    && candidate.engagement.discussionUrl !== candidate.url);
  const [mode, setMode] = useState<CommunityDraftMode>(hasLinkedSource ? "article" : "curation");
  const [busy, setBusy] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogA11y<HTMLElement>({
    open: true,
    onClose: busy ? undefined : onClose,
    initialFocusRef: closeButtonRef,
  });

  const submit = async () => {
    setBusy(true);
    try {
      await onCreate(candidate.id, mode);
      onClose();
    } catch {
      // The parent notice contains the actionable API error.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop quick-draft-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="quick-draft-modal community-draft-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="community-draft-title"
        aria-describedby="community-draft-description"
      >
        <header>
          <span className="quick-draft-icon"><BookOpenText size={20} /></span>
          <div>
            <h2 id="community-draft-title">这条热点要怎么处理</h2>
            <p id="community-draft-description">有独立来源时先把新闻讲清；只有你明确选择时，才把社区讨论整理成素材。</p>
          </div>
          <button ref={closeButtonRef} className="modal-close" aria-label="关闭" disabled={busy} onClick={onClose}><X size={17} /></button>
        </header>

        <div className="community-draft-source">
          <strong>{candidate.briefing?.titleZh || candidate.title}</strong>
          <span>{candidate.sourceName} · {candidate.imageCount && candidate.imageCount > 0
            ? `${candidate.imageCount} 张已预读图片，入稿时重新扫描`
            : "入稿时重新扫描正文与来源图片"}</span>
        </div>

        <div className="community-draft-options" role="radiogroup" aria-label="社区入稿方式">
          {options.filter((option) => option.mode !== "article" || hasLinkedSource).map((option) => {
            const Icon = option.icon;
            const selected = mode === option.mode;
            return (
              <button
                key={option.mode}
                type="button"
                role="radio"
                aria-checked={selected}
                className={selected ? "selected" : ""}
                disabled={busy}
                onClick={() => setMode(option.mode)}
              >
                <span className="community-mode-icon"><Icon size={18} /></span>
                <span><strong>{option.label}</strong><small>{option.description}</small></span>
                <span className="community-mode-check">{selected ? <Check size={13} /> : null}</span>
              </button>
            );
          })}
        </div>

        <div className="community-draft-notes">
          <p><ImageIcon size={15} /><span>图片优先使用关联原文；原图链接不足且图片策略允许截图时，会自动截取来源页面中的有效图片或首屏作为兜底。</span></p>
          <p><ShieldAlert size={15} /><span>原文、译文和图片都会标记“发布前需核权”。放进草稿箱不等于获得转载许可，也不会自动发布。</span></p>
        </div>

        <footer>
          <span>{mode === "source" ? "原文模式不调用模型" : `本次使用 ${provider.name} · ${provider.model}`}</span>
          <div>
            <button className="secondary-button" disabled={busy} onClick={onClose}>取消</button>
            <button className="primary-button" disabled={busy} onClick={() => void submit()}>
              {busy ? <LoaderCircle className="spin" size={15} /> : null}
              {busy ? "正在读取正文与图片" : mode === "article" ? "读取来源并生成新闻稿" : "放入草稿箱"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
