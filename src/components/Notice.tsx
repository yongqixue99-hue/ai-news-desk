import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";

export type NoticeState = { kind: "info" | "success" | "error"; message: string } | null;

export function Notice({ notice, onClose }: { notice: NoticeState; onClose: () => void }) {
  if (!notice) return null;
  const Icon = notice.kind === "success" ? CheckCircle2 : notice.kind === "error" ? CircleAlert : Info;
  return (
    <div className={`notice ${notice.kind}`} role="status" aria-live={notice.kind === "error" ? "assertive" : "polite"}>
      <Icon size={18} />
      <span>{notice.message}</span>
      <button onClick={onClose} aria-label="关闭提示">
        <X size={16} />
      </button>
    </div>
  );
}
