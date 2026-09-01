import { createHash } from "node:crypto";
import { titleSimilarity } from "./scoring.js";
import { collectionTopics, normalizeOptionalTopicIds, normalizeTopicIds } from "./topics.js";
import { runEditorialGoldenSet } from "./editorial-golden-set.js";
import type {
  Candidate,
  AutomaticSourceReading,
  EditorialBrief,
  EditorialBriefItem,
  EditorialMemory,
  EditorialProfile,
  EditorialSuggestion,
  EditorialSuggestionStatus,
  EditorialSystemView,
  WorkflowState,
} from "./types.js";

const text = (value: unknown, limit = 500) =>
  (typeof value === "string" ? value : "").trim().slice(0, limit);

const textList = (value: unknown, limit = 12) => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => text(entry, 180)).filter(Boolean))].slice(0, limit);
};

export const updateEditorialProfile = (
  state: WorkflowState,
  patch: Partial<EditorialProfile>,
  options: { now?: () => Date } = {},
): EditorialProfile => {
  const current = state.editorialSystem.profile;
  const profile: EditorialProfile = {
    positioning: text(patch.positioning ?? current.positioning),
    audience: text(patch.audience ?? current.audience),
    goals: textList(patch.goals ?? current.goals),
    preferredTopicIds: normalizeOptionalTopicIds(patch.preferredTopicIds ?? current.preferredTopicIds),
    voiceGuidelines: textList(patch.voiceGuidelines ?? current.voiceGuidelines),
    redLines: textList(patch.redLines ?? current.redLines),
    updatedAt: (options.now ?? (() => new Date()))().toISOString(),
  };
  state.editorialSystem.profile = profile;
  return profile;
};

interface BriefCandidate {
  runId: string;
  candidate: Candidate;
  ageHours: number;
}

const sameEvent = (left: Candidate, right: Candidate) => {
  const leftUrl = left.canonicalUrl || left.url;
  const rightUrl = right.canonicalUrl || right.url;
  return left.id === right.id || leftUrl === rightUrl || titleSimilarity(left.title, right.title) >= 0.78;
};

const eventIdFor = (candidate: Candidate) => {
  const fingerprint = candidate.canonicalUrl || candidate.url || candidate.title.normalize("NFKC").toLocaleLowerCase();
  return `event_${createHash("sha1").update(fingerprint).digest("hex").slice(0, 12)}`;
};

export const buildEditorialBrief = (
  state: WorkflowState,
  now = new Date(),
): EditorialBrief => {
  const currentTime = now.getTime();
  const eligibleRuns = state.runs.filter((run) =>
    run.origin !== "link-intake"
    && run.origin !== "screenshot-intake"
    && !["failed", "cancelled", "queued"].includes(run.status));
  let excludedStaleCount = 0;
  let excludedUndatedCount = 0;
  const fresh: BriefCandidate[] = [];

  for (const run of eligibleRuns) {
    for (const candidate of run.candidates) {
      const published = Date.parse(candidate.publishedAt);
      if (!Number.isFinite(published)) {
        excludedUndatedCount += 1;
        continue;
      }
      const ageHours = Math.max(0, (currentTime - published) / 3_600_000);
      if (ageHours > 48) {
        excludedStaleCount += 1;
        continue;
      }
      fresh.push({ runId: run.id, candidate, ageHours });
    }
  }

  fresh.sort((left, right) => {
    const score = right.candidate.recommendationScore - left.candidate.recommendationScore;
    return score || Date.parse(right.candidate.publishedAt) - Date.parse(left.candidate.publishedAt);
  });

  const mustReads: EditorialBriefItem[] = [];
  let excludedDuplicateCount = 0;
  for (const entry of fresh) {
    const duplicate = mustReads.find((item) => {
      const existing = state.runs
        .find((run) => run.id === item.runId)
        ?.candidates.find((candidate) => candidate.id === item.candidateId);
      return existing ? sameEvent(existing, entry.candidate) : false;
    });
    if (duplicate) {
      excludedDuplicateCount += 1;
      if (!duplicate.supporting.some((item) => item.url === entry.candidate.url)) {
        duplicate.supporting.push({
          title: entry.candidate.title,
          url: entry.candidate.url,
          sourceName: entry.candidate.sourceName,
        });
      }
      continue;
    }
    if (mustReads.length >= 20) continue;
    mustReads.push({
      eventId: eventIdFor(entry.candidate),
      runId: entry.runId,
      candidateId: entry.candidate.id,
      title: entry.candidate.title,
      url: entry.candidate.url,
      sourceName: entry.candidate.sourceName,
      publishedAt: entry.candidate.publishedAt,
      ageHours: Math.round(entry.ageHours * 10) / 10,
      excerpt: entry.candidate.excerpt,
      topicIds: normalizeTopicIds(entry.candidate.topicIds),
      recommendationScore: entry.candidate.recommendationScore,
      evidence: entry.candidate.evidence,
      supporting: [],
    });
  }

  const targetTopics = state.editorialSystem.profile.preferredTopicIds.length
    ? state.editorialSystem.profile.preferredTopicIds
    : state.settings.collectionTopics;
  const coveredTopics = new Set(mustReads.flatMap((item) => item.topicIds));
  return {
    generatedAt: now.toISOString(),
    hardWindowHours: 48,
    mustReads,
    coverageGaps: targetTopics.filter((topicId) => !coveredTopics.has(topicId)),
    excludedDuplicateCount,
    excludedStaleCount,
    excludedUndatedCount,
  };
};

const feedbackWeight = { interested: 1, not_interested: -1, published: 2 } as const;

export const buildEditorialMemory = (
  state: WorkflowState,
  now = new Date(),
): EditorialMemory => {
  const cutoff = now.getTime() - 30 * 86_400_000;
  const feedback = state.candidateFeedback.filter((entry) => {
    const createdAt = Date.parse(entry.createdAt);
    return Number.isFinite(createdAt) && createdAt >= cutoff && createdAt <= now.getTime();
  });
  const sourceSignals = new Map<string, { score: number; feedbackCount: number }>();
  const topicSignals = new Map<string, { score: number; feedbackCount: number }>();
  for (const entry of feedback) {
    const weight = feedbackWeight[entry.kind];
    const source = sourceSignals.get(entry.sourceName) ?? { score: 0, feedbackCount: 0 };
    source.score += weight;
    source.feedbackCount += 1;
    sourceSignals.set(entry.sourceName, source);
    for (const topicId of entry.topicIds) {
      const topic = topicSignals.get(topicId) ?? { score: 0, feedbackCount: 0 };
      topic.score += weight;
      topic.feedbackCount += 1;
      topicSignals.set(topicId, topic);
    }
  }
  const sources = [...sourceSignals.entries()].map(([name, signal]) => ({ name, ...signal }));
  const topics = [...topicSignals.entries()].map(([topicId, signal]) => ({
    topicId: topicId as EditorialMemory["topicSignals"][number]["topicId"],
    ...signal,
  }));
  return {
    generatedAt: now.toISOString(),
    windowDays: 30,
    feedbackCount: feedback.length,
    publishedCount: feedback.filter((entry) => entry.kind === "published").length,
    preferredSources: sources.filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || right.feedbackCount - left.feedbackCount)
      .slice(0, 8),
    avoidedSources: sources.filter((entry) => entry.score < 0)
      .sort((left, right) => left.score - right.score || right.feedbackCount - left.feedbackCount)
      .slice(0, 8),
    topicSignals: topics.filter((entry) => entry.score !== 0)
      .sort((left, right) => right.score - left.score || right.feedbackCount - left.feedbackCount),
    recentPublishedTitles: feedback
      .filter((entry) => entry.kind === "published")
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .map((entry) => entry.title)
      .slice(0, 8),
  };
};

const suggestionId = (kind: EditorialSuggestion["kind"], targetId = "general") =>
  `editorial_${kind}_${targetId}`;

export const buildEditorialSuggestions = (
  state: WorkflowState,
  now = new Date(),
): EditorialSuggestion[] => {
  const memory = buildEditorialMemory(state, now);
  const generated: EditorialSuggestion[] = [];
  for (const signal of memory.preferredSources.filter((entry) => entry.score >= 2)) {
    const source = state.sources.find((entry) => entry.name === signal.name);
    if (!source || (source.selected && source.enabled)) continue;
    generated.push({
      id: suggestionId("source-promote", source.id),
      kind: "source-promote",
      targetId: source.id,
      label: `加入每日读源：${source.name}`,
      reason: `最近 30 天有 ${signal.feedbackCount} 次明确正向反馈，净信号 ${signal.score}。`,
      confidence: signal.score >= 4 ? "high" : "medium",
      status: "pending",
      createdAt: now.toISOString(),
    });
  }
  for (const source of state.sources.filter((entry) =>
    entry.selected && (entry.health === "error" || (entry.consecutiveFailures ?? 0) >= 3))) {
    generated.push({
      id: suggestionId("source-demote", source.id),
      kind: "source-demote",
      targetId: source.id,
      label: `暂停每日读源：${source.name}`,
      reason: source.lastHealthDetail || `该来源已连续失败 ${source.consecutiveFailures ?? 0} 次。`,
      confidence: (source.consecutiveFailures ?? 0) >= 5 ? "high" : "medium",
      status: "pending",
      createdAt: now.toISOString(),
    });
  }
  for (const signal of memory.topicSignals.filter((entry) => entry.score >= 2)) {
    if (state.editorialSystem.profile.preferredTopicIds.includes(signal.topicId)) continue;
    const label = collectionTopics.find((topic) => topic.id === signal.topicId)?.label ?? signal.topicId;
    generated.push({
      id: suggestionId("topic-add", signal.topicId),
      kind: "topic-add",
      targetId: signal.topicId,
      label: `将“${label}”加入长期关注`,
      reason: `最近 30 天该主题净信号 ${signal.score}，来自 ${signal.feedbackCount} 次明确反馈。`,
      confidence: signal.score >= 4 ? "high" : "medium",
      status: "pending",
      createdAt: now.toISOString(),
    });
  }
  if (!state.editorialSystem.profile.positioning && memory.feedbackCount >= 3) {
    generated.push({
      id: suggestionId("profile-note"),
      kind: "profile-note",
      label: "补充长期内容定位",
      reason: "系统已经积累了近期偏好，但长期定位仍为空；建议由你明确写下，不由 Agent 猜测。",
      confidence: "medium",
      status: "pending",
      createdAt: now.toISOString(),
    });
  }

  const decisions = new Map(state.editorialSystem.suggestionDecisions.map((entry) => [entry.id, entry]));
  const current = generated.map((entry) => ({ ...entry, ...decisions.get(entry.id) }));
  for (const decision of state.editorialSystem.suggestionDecisions) {
    if (!current.some((entry) => entry.id === decision.id)) current.push({ ...decision });
  }
  const statusOrder: Record<EditorialSuggestionStatus, number> = { pending: 0, ignored: 1, adopted: 2 };
  return current.sort((left, right) => statusOrder[left.status] - statusOrder[right.status]
    || Date.parse(right.createdAt) - Date.parse(left.createdAt));
};

export const decideEditorialSuggestion = (
  state: WorkflowState,
  suggestionIdToDecide: string,
  status: Exclude<EditorialSuggestionStatus, "pending">,
  options: { now?: () => Date } = {},
) => {
  const now = (options.now ?? (() => new Date()))();
  const suggestion = buildEditorialSuggestions(state, now)
    .find((entry) => entry.id === suggestionIdToDecide);
  if (!suggestion) throw new Error("内容策略建议不存在");
  const decided: EditorialSuggestion = { ...suggestion, status, decidedAt: now.toISOString() };
  state.editorialSystem.suggestionDecisions = [
    decided,
    ...state.editorialSystem.suggestionDecisions.filter((entry) => entry.id !== decided.id),
  ].slice(0, 100);
  if (status === "adopted" && suggestion.kind === "source-promote") {
    const source = state.sources.find((entry) => entry.id === suggestion.targetId);
    if (source) {
      source.enabled = true;
      source.selected = true;
    }
  }
  if (status === "adopted" && suggestion.kind === "source-demote") {
    const source = state.sources.find((entry) => entry.id === suggestion.targetId);
    if (source) source.selected = false;
  }
  if (status === "adopted" && suggestion.kind === "topic-add" && suggestion.targetId) {
    state.editorialSystem.profile.preferredTopicIds = normalizeOptionalTopicIds([
      ...state.editorialSystem.profile.preferredTopicIds,
      suggestion.targetId,
    ]);
    state.editorialSystem.profile.updatedAt = now.toISOString();
  }
  return decided;
};

export const buildAutomaticSourceReading = (
  state: WorkflowState,
): AutomaticSourceReading => {
  const sources = state.sources.filter((source) => source.enabled && source.selected);
  const lastRun = state.runs
    .filter((run) => run.scheduled)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
  return {
    enabled: state.settings.scheduleEnabled,
    scheduleTime: state.settings.scheduleTime,
    sourceIds: sources.map((source) => source.id),
    sourceNames: sources.map((source) => source.name),
    lastRunId: lastRun?.id,
    lastStatus: lastRun?.status,
    lastReadAt: lastRun?.completedAt ?? lastRun?.updatedAt,
    lastError: lastRun?.error,
  };
};

export const buildEditorialSystemView = (
  state: WorkflowState,
  _now = new Date(),
): EditorialSystemView => ({
  profile: structuredClone(state.editorialSystem.profile),
  brief: buildEditorialBrief(state, _now),
  memory: buildEditorialMemory(state, _now),
  suggestions: buildEditorialSuggestions(state, _now),
  automaticReading: buildAutomaticSourceReading(state),
  writingMemories: {
    effectiveEditCount: 0,
    applicationThreshold: 5,
    applicationUnlocked: false,
    memories: [],
  },
  qualityBaseline: (() => {
    const report = runEditorialGoldenSet();
    return {
      version: report.version,
      total: report.total,
      passed: report.passed,
      failed: report.failed,
      categoryCounts: report.categoryCounts,
    };
  })(),
});
