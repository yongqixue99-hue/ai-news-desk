import type { Candidate } from "./types.js";

export interface EditorialOpportunity {
  lane: "important" | "interesting" | "routine";
  label: string;
  reason: string;
}

const promotion = /\b(?:webinar|(?:co)?workshop|register now|join us|sponsorship|sponsored|limited.time offer)\b|\[推广\]|注册送|报名|活动预告|限时优惠/iu;
const digest = /\b(?:(?:weekly|monthly|daily) (?:roundup|recap|digest|summary)|newsletter|this (?:week|month) in|look back|this month's)\b|(?:本月|每月|每周|本周|每日).{0,10}(?:汇总|回顾|简报)|\b(?:news|updates).{0,45}\b(?:in|from) (?:January|February|March|April|May|June|July|August|September|October|November|December)\b|早报|晚报/iu;
const minor = /\b(?:nightly|canary|(?:cli|sdk|api client).{0,45}(?:release notes|patch|log formatting|typo|v?\d+\.\d+\.\d+)|documentation typo)\b|小版本更新|终端颜色|文档错字/iu;
const roundup = /^(?:the download:|roundup:|this week in)|\bbest .{0,35}deals\b/iu;
const speculation = /\b(?:rumou?r|reportedly|may launch|could launch)\b|传闻|据传|或将发布/iu;
const speculativeLeak = (title: string) => /\bleaked?\b/iu.test(title)
  && !/\b(?:data breach|user data|api keys|credentials|vulnerability|security flaw)\b|数据泄露|漏洞/iu.test(title);
const concreteChange = /\b(?:announc(?:es|ed|ing)|ships?|releases?|released|launch(?:es|ed)?|introduc(?:ed|es|ing)|unveils?|cuts?|reduces?|raises?|opens?|open-sources?|bans?|approves?|patch(?:es|ed)?)\b|发布|推出|上线|开放|开源|降价|涨价|下调|上调|修复|禁止|获批/iu;
const consequentialSubject = /\b(?:models?|gpt[\s-]*\d|claude|gemini|deepseek|qwen|chatgpt|agents?|protocol|api|product|pricing|prices?|chip|gpu|weights?|software|security|vulnerability|regulation)\b|模型|芯片|显卡|价格|漏洞|安全|监管|软件|推理|权重/iu;
const directImpact = /\b(?:data breach|outage|downtime|locked out|buys?|merger|zero-day|security flaw|price cut|price increase|recall|layoffs?|acqui(?:res|sition))\b|数据泄露|服务中断|零日漏洞|价格调整|召回|裁员|收购/iu;
const usefulOrInteresting = /\b(?:show hn:|set up|guide to|integrating|formalizing|measured|reviewed|how (?:to|i|we)|built|build(?:ing)?|port(?:ing|ed)?|recreat(?:ed|ing)|reconstruct|demo|experiment|benchmark|hands-on|tested|tutorial|open-source|local inference|offline)\b|分享创造|实测|测评|复现|重建|移植|教程|实验|做了|制作|本地运行|离线|开源项目|动手/iu;

/** A transparent triage heuristic, not a prediction of views or a factual score. */
export const normalizeEditorialText = (text: string) => text.normalize("NFKC").replace(/[‐‑‒–—−]/gu, "-");

export const editorialExclusionFor = (input: string) => {
  const title = normalizeEditorialText(input);
  if (promotion.test(title)) return "promotion";
  if (digest.test(title) || roundup.test(title)) return "digest";
  // A security fix can be consequential even when shipped in a small release.
  if (minor.test(title) && !/\b(?:security|vulnerability|cve-\d{4}-\d{4,}|zero-day)\b|漏洞|安全/iu.test(title)) return "minor";
  if (speculation.test(title) || speculativeLeak(title)) return "rumor";
  return undefined;
};

export const mayShareEditorialEvent = (left: string, right: string) => editorialExclusionFor(left) === editorialExclusionFor(right);

export const hasAnnouncementLead = (excerpt: string) => {
  const lead = normalizeEditorialText(excerpt).slice(0, 360).split(/(?<=[.!?。！？])\s/u)[0] ?? "";
  return concreteChange.test(lead) && consequentialSubject.test(lead)
    && !speculation.test(lead) && !speculativeLeak(lead) && !/\b(?:not|no new|previously|last (?:week|month|year))\b|没有发布|此前|上个月|去年/iu.test(lead);
};

export const assessEditorialOpportunity = (input: string, excerpt = "", options: { official?: boolean } = {}): EditorialOpportunity => {
  const title = normalizeEditorialText(input);
  const excluded = editorialExclusionFor(title);
  if (excluded === "rumor") return { lane: "routine", label: "待核实线索", reason: "原题带传闻或未确认发布，先等待直接证据。" };
  if (excluded) return { lane: "routine", label: "常规动态", reason: "活动、汇总或例行更新，默认放到全部候选。" };
  if (/^Show HN:|分享创造/iu.test(title)) return { lane: "interesting", label: "有趣 / 有用", reason: "作者展示了具体项目，可回到原文核对功能与实践过程。" };
  if (directImpact.test(title)) return { lane: "important", label: "重要进展", reason: "涉及服务、安全、成本或产业变化，适合核对对读者的影响。" };
  if (concreteChange.test(title) && consequentialSubject.test(`${title} ${excerpt}`)) {
    return { lane: "important", label: "重要进展", reason: "有明确的产品、成本或使用条件变化，适合核对对读者的影响。" };
  }
  if (options.official && hasAnnouncementLead(excerpt)) return { lane: "important", label: "官方进展", reason: "官方原始摘要描述了明确变化，正文与可用范围仍需核对。" };
  if (options.official && /\b(?:published research|research on|experiments?|red teaming)\b|研究成果|实验结果/iu.test(excerpt)
    && /\b(?:jailbreaks?|classifiers?|safety|security|reasoning|model)\b|安全|模型|推理/iu.test(`${title} ${excerpt}`)) {
    return { lane: "interesting", label: "研究 / 实验", reason: "官方研究给出了具体方法或实验，适合核对结论与适用限制。" };
  }
  if (usefulOrInteresting.test(title)) return { lane: "interesting", label: "有趣 / 有用", reason: "有具体实践、测试或可展示的项目，热度未知时也值得选题。" };
  return { lane: "routine", label: "常规动态", reason: "暂未识别到明确变化或具体案例，可在全部候选中补看。" };
};

export const candidateOpportunity = (candidate: Pick<Candidate, "title" | "excerpt">) =>
  assessEditorialOpportunity(candidate.title, candidate.excerpt);

export const opportunityPriority = (opportunity: EditorialOpportunity) =>
  opportunity.lane === "important" ? 24 : opportunity.lane === "interesting" ? 12 : -20;
