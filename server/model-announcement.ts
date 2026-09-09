import { editorialExclusionFor, hasAnnouncementLead, normalizeEditorialText } from "./newsworthiness.js";

export const modelReleaseTerms = /(?:\b(?:claude|fable|mythos|gpt(?:-[\w.]+)?|astra|gemini|llama|qwen|deepseek|grok|mistral|kimi|glm|ernie|minimax)\b|\bmodel\b|模型)/iu;
export const launchHeadlineTerms = /(?:\b(?:new generation|release(?:d|s)?|launch(?:ed|es)?|introduc(?:e|ed|es|ing)|announce(?:d|s)?)\b|正式发布|发布|推出|上线)/iu;
export const routineReleaseTerms = /\b(?:nightly|canary|daily|weekly|webinar|(?:co)?workshop|cli|sdk)\b|报名|活动预告/iu;
export const supportingDocumentTerms = /(?:\b(?:safety|system card|pricing|case study|apolog(?:y|ize[sd]?)|reviewed|cut manual fixes)\b|安全|模型卡|定价|致歉|案例)/iu;
export const modelLaunchCatchupHours = 7 * 24;

/** Triage original source text only; this does not establish availability or facts. */
export const isModelAnnouncementText = (input: string, excerpt = "") => {
  const title = normalizeEditorialText(input);
  return modelReleaseTerms.test(title) && !editorialExclusionFor(title)
    && !routineReleaseTerms.test(title) && !supportingDocumentTerms.test(title)
    && (launchHeadlineTerms.test(title) || hasAnnouncementLead(excerpt));
};
