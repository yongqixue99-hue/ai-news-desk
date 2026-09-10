import { modelMentions } from "./fact-relations.js";
export interface VisualContextImage { fingerprint?: string; url: string; originalImageUrl?: string; caption: string; sourceUrl?: string }
export interface VisualContextIssue { code: string; message: string }
/** Reviewed pixel identities from the three documented September 8 failures.
 * These are negative constraints, not permission or newly inferred article facts. */
const knownVisuals = [
  { fingerprint: "99cbaadc9a9d0de73f1c9b42bc6c2a969ed9086a01cfedf0267b2315978387e7", path: "gemini-3-8-cyber__evals__cwe-ben", kind: "caption" },
  { fingerprint: "7eba733d33972110564dedaabed82c7d5ce730dfa7a862d8b9fc3a9c952da1d1", path: "agentic-video__evals", kind: "conditions" },
  { fingerprint: "0b295ef37bc0c28954108d6c0bd98980579b8ed31209ec847bdad46eafd909f0", path: "EC-Bench/fig6_bankruptcy", kind: "case" },
] as const;
export const auditVisualContext = (image: VisualContextImage, paragraph: string, displayedCaption = image.caption): VisualContextIssue[] => {
  const issues: VisualContextIssue[] = [];
  const known = knownVisuals.find(item => item.fingerprint === image.fingerprint?.toLowerCase()
    || [image.url, image.originalImageUrl].some(url => url?.includes(item.path)));
  if (known?.kind === "caption" && (!/CWE[- ]Bench/iu.test(displayedCaption) || /StaticBench/iu.test(displayedCaption))) issues.push({ code: "source-caption-conflict", message: "画面标题为 CWE-Bench，来源图注误写 StaticBench。原始图注保留；请核对并更正显示图注，或移出正文。" });
  const context = `${paragraph}\n${displayedCaption}`;
  if (known?.kind === "conditions" && ![/3\.7\s*Flash/iu, /high thinking|高思考/iu, /low media|低(?:媒体|图像|视频)分辨率/iu, /1\s*FPS/iu, /static|静态/iu, /relative|相对/iu].every(pattern => pattern.test(context))) issues.push({ code: "visual-conditions-missing", message: "双面板图限定 Gemini 3.7 Flash、high thinking、low media resolution、静态 1 FPS；准确率标的是相对增益。条件尚未完整说明，请移出正文或核对后补全。" });
  if (known?.kind === "case" && ![/Qwen\s*3\.5[- ]?Plus/iu, /Episode\s*0|第\s*0\s*回合/iu, /May\s*11|5\s*月\s*11|五月十一/iu].every(pattern => pattern.test(context))) issues.push({ code: "visual-case-mismatch", message: "这张图是 Qwen3.5-Plus 第 0 回合，结束于五月十一日，不能代指 GPT-5.5 一月破产的案例。请另作准确说明或移出正文。" });
  const imageModels = modelMentions(displayedCaption), paragraphModels = modelMentions(paragraph);
  if (imageModels.length && paragraphModels.length && !imageModels.some(model => paragraphModels.includes(model))) issues.push({ code: "visual-model-mismatch", message: "图片型号与紧邻正文的具体型号不一致，需要核对案例归属。" });
  const imageCases = [...displayedCaption.matchAll(/\b(?:episode|run|trial)\s*(\d+)\b/giu)].map(match => match[0].toLowerCase());
  const paragraphCases = [...paragraph.matchAll(/\b(?:episode|run|trial)\s*(\d+)\b/giu)].map(match => match[0].toLowerCase());
  if (imageCases.length && paragraphCases.length && !imageCases.some(value => paragraphCases.includes(value))) issues.push({ code: "visual-run-mismatch", message: "图片与正文的实验回合不同。" });
  return issues;
};
