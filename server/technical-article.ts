import type { SourceRole } from "./types.js";
import type { Candidate, ExtractedPage } from "./types.js";
import { hasOfficialUpdateAnchor } from "./official-update-url.js";

export const applyTechnicalSourceMetadata = (candidate: Candidate, page: ExtractedPage) => {
  if (!candidate.technicalArticle) return;
  candidate.technicalArticle = technicalArticlePolicy({ url: candidate.url, title: candidate.title, excerpt: page.text, sourceRole: candidate.sourceRole }) ?? candidate.technicalArticle;
  const published = Date.parse(page.publishedAt || "");
  if (Number.isFinite(published) && published <= Date.now()) {
    candidate.publishedAt = new Date(published).toISOString();
    candidate.publicationDateKnown = true;
  }
};

export interface TechnicalArticlePolicy {
  complexity: "introductory" | "intermediate" | "advanced";
  adaptation: "faithful" | "explained";
  label: string;
  reason: string;
  priorityAdjustment: number;
}

/** Editorial treatment, never a factual score or an assertion that code was tested. */
export const technicalArticlePolicy = (input: { url: string; title: string; excerpt?: string; sourceRole?: SourceRole }): TechnicalArticlePolicy | undefined => {
  let url: URL;
  try { url = new URL(input.url); } catch { return undefined; }
  if (hasOfficialUpdateAnchor(url)) return undefined;
  const hostname = url.hostname.replace(/^www\./u, "");
  const known = ["openai.com", "developers.openai.com", "cookbook.openai.com", "anthropic.com", "platform.claude.com", "docs.claude.com", "claude.com", "ai.google.dev", "developers.googleblog.com", "huggingface.co"];
  if (!known.includes(hostname) || !["official", "research"].includes(input.sourceRole || "")) return undefined;
  const isTechnical = /\/(?:cookbook|engineering|docs|learn|tutorials|examples)(?:\/|$)/iu.test(url.pathname)
    || /\b(?:how to|tutorial|guide|best practices|building|prompting|hands-on)\b|教程|指南|实操|实践/iu.test(input.title);
  if (!isTechnical) return undefined;
  const text = `${input.title} ${(input.excerpt || "").slice(0, 1500)}`;
  const advanced = /\b(?:cuda|kernels?|tensor parallel|distributed training|proof|theorem|gradient|quantization|reinforcement learning)\b|分布式训练|算子|梯度|数学证明|强化学习|量化内核/iu.test(text);
  const introductory = /\b(?:first|getting started|quickstart|introduction|beginner|prompting guide)\b|入门|快速开始|第一次|零基础/iu.test(text);
  return advanced
    ? { complexity: "advanced", adaptation: "explained", label: "进阶技术 · 导读优先", reason: "涉及专业训练或底层实现，默认降低排序；先讲用途、前提和阅读路径，代码与限制沿用原文。", priorityAdjustment: -12 }
    : { complexity: introductory ? "introductory" : "intermediate", adaptation: "faithful", label: introductory ? "入门实践 · 忠实整理" : "技术实践 · 忠实整理", reason: "保留官方章节、操作顺序、代码、图表和限定条件，只补必要术语解释。", priorityAdjustment: introductory ? 4 : 0 };
};

export const technicalAdaptationGuidelines = (policy: TechnicalArticlePolicy) => [
  "这是官方技术材料。保留原始章节顺序、步骤依赖、代码/API 标识、版本、数字和限定条件；不要改成新闻三段式或夸大效果。",
  "引用代码须逐字沿用冻结原文，不得重写参数或假装已经运行。原文没有给出的步骤与测试结果保持未知。",
  "优先沿用正文原图、图表和对应截图，图注保留来源、实验条件和脚注；资料不足时明确缺口。",
  policy.adaptation === "explained"
    ? "先补简短的适用人群、先备知识和术语导读；复杂实现以阅读路径带回官方原文，解释与原文结论分开。"
    : "采用忠实整理或中文导读，保持官方的教学组织方式，只做必要的翻译、衔接和术语解释。",
];
