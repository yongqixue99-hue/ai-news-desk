import { assessEditorialOpportunity } from "./newsworthiness.js";
export interface PracticeOpportunity {
  kind: "project" | "tool" | "experiment" | "postmortem" | "crossover";
  angle: string; audience: string; format: "playbook" | "curate";
  materials: Array<{ url: string; label: string }>;
  limitations: string; validForDays: 30;
}
/** An editorial angle, never testimony that we ran a tool or reproduced a result. */
export const assessPracticeOpportunity = (input: { title: string; excerpt?: string; urls: string[]; official?: boolean }): PracticeOpportunity | undefined => {
  if (assessEditorialOpportunity(input.title, input.excerpt, { official: input.official }).lane !== "interesting") return undefined;
  const materials = [...new Set(input.urls)].flatMap(value => { try {
    const url = new URL(value); if (!["http:", "https:"].includes(url.protocol)) return [];
    return [{ url: url.href, label: url.hostname === "github.com" ? "项目与代码" : "原文与展示材料" }];
  } catch { return []; } }).slice(0, 4);
  if (!materials.length || !input.excerpt?.trim()) return undefined;
  const text = `${input.title} ${input.excerpt}`;
  const kind = /postmortem|failed|failure|复盘|失败/iu.test(text) ? "postmortem"
    : /built|building|制作|做了|复现|porting/iu.test(text) ? "project"
    : /tested|measured|benchmark|experiment|实测|实验/iu.test(text) ? "experiment"
    : /game|music|creative|hardware|游戏|创作|硬件/iu.test(text) ? "crossover" : "tool";
  const angles = { project: "沿着作者的实现过程，说明具体做法与可复用部分", tool: "从适用任务和使用门槛介绍这个工具", experiment: "围绕测试方法、比较对象和条件解释结果", postmortem: "从失败原因和前置条件整理可避免的问题", crossover: "从 AI 与游戏、创作或硬件的具体结合方式切入" };
  return { kind, angle: angles[kind], audience: kind === "project" ? "希望动手复现的读者" : "希望判断是否适用的普通科技读者", format: kind === "project" || kind === "postmortem" ? "playbook" : "curate", materials,
    limitations: "材料可回链；未验证实际使用效果，成稿前仍须核对版本、依赖、许可和测试条件。", validForDays: 30 };
};
