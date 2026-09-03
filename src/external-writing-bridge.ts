import type { ArticleDraft, DraftFactClaim } from "../server/types.js";

const cleanHtmlText = (html: string) => html
  .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/giu, "")
  .replace(/<img\b[^>]*>/giu, "")
  .replace(/<br\s*\/?>/giu, "\n")
  .replace(/<\/(?:p|h[1-6]|li|blockquote|div)>/giu, "\n")
  .replace(/<[^>]+>/gu, "")
  .replaceAll("&nbsp;", " ")
  .replaceAll("&amp;", "&")
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">")
  .replaceAll("&quot;", '"')
  .replace(/\n{3,}/gu, "\n\n")
  .trim();

const claimLabel = (claim: DraftFactClaim) => {
  if (claim.status === "full-source") return "完整原文支持，可写成事实";
  if (claim.status === "cross-confirmed") return "多源交叉确认，可写成事实";
  if (claim.status === "excerpt-only") return "仅摘要支持，必须保守表述并提醒复核";
  if (claim.status === "inference") return "推断，不可写成事实";
  return "未核验，不可写成事实";
};

export const buildExternalWritingPrompt = (draft: ArticleDraft) => {
  const body = draft.bodyHtml?.trim()
    ? cleanHtmlText(draft.bodyHtml)
    : [...draft.paragraphs, draft.take].filter(Boolean).join("\n\n");
  const facts = (draft.factClaims ?? []).length
    ? draft.factClaims!.map((claim, index) => [
        `${index + 1}. ${claim.claim} [${claimLabel(claim)}]`,
        claim.sourceUrl ? `   来源：${claim.sourceUrl}` : "   来源：未记录",
        claim.sourceExcerpt ? `   原文片段：${claim.sourceExcerpt}` : "",
        claim.note ? `   备注：${claim.note}` : "",
      ].filter(Boolean).join("\n")).join("\n")
    : "（当前没有结构化事实账本；不得补写外部事实，只能整理现有草稿。）";
  const sources = draft.sources.length
    ? draft.sources.map((source, index) => `${index + 1}. ${source.label}｜${source.verified ? "已核验" : "待核验"}｜${source.url}`).join("\n")
    : "（无）";
  const uncertainties = draft.uncertainties.length
    ? draft.uncertainties.map((item) => `- ${item}`).join("\n")
    : "- 暂无已记录未知项；但这不代表可以自行补充事实。";
  const angles = draft.writingBrief?.suggestedAngles?.length
    ? draft.writingBrief.suggestedAngles.map((item) => `- ${item}`).join("\n")
    : "- 清楚解释事件、机制、影响与局限；没有证据的部分不要硬凑。";

  return [
    "你是中文 AI 科技文章的协作编辑。请只使用下面的事实账本、来源清单和当前草稿，不得凭常识、记忆或联网搜索自行补事实。",
    "",
    "写作要求：",
    "1. 保持自然、具体、像人写的中文；删除空泛结论和重复段落。",
    "2. 只有标为“可写成事实”的内容可以确定陈述；摘要支持的内容必须降格表述；推断或未核验内容不可写成事实。",
    "3. 遇到信息缺口，请保留【待核对：具体缺什么】；不要猜数字、日期、价格、跑分、人物身份或引语。",
    "4. 不要虚构图片、图注、来源或社区共识，不要改变链接。",
    "5. 只返回“标题：……”和可直接粘贴的完整正文，不要解释你的修改过程。",
    "",
    "【事实账本】",
    facts,
    "",
    "【来源清单】",
    sources,
    "",
    "【仍不确定】",
    uncertainties,
    "",
    "【可选写作角度】",
    angles,
    "",
    "【当前标题】",
    draft.title,
    "",
    "【当前正文】",
    body || "（正文为空，请依据事实账本起草。）",
  ].join("\n");
};
