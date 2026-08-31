import { randomUUID } from "node:crypto";
import { collectPortableStructuredSources } from "./structured-collector.js";
import { rawItemToCandidate } from "./scoring.js";
import { retainWorkflowRuns } from "./run-retention.js";
import { readState, updateState } from "./storage.js";
import { storyById } from "./story-desk.js";
import type {
  CollectionTopicId,
  RawHorizonItem,
  SourceConfig,
  WorkflowState,
} from "./types.js";

export interface EvidenceSearchResult {
  items: RawHorizonItem[];
  failures: Record<string, string>;
  searchedSourceCount: number;
}

export interface StoryEvidenceDeskDependencies {
  readState: () => Promise<WorkflowState>;
  updateState: <T>(mutate: (state: WorkflowState) => T | Promise<T>) => Promise<T>;
  search: (input: {
    sources: SourceConfig[];
    topicIds: CollectionTopicId[];
    query: string;
    signal?: AbortSignal;
  }) => Promise<EvidenceSearchResult>;
  now: () => Date;
}

const normalizedTokens = (value: string) => {
  const normalized = value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const words = normalized
    .split(/\s+/u)
    .filter((token) => token.length >= 2 && !new Set(["the", "with", "from", "and", "for", "new", "发布", "宣布"]).has(token));
  const chineseBigrams = [...normalized.matchAll(/[\u3400-\u9fff]{2,}/gu)].flatMap((match) => {
    const text = match[0];
    return Array.from({ length: Math.max(0, text.length - 1) }, (_unused, index) => text.slice(index, index + 2));
  });
  return new Set([...words, ...chineseBigrams]);
};

const titleMatchScore = (left: string, right: string) => {
  const leftTokens = normalizedTokens(left);
  const rightTokens = normalizedTokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let shared = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) shared += 1;
  const base = shared / Math.min(leftTokens.size, rightTokens.size);
  const chinese = /[\u3400-\u9fff]/u.test(left) && /[\u3400-\u9fff]/u.test(right);
  return chinese && shared >= 4 ? Math.min(1, base + 0.25) : base;
};

const normalizedDomain = (value: string) => {
  try {
    const parts = new URL(value).hostname.replace(/^www\./u, "").toLocaleLowerCase().split(".").filter(Boolean);
    if (parts.length <= 2) return parts.join(".");
    const publicSuffix = parts.slice(-2).join(".");
    return /^(?:com|co|org|net|gov|edu)\.(?:cn|uk|jp|au|nz)$/u.test(publicSuffix)
      ? parts.slice(-3).join(".")
      : parts.slice(-2).join(".");
  } catch {
    return "";
  }
};

const itemSourceName = (item: RawHorizonItem) => {
  const feedName = item.metadata?.feed_name;
  return (typeof feedName === "string" && feedName.trim() ? feedName : item.author || item.source_type).trim();
};

const independentRole = (item: RawHorizonItem) => ["official", "research", "verification"]
  .includes(String(item.metadata?.source_role));

const corroboratesClaim = (storyTitle: string, item: RawHorizonItem) => {
  if (titleMatchScore(storyTitle, item.title) < 0.6) return false;
  const anchors = normalizedTokens(storyTitle);
  const reported = normalizedTokens(`${item.title} ${item.content ?? ""}`);
  let shared = 0;
  for (const token of anchors) if (reported.has(token)) shared += 1;
  return shared >= 2;
};

const usableEvidenceSources = (state: WorkflowState, existingSourceNames: Set<string>) => state.sources
  .filter((source) => source.enabled && source.selected)
  .filter((source) => source.kind === "google_news" || (source.kind === "rss" && (source.url || source.routes?.length)))
  .filter((source) => ["official", "research", "verification"].includes(source.role ?? ""))
  .filter((source) => !source.discoveryOnly)
  .filter((source) => !existingSourceNames.has(source.name.toLocaleLowerCase()))
  .sort((left, right) => {
    const rank = (role: SourceConfig["role"]) => ({ official: 4, research: 3, verification: 2, discovery: 1, community: 0 })[role ?? "discovery"];
    return rank(right.role) - rank(left.role);
  })
  .slice(0, 6);

const defaultSearch: StoryEvidenceDeskDependencies["search"] = async ({ sources, topicIds, query, signal }) => {
  const result = await collectPortableStructuredSources(sources, {
    topicIds,
    filters: { keywords: query },
    signal,
  });
  return { items: result.items, failures: result.failures, searchedSourceCount: sources.length };
};

export const createStoryEvidenceDesk = (dependencies: Partial<StoryEvidenceDeskDependencies> = {}) => {
  const deps: StoryEvidenceDeskDependencies = {
    readState,
    updateState,
    search: defaultSearch,
    now: () => new Date(),
    ...dependencies,
  };

  return {
    async supplement(storyId: string, options: {
      signal?: AbortSignal;
      progress?: (value: number, stage: string) => void;
    } = {}) {
      const initialState = await deps.readState();
      const story = storyById(initialState, storyId, deps.now().toISOString());
      if (!story) throw new Error("Story 不存在");
      const previousStrength = story.evidenceStrength;
      if (previousStrength === "strong") {
        return {
          storyId,
          previousStrength,
          evidenceStrength: previousStrength,
          addedSourceCount: 0,
          addedSources: [] as string[],
          searchedSourceCount: 0,
          failures: {},
        };
      }

      const factualSignals = story.signals.filter((signal) => !signal.isCommunity);
      const sourceNames = new Set(factualSignals.map((signal) => signal.sourceName.toLocaleLowerCase()));
      const sources = usableEvidenceSources(initialState, sourceNames);
      options.progress?.(0.15, "筛选可用于核验的来源");
      const searched = await deps.search({
        sources,
        topicIds: story.topicIds.length ? story.topicIds : ["ai"],
        query: story.originalTitle,
        signal: options.signal,
      });
      options.progress?.(0.62, "比对独立来源与原事件");

      const existingUrls = new Set(factualSignals.map((signal) => signal.url.replace(/[?#].*$/u, "")));
      const existingDomains = new Set(factualSignals.map((signal) => normalizedDomain(signal.url)).filter(Boolean));
      const matchedDomains = new Set<string>();
      const matchedSourceNames = new Set<string>();
      const storyTime = Date.parse(story.publishedAt);
      const matched = searched.items
        .filter((item) => !existingUrls.has(item.url.replace(/[?#].*$/u, "")))
        .filter(independentRole)
        .filter((item) => !sourceNames.has(itemSourceName(item).toLocaleLowerCase()))
        .filter((item) => {
          const domain = normalizedDomain(item.url);
          return Boolean(domain) && !existingDomains.has(domain);
        })
        .filter((item) => corroboratesClaim(story.originalTitle, item))
        .filter((item) => {
          const publishedAt = Date.parse(item.published_at ?? item.fetched_at ?? "");
          return Number.isFinite(publishedAt) && Math.abs(publishedAt - storyTime) <= 7 * 24 * 3_600_000;
        })
        .filter((item) => {
          const domain = normalizedDomain(item.url);
          const sourceName = itemSourceName(item).toLocaleLowerCase();
          if (matchedDomains.has(domain) || matchedSourceNames.has(sourceName)) return false;
          matchedDomains.add(domain);
          matchedSourceNames.add(sourceName);
          return true;
        })
        .slice(0, 4);

      if (matched.length) {
        const evidenceGroupUrl = factualSignals[0]?.url;
        const timestamp = deps.now().toISOString();
        await deps.updateState((state) => {
          const candidates = matched.map((item) => ({
            ...rawItemToCandidate(item, 7 * 24, story.topicIds),
            evidenceGroupUrl,
            evidenceRelation: "independent-report" as const,
          }));
          state.runs.unshift({
            id: `evidence_${randomUUID().slice(0, 12)}`,
            createdAt: timestamp,
            updatedAt: timestamp,
            completedAt: timestamp,
            status: "ready",
            stage: "独立来源核验完成",
            windowHours: 7 * 24,
            topicIds: story.topicIds,
            keywords: story.originalTitle,
            sourceIds: sources.map((source) => source.id),
            scheduled: false,
            rawCount: searched.items.length,
            filteredRawCount: matched.length,
            candidates,
            origin: "evidence-supplement",
            logs: [{
              at: timestamp,
              stage: "独立来源核验完成",
              message: `为 ${story.title} 补入 ${candidates.length} 个独立来源`,
              level: "success",
            }],
          });
          retainWorkflowRuns(state);
        });
      }

      options.progress?.(0.92, matched.length ? "重新计算证据强度" : "没有找到足够匹配的独立来源");
      const updatedStory = storyById(await deps.readState(), storyId, deps.now().toISOString());
      const addedSources = [...new Set(matched.map((item) => {
        return itemSourceName(item);
      }))];
      return {
        storyId,
        previousStrength,
        evidenceStrength: updatedStory?.evidenceStrength ?? previousStrength,
        addedSourceCount: addedSources.length,
        addedSources,
        searchedSourceCount: searched.searchedSourceCount,
        failures: searched.failures,
      };
    },
  };
};

export const storyEvidenceDesk = createStoryEvidenceDesk();
