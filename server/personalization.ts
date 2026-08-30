import { preferenceKeywordsFor } from "./candidate-feedback.js";
import { collectionTopics } from "./topics.js";
import type {
  Candidate,
  CandidateFeedback,
  CandidateFeedbackKind,
  CollectionTopicId,
  WorkflowState,
} from "./types.js";

const historicalCap = 3;
const totalCap = 6;

const weightFor: Record<CandidateFeedbackKind, number> = {
  interested: 1,
  not_interested: -1,
  published: 2,
};

const directAdjustmentFor: Record<CandidateFeedbackKind, number> = {
  interested: 3,
  not_interested: -4,
  published: 4,
};

const directLabelFor: Record<CandidateFeedbackKind, string> = {
  interested: "你标记了感兴趣",
  not_interested: "你标记了不感兴趣",
  published: "已确认发布",
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const addTo = <Key>(map: Map<Key, number>, key: Key, amount: number) =>
  map.set(key, (map.get(key) ?? 0) + amount);

const levelFor = (net: number, maximum: number) => {
  if (!net) return 0;
  return Math.sign(net) * Math.min(maximum, Math.ceil(Math.abs(net) / 2));
};

interface PreferenceProfile {
  byCandidate: Map<string, CandidateFeedback>;
  sources: Map<string, number>;
  topics: Map<CollectionTopicId, number>;
  keywords: Map<string, number>;
}

interface PreferenceContribution {
  amount: number;
  label: string;
}

export const buildPreferenceProfile = (feedback: CandidateFeedback[]): PreferenceProfile => {
  const profile: PreferenceProfile = {
    byCandidate: new Map(),
    sources: new Map(),
    topics: new Map(),
    keywords: new Map(),
  };
  // Newest feedback wins if a legacy state contains duplicate candidate records.
  const ordered = [...feedback].sort((left, right) =>
    Date.parse(right.createdAt) - Date.parse(left.createdAt));
  for (const entry of ordered) {
    if (profile.byCandidate.has(entry.candidateId)) continue;
    profile.byCandidate.set(entry.candidateId, entry);
    const weight = weightFor[entry.kind];
    addTo(profile.sources, entry.sourceName, weight);
    for (const topicId of entry.topicIds) addTo(profile.topics, topicId, weight);
    for (const keyword of entry.keywords) addTo(profile.keywords, keyword, weight);
  }
  return profile;
};

const contributionFor = (candidate: Candidate, profile: PreferenceProfile) => {
  const direct = profile.byCandidate.get(candidate.id);
  const ownWeight = direct ? weightFor[direct.kind] : 0;
  const contributions: PreferenceContribution[] = [];

  const sourceNet = (profile.sources.get(candidate.sourceName) ?? 0)
    - (direct?.sourceName === candidate.sourceName ? ownWeight : 0);
  const sourceAmount = levelFor(sourceNet, 2);
  if (sourceAmount) contributions.push({ amount: sourceAmount, label: `来源 ${candidate.sourceName}` });

  const topicSignals = (candidate.topicIds ?? []).map((topicId) => {
    const ownTopicWeight = direct?.topicIds.includes(topicId) ? ownWeight : 0;
    return {
      topicId,
      net: (profile.topics.get(topicId) ?? 0) - ownTopicWeight,
    };
  }).filter(({ net }) => net !== 0);
  if (topicSignals.length) {
    const strongest = topicSignals.sort((left, right) => Math.abs(right.net) - Math.abs(left.net))[0];
    const topicAmount = levelFor(strongest.net, 1);
    const topicLabel = collectionTopics.find((topic) => topic.id === strongest.topicId)?.label
      ?? strongest.topicId.toUpperCase();
    contributions.push({ amount: topicAmount, label: `${topicLabel}频道` });
  }

  const candidateKeywords = preferenceKeywordsFor(candidate.title);
  const keywordSignals = candidateKeywords.flatMap((keyword) => {
    const ownKeywordWeight = direct?.keywords.includes(keyword) ? ownWeight : 0;
    const net = (profile.keywords.get(keyword) ?? 0) - ownKeywordWeight;
    return net ? [{ keyword, net }] : [];
  }).sort((left, right) => Math.abs(right.net) - Math.abs(left.net));
  if (keywordSignals.length) {
    const keywordNet = keywordSignals.slice(0, 3).reduce((sum, entry) => sum + entry.net, 0);
    const keywordAmount = levelFor(keywordNet, 2);
    if (keywordAmount) {
      contributions.push({
        amount: keywordAmount,
        label: `相关词“${keywordSignals[0].keyword}”`,
      });
    }
  }
  return { direct, contributions };
};

const signed = (amount: number) => amount > 0 ? `+${amount}` : String(amount);

export const personalizeCandidates = (
  candidates: Candidate[],
  feedback: CandidateFeedback[],
  enabled: boolean,
) => {
  const profile = buildPreferenceProfile(feedback);
  const personalized = candidates.map((candidate) => {
    const { direct, contributions } = contributionFor(candidate, profile);
    if (!enabled) {
      return {
        ...candidate,
        userFeedback: direct?.kind,
        personalizationScore: 0,
        personalizationReasons: [],
      };
    }

    let score = direct ? directAdjustmentFor[direct.kind] : 0;
    let historicalScore = 0;
    const reasons = direct
      ? [`${directLabelFor[direct.kind]} ${signed(score)}`]
      : [];
    for (const contribution of direct ? [] : contributions) {
      const nextHistorical = clamp(historicalScore + contribution.amount, -historicalCap, historicalCap);
      const historicallyApplied = nextHistorical - historicalScore;
      const nextTotal = clamp(score + historicallyApplied, -totalCap, totalCap);
      const applied = nextTotal - score;
      if (!applied) continue;
      historicalScore += applied;
      score = nextTotal;
      reasons.push(`${contribution.label} ${signed(applied)}`);
    }
    return {
      ...candidate,
      userFeedback: direct?.kind,
      personalizationScore: score,
      personalizationReasons: reasons,
    };
  });

  return personalized.sort((left, right) => {
    const recommendationDelta = (right.recommendationScore + (right.personalizationScore ?? 0))
      - (left.recommendationScore + (left.personalizationScore ?? 0));
    if (recommendationDelta) return recommendationDelta;
    if (right.recommendationScore !== left.recommendationScore) {
      return right.recommendationScore - left.recommendationScore;
    }
    if (right.score !== left.score) return right.score - left.score;
    return Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
  });
};

export const reapplyPersonalizationToRuns = (state: WorkflowState) => {
  for (const run of state.runs) {
    run.candidates = personalizeCandidates(
      run.candidates,
      state.candidateFeedback,
      state.settings.personalizationEnabled,
    );
  }
};
