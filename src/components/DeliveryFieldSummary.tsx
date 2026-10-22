import type { DeliveryFieldChecks } from "../../server/delivery-verification";

export function DeliveryFieldSummary({ checks }: { checks?: DeliveryFieldChecks }) {
  if (!checks) return null;
  const matched = checks.fields.filter(field => field.status === "matched").length;
  const different = checks.fields.filter(field => field.status === "different").length;
  return <details className="delivery-field-checks"><summary>{different ? `${different} 项与发送设置不同` : matched === checks.fields.length ? `已核对 ${matched} 项` : `字段核对 ${matched}/${checks.fields.length}`}</summary>
    <ul>{checks.fields.map(field => <li key={field.key} data-status={field.status}><span>{field.label}</span><span>{{ matched: "一致", different: "不一致", unobserved: "尚未回读" }[field.status]}</span></li>)}</ul>
    <small>{checks.source === "editor-readback" ? "编辑页核对" : checks.source === "remote-draft" ? "草稿回读" : "助手存稿回执"} · {checks.adapterVersion}</small>
  </details>;
}
