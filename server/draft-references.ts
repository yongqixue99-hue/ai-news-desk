import type { ArticleDraft, DraftReference } from "./types.js";

export const referenceUrl = (input: string): string => {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error("请粘贴完整的网页链接"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("资料链接只支持不含账号密码的 HTTP 或 HTTPS 网页");
  return url.href;
};

const referenceKey = (reference: DraftReference) => {
  if (reference.kind === "link") return `link:${reference.url}`;
  if (reference.kind === "screenshot") return `screenshot:${reference.imagePlacementId}`;
  return `note:${reference.text}`;
};

/** Validate the editable material tray; it never writes facts or article text. */
export const normalizeDraftReferences = (input: unknown, images: ArticleDraft["images"]): DraftReference[] => {
  if (!Array.isArray(input) || input.length > 100) throw new Error("每篇最多保留 100 条资料");
  const ids = new Set<string>(), keys = new Set<string>();
  const result: DraftReference[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object" || !["link", "note", "screenshot"].includes(item.kind)
      || typeof item.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/u.test(item.id)
      || ids.has(item.id) || typeof item.title !== "string" || item.title.length > 500
      || typeof item.capturedAt !== "string" || !Number.isFinite(Date.parse(item.capturedAt))) throw new Error("资料格式无效，请重新添加");
    for (const [field, limit] of [["text", 100_000], ["author", 500]] as const) {
      if (item[field] !== undefined && (typeof item[field] !== "string" || item[field].length > limit)) throw new Error("资料文字过长或格式无效");
    }
    const reference: DraftReference = {
      id: item.id, kind: item.kind, title: item.title.trim(), capturedAt: item.capturedAt,
      ...(item.text !== undefined ? { text: item.text } : {}), ...(item.author ? { author: item.author } : {}),
    };
    if (item.kind === "link") {
      if (typeof item.url !== "string" || item.url.length > 4_096) throw new Error("资料链接无效");
      reference.url = referenceUrl(item.url);
      reference.title ||= new URL(reference.url).hostname;
      reference.readStatus = ["read", "unavailable"].includes(item.readStatus) ? item.readStatus : "saved";
    }
    if (item.kind === "note" && !reference.text?.trim()) throw new Error("请先填写资料文字");
    if (item.kind === "screenshot") {
      if (typeof item.imagePlacementId !== "string" || !images.some(image => image.id === item.imagePlacementId)) throw new Error("截图不属于当前稿件，请重新添加");
      reference.imagePlacementId = item.imagePlacementId;
    }
    const key = referenceKey(reference);
    ids.add(reference.id);
    if (!keys.has(key)) { result.push(reference); keys.add(key); }
  }
  return result;
};

export const addDraftReference = (draft: ArticleDraft, reference: DraftReference): ArticleDraft => ({
  ...draft, references: normalizeDraftReferences([...(draft.references ?? []), reference], draft.images),
});
