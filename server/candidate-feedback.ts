import { randomUUID } from "node:crypto";
import type {
  CandidateFeedback,
  CandidateFeedbackKind,
  CollectionTopicId,
  WorkflowState,
} from "./types.js";

const feedbackLimit = 300;
const preferenceStopWords = new Set([
  "about", "after", "again", "also", "and", "announces", "from", "into", "model", "new", "news",
  "official", "release", "says", "the", "this", "with",
  "发布", "宣布", "正式", "新闻", "模型", "能力",
]);

const titleSegmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });

export const preferenceKeywordsFor = (title: string) => {
  const terms = [...titleSegmenter.segment(title.normalize("NFKC").toLocaleLowerCase())]
    .filter((segment) => segment.isWordLike)
    .map((segment) => segment.segment.trim())
    .filter((term) => {
      if (preferenceStopWords.has(term)) return false;
      return /\p{Script=Han}/u.test(term) ? term.length >= 2 : term.length >= 3;
    });
  return [...new Set(terms)].slice(0, 8);
};

interface RecordCandidateFeedbackInput {
  runId: string;
  candidateId: string;
  kind: CandidateFeedbackKind;
  draftId?: string;
  at?: string;
  fallback?: {
    title: string;
    sourceName: string;
    topicIds?: CollectionTopicId[];
  };
}

export const recordCandidateFeedback = (
  state: WorkflowState,
  input: RecordCandidateFeedbackInput,
): CandidateFeedback | undefined => {
  const run = state.runs.find((entry) => entry.id === input.runId);
  const candidate = run?.candidates.find((entry) => entry.id === input.candidateId);
  const snapshot = candidate
    ? {
      title: candidate.title,
      sourceName: candidate.sourceName,
      topicIds: candidate.topicIds?.length ? candidate.topicIds : run?.topicIds ?? ["ai" as const],
    }
    : input.fallback;
  if (!snapshot) return undefined;

  const feedback: CandidateFeedback = {
    id: `feedback_${randomUUID().slice(0, 12)}`,
    candidateId: input.candidateId,
    runId: input.runId,
    draftId: input.draftId,
    kind: input.kind,
    title: snapshot.title,
    sourceName: snapshot.sourceName,
    topicIds: [...new Set(snapshot.topicIds ?? run?.topicIds ?? ["ai" as const])],
    keywords: preferenceKeywordsFor(snapshot.title),
    createdAt: input.at ?? new Date().toISOString(),
  };

  state.candidateFeedback = [
    feedback,
    ...state.candidateFeedback.filter((entry) => entry.candidateId !== input.candidateId),
  ].slice(0, feedbackLimit);
  for (const storedRun of state.runs) {
    const storedCandidate = storedRun.candidates.find((entry) => entry.id === input.candidateId);
    if (storedCandidate) storedCandidate.userFeedback = input.kind;
  }
  return feedback;
};

export const restoreCandidateFeedback = (state: WorkflowState, candidateId: string) => {
  const previousLength = state.candidateFeedback.length;
  state.candidateFeedback = state.candidateFeedback.filter((entry) => entry.candidateId !== candidateId);
  for (const run of state.runs) {
    const candidate = run.candidates.find((entry) => entry.id === candidateId);
    if (candidate) candidate.userFeedback = undefined;
  }
  return state.candidateFeedback.length !== previousLength;
};

export const recordPublishedCandidateFeedback = (
  state: WorkflowState,
  draftId: string,
  at?: string,
) => {
  const draft = state.drafts.find((entry) => entry.id === draftId);
  if (!draft) return undefined;
  const run = state.runs.find((entry) => entry.id === draft.runId);
  const candidate = run?.candidates.find((entry) => entry.id === draft.candidateId);
  return recordCandidateFeedback(state, {
    runId: draft.runId,
    candidateId: draft.candidateId,
    draftId,
    kind: "published",
    at,
    fallback: candidate ? undefined : {
      title: draft.title,
      sourceName: draft.sources[0]?.label || "已发布文章",
      topicIds: run?.topicIds ?? ["ai"],
    },
  });
};

export const clearCandidateFeedback = (state: WorkflowState) => {
  const cleared = state.candidateFeedback.length;
  state.candidateFeedback = [];
  for (const run of state.runs) {
    for (const candidate of run.candidates) candidate.userFeedback = undefined;
  }
  return cleared;
};
