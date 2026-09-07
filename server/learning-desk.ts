import type { LocalDatabase } from "./local-database.js";
import type {
  ArticleDraft,
  DraftRevisionSnapshot,
  DraftSaveMode,
  WritingMemory,
  WritingMemoryKind,
  WritingMemoryView,
} from "./types.js";

interface InferredPreference {
  kind: WritingMemoryKind;
  label: string;
  summary: string;
}

const promotionalTerms = /重磅|震撼|颠覆(?:性)?|革命性|划时代|遥遥领先|赋能|强势来袭|前所未有|全面升级|不容错过|令人兴奋/giu;
const numericFacts = /(?:\d[\d,.]*\s*(?:%|倍|万|亿|美元|元|GB|MB|B|M|K|token|tokens)?)/giu;

const htmlText = (value = "") => value
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
  .replace(/<[^>]+>/gu, " ")
  .replace(/&nbsp;/giu, " ")
  .replace(/&amp;/giu, "&")
  .replace(/\s+/gu, " ")
  .trim();

const paragraphText = (snapshot: DraftRevisionSnapshot) => snapshot.paragraphs
  .map((paragraph) => paragraph.replace(/\s+/gu, " ").trim())
  .filter(Boolean);

const countMatches = (value: string, pattern: RegExp) => value.match(pattern)?.length ?? 0;
const headingCount = (snapshot: DraftRevisionSnapshot) =>
  snapshot.bodyHtml?.match(/<h[1-3]\b/giu)?.length
  ?? snapshot.paragraphs.filter((paragraph) => /^#{1,3}\s+/u.test(paragraph)).length;
const quoteCount = (snapshot: DraftRevisionSnapshot) =>
  (snapshot.bodyHtml?.match(/<blockquote\b/giu)?.length ?? 0)
  + snapshot.paragraphs.filter((paragraph) => /[“”「」]|社区原句/u.test(paragraph)).length;
const visibleText = (snapshot: DraftRevisionSnapshot) => htmlText(snapshot.bodyHtml)
  || paragraphText(snapshot).join(" ");
const averageLength = (snapshot: DraftRevisionSnapshot) => {
  const paragraphs = paragraphText(snapshot);
  return paragraphs.length ? paragraphs.reduce((total, paragraph) => total + Array.from(paragraph).length, 0) / paragraphs.length : 0;
};

export const inferWritingPreferences = (
  before: DraftRevisionSnapshot,
  after: DraftRevisionSnapshot,
): InferredPreference[] => {
  const inferred: InferredPreference[] = [];
  const beforeText = visibleText(before);
  const afterText = visibleText(after);
  const beforePromotional = countMatches(beforeText, promotionalTerms);
  const afterPromotional = countMatches(afterText, promotionalTerms);
  if (beforePromotional > afterPromotional) inferred.push({
    kind: "remove-promotional-language",
    label: "删除宣传式用词",
    summary: `本次删去 ${beforePromotional - afterPromotional} 处宣传式表达。`,
  });

  const beforeNumbers = countMatches(beforeText, numericFacts);
  const afterNumbers = countMatches(afterText, numericFacts);
  if (afterNumbers > beforeNumbers) inferred.push({
    kind: "prefer-specific-numbers",
    label: "偏好具体数字",
    summary: `本次增加 ${afterNumbers - beforeNumbers} 个可核对的数字表达。`,
  });

  const beforeIntro = Array.from(paragraphText(before)[0] ?? "").length;
  const afterIntro = Array.from(paragraphText(after)[0] ?? "").length;
  if (beforeIntro >= 60 && afterIntro > 0 && afterIntro <= beforeIntro * 0.8) inferred.push({
    kind: "shorter-introduction",
    label: "缩短导语",
    summary: `首段由 ${beforeIntro} 字缩短到 ${afterIntro} 字。`,
  });

  const beforeHeadings = headingCount(before);
  const afterHeadings = headingCount(after);
  if (beforeHeadings > afterHeadings) inferred.push({
    kind: "fewer-headings",
    label: "减少小标题",
    summary: `小标题由 ${beforeHeadings} 个减少到 ${afterHeadings} 个。`,
  });

  const beforeAverage = averageLength(before);
  const afterAverage = averageLength(after);
  if (beforeAverage >= 90 && afterAverage > 0 && afterAverage <= beforeAverage * 0.82) inferred.push({
    kind: "shorter-paragraphs",
    label: "偏好更短段落",
    summary: `平均段长由 ${Math.round(beforeAverage)} 字降到 ${Math.round(afterAverage)} 字。`,
  });

  if (after.images.length > before.images.length) inferred.push({
    kind: "higher-image-density",
    label: "提高正文图片密度",
    summary: `正文图片由 ${before.images.length} 张增加到 ${after.images.length} 张。`,
  });
  return inferred;
};

const isEffectiveEdit = (before: DraftRevisionSnapshot, after: DraftRevisionSnapshot) => {
  const beforeShape = JSON.stringify({
    title: before.title,
    text: visibleText(before),
    images: before.images.map((image) => image.id),
    take: before.take,
  });
  const afterShape = JSON.stringify({
    title: after.title,
    text: visibleText(after),
    images: after.images.map((image) => image.id),
    take: after.take,
  });
  return beforeShape !== afterShape;
};

export const recordDraftEdit = (
  database: LocalDatabase,
  input: {
    draftId: string;
    before: DraftRevisionSnapshot;
    after: DraftRevisionSnapshot;
    saveMode: DraftSaveMode;
  },
) => {
  if (input.saveMode !== "manual" || !isEffectiveEdit(input.before, input.after)) return undefined;
  const inferred = inferWritingPreferences(input.before, input.after);
  const event = database.recordFeedback({
    type: "edited",
    subjectType: "draft",
    subjectId: input.draftId,
    payload: { effective: true, saveMode: input.saveMode, inferred: inferred.map((entry) => entry.kind) },
  });
  for (const preference of inferred) database.recordEditorialMemoryEvidence({
    ...preference,
    eventId: event.id,
    draftId: input.draftId,
    createdAt: event.createdAt,
  });
  database.recordWorkflowEvent({
    type: "draft.edited",
    subjectType: "draft",
    subjectId: input.draftId,
    payload: { inferred: inferred.map((entry) => entry.kind) },
  });
  return event;
};

export const recordPublishedWritingSignals = (database: LocalDatabase, draft: ArticleDraft) => {
  const event = database.recordFeedback({
    type: "publication_edit_profile",
    subjectType: "draft",
    subjectId: draft.id,
    payload: { imageCount: draft.images.length, paragraphCount: draft.paragraphs.length },
  });
  const snapshot: DraftRevisionSnapshot = {
    title: draft.title,
    paragraphs: draft.paragraphs,
    take: draft.take,
    bodyHtml: draft.bodyHtml,
    sources: draft.sources,
    factClaims: draft.factClaims,
    uncertainties: draft.uncertainties,
    images: draft.images,
    community: draft.community,
    topics: draft.topics,
  };
  const quotes = quoteCount(snapshot);
  if (quotes > 0) database.recordEditorialMemoryEvidence({
    kind: "preserve-community-quotes",
    label: "保留社区原句",
    eventId: event.id,
    draftId: draft.id,
    summary: `确认发布的终稿保留了 ${quotes} 处社区原句或引语。`,
    createdAt: event.createdAt,
  });
  if (draft.images.length >= 2 && draft.images.length >= Math.ceil(Math.max(1, draft.paragraphs.length) / 3)) {
    database.recordEditorialMemoryEvidence({
      kind: "higher-image-density",
      label: "提高正文图片密度",
      eventId: event.id,
      draftId: draft.id,
      summary: `确认发布的终稿为 ${draft.paragraphs.length} 段配置了 ${draft.images.length} 张图。`,
      createdAt: event.createdAt,
    });
  }
};

const isEffectivePayload = (payload: unknown) => Boolean(
  payload && typeof payload === "object" && (payload as { effective?: unknown }).effective === true,
);

export const writingMemoryView = (database: LocalDatabase, enabled = true): WritingMemoryView => {
  const effectiveEditCount = database.listFeedback(undefined, undefined, 2_000)
    .filter((event) => event.type === "edited" && isEffectivePayload(event.payload)).length;
  const applicationUnlocked = effectiveEditCount >= 5;
  const memories = database.listEditorialMemories().map((memory): WritingMemory => ({
    ...memory,
    kind: memory.kind as WritingMemoryKind,
    applicable: enabled && memory.enabled && applicationUnlocked,
  }));
  return {
    effectiveEditCount,
    applicationThreshold: 5,
    applicationUnlocked,
    memories,
  };
};

export const activeWritingGuidelines = (database: LocalDatabase, enabled = true) => {
  const view = writingMemoryView(database, enabled);
  return view.applicationUnlocked
    ? view.memories.filter((memory) => memory.applicable).map((memory) => memory.label)
    : [];
};

