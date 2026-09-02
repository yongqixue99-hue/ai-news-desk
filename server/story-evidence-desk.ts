import { createHash, randomUUID } from "node:crypto";
import { extractPage } from "./extractor.js";
import { modelResearchTargetsFor } from "./model-release-research.js";
import { collectPortableStructuredSources } from "./structured-collector.js";
import { rawItemToCandidate } from "./scoring.js";
import { retainWorkflowRuns } from "./run-retention.js";
import { readState, updateState } from "./storage.js";
import { storyById } from "./story-desk.js";
import type {
  CollectionTopicId,
  RawHorizonItem,
  SourceImage,
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
  resolveResearchMaterials: (input: {
    storyTitle: string;
    storyPublishedAt: string;
    incompleteFacetIds: string[];
    signal?: AbortSignal;
  }) => Promise<Array<{ item: RawHorizonItem; images: SourceImage[] }>>;
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

const releaseResearchRole = (item: RawHorizonItem) => ["official", "research"]
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

const usableReleaseResearchSources = (state: WorkflowState) => state.sources
  .filter((source) => source.enabled && source.selected)
  .filter((source) => source.kind === "google_news" || (source.kind === "rss" && (source.url || source.routes?.length)))
  .filter((source) => ["official", "research", "verification"].includes(source.role ?? ""))
  .filter((source) => !source.discoveryOnly)
  .sort((left, right) => {
    const rank = (role: SourceConfig["role"]) => ({ official: 4, research: 3, verification: 2, discovery: 1, community: 0 })[role ?? "discovery"];
    return rank(right.role) - rank(left.role);
  })
  .slice(0, 10);

const releaseAnchorStopWords = new Set([
  "announce", "announced", "announces", "introducing", "introduces", "launch", "launched", "releases", "released",
  "official", "model", "models", "preview", "pricing", "benchmark", "available", "with", "from", "into", "will",
  "aws", "azure", "vertex", "发布", "宣布", "推出", "上线", "模型", "官方", "即将", "预告",
]);

const releaseAnchorsFor = (title: string) => [...normalizedTokens(title)]
  .filter((token) => token.length >= 3 || /[\u3400-\u9fff]/u.test(token))
  .filter((token) => !releaseAnchorStopWords.has(token));

const researchFacetPatterns = {
  official: /(?:\b(?:release|launch|announce|introducing|official)\b|发布|推出|公告|官方)/iu,
  identity: /(?:\b(?:model id|model snapshot|release notes?|preview|general availability|deprecated)\b|模型\s*(?:ID|快照)|预览版|正式版|弃用|生命周期)/iu,
  access: /(?:\b(?:api|chatgpt|gemini app|ai studio|model studio|vertex ai|bedrock|region|rollout|availability)\b|接口|应用端|开发者平台|云平台|地区|灰度|可用范围)/iu,
  specs: /(?:\b(?:context window|maximum output|parameters?|weights?|multimodal|vision|audio|tool use|function calling|thinking|fim)\b|上下文|最大输出|参数量|权重|多模态|视觉|音频|工具调用|思考模式)/iu,
  pricing: /(?:[$€£¥]\s*\d|\b(?:pricing|price|costs?|per million)\b|定价|价格|费用)/iu,
  benchmarks: /(?:\b(?:benchmark|leaderboard|evaluation|evals?|swe-bench|gpqa|mmlu|aime|artificial analysis|arena)\b|跑分|评测|基准|排行榜)/iu,
  safety: /(?:\b(?:system card|model card|safety report|risk assessment|technical report)\b|系统卡|模型卡|安全报告|风险评估|技术报告)/iu,
} as const;

const corroboratesReleaseMaterial = (
  storyTitle: string,
  item: RawHorizonItem,
  incompleteFacetIds: string[],
) => {
  const anchors = releaseAnchorsFor(storyTitle);
  if (!anchors.length) return false;
  const itemText = `${item.title} ${item.content ?? ""}`;
  const itemTokens = normalizedTokens(itemText);
  const shared = anchors.filter((anchor) => itemTokens.has(anchor)).length;
  const required = anchors.length === 1 ? 1 : 2;
  if (shared < required) return false;
  return incompleteFacetIds.some((facetId) => {
    if (facetId === "images") return false;
    return researchFacetPatterns[facetId as keyof typeof researchFacetPatterns]?.test(itemText) ?? false;
  });
};

export const resolveKnownModelResearchMaterials: StoryEvidenceDeskDependencies["resolveResearchMaterials"] = async ({
  storyTitle,
  storyPublishedAt,
  incompleteFacetIds,
  signal,
}) => {
  const targets = modelResearchTargetsFor(storyTitle);
  if (!targets.length || signal?.aborted) return [];
  const fetchedAt = new Date().toISOString();
  const attempts = await Promise.allSettled(targets.map(async (target) => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const page = await extractPage(target.url, 4);
    const item: RawHorizonItem = {
      id: `model-research:${createHash("sha1").update(page.canonicalUrl || target.url).digest("hex").slice(0, 20)}`,
      source_type: "model-research",
      title: page.title || storyTitle,
      url: page.canonicalUrl || page.url || target.url,
      content: page.text.slice(0, 12_000),
      published_at: page.publishedAt || storyPublishedAt,
      fetched_at: fetchedAt,
      metadata: {
        feed_name: target.sourceName,
        source_role: target.role,
        collector: "known-model-research",
      },
    };
    return corroboratesReleaseMaterial(storyTitle, item, incompleteFacetIds)
      ? { item, images: page.images }
      : undefined;
  }));
  return attempts.flatMap((attempt) => attempt.status === "fulfilled" && attempt.value ? [attempt.value] : []);
};

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
    // The generic desk stays deterministic in unit tests. The production
    // singleton below opts into live, vendor-aware documentation retrieval.
    resolveResearchMaterials: async () => [],
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
      const incompleteDossierFacets = story.releaseDossier?.facets
        .filter((facet) => facet.status !== "ready")
        .map((facet) => facet.id) ?? [];
      if (previousStrength === "strong" && !incompleteDossierFacets.length) {
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
      const evidenceSources = usableEvidenceSources(initialState, sourceNames);
      const releaseSources = incompleteDossierFacets.length ? usableReleaseResearchSources(initialState) : [];
      const sources = [...new Map([...evidenceSources, ...releaseSources].map((source) => [source.id, source])).values()];
      options.progress?.(0.15, incompleteDossierFacets.length ? "筛选核验来源与模型资料" : "筛选可用于核验的来源");
      const query = incompleteDossierFacets.length
        ? [
          story.originalTitle,
          incompleteDossierFacets.includes("pricing") ? `${story.originalTitle} pricing` : "",
          incompleteDossierFacets.includes("benchmarks") ? `${story.originalTitle} benchmark` : "",
          incompleteDossierFacets.includes("specs") ? `${story.originalTitle} model card context` : "",
          incompleteDossierFacets.includes("identity") ? `${story.originalTitle} model ID release notes` : "",
          incompleteDossierFacets.includes("access") ? `${story.originalTitle} API availability regions` : "",
          incompleteDossierFacets.includes("safety") ? `${story.originalTitle} system card safety report` : "",
        ].filter(Boolean).join(",")
        : story.originalTitle;
      const searched = await deps.search({
        sources,
        topicIds: story.topicIds.length ? story.topicIds : ["ai"],
        query,
        signal: options.signal,
      });
      const resolvedResearch = incompleteDossierFacets.length
        ? await deps.resolveResearchMaterials({
          storyTitle: story.originalTitle,
          storyPublishedAt: story.publishedAt,
          incompleteFacetIds: incompleteDossierFacets,
          signal: options.signal,
        })
        : [];
      options.progress?.(0.62, incompleteDossierFacets.length ? "比对独立来源并检查资料缺口" : "比对独立来源与原事件");

      const existingUrls = new Set(factualSignals.map((signal) => signal.url.replace(/[?#].*$/u, "")));
      const existingDomains = new Set(factualSignals.map((signal) => normalizedDomain(signal.url)).filter(Boolean));
      const matchedDomains = new Set<string>();
      const matchedSourceNames = new Set<string>();
      const storyTime = Date.parse(story.publishedAt);
      const independentMatches = searched.items
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

      const independentlyMatchedUrls = new Set(independentMatches.map((item) => item.url.replace(/[?#].*$/u, "")));
      const researchPool = [
        ...searched.items.map((item) => ({ item, images: [] as SourceImage[] })),
        ...resolvedResearch,
      ];
      const researchMatches = incompleteDossierFacets.length
        ? researchPool
          .filter(({ item }) => !existingUrls.has(item.url.replace(/[?#].*$/u, "")))
          .filter(({ item }) => !independentlyMatchedUrls.has(item.url.replace(/[?#].*$/u, "")))
          .filter(({ item }) => releaseResearchRole(item))
          .filter(({ item }) => corroboratesReleaseMaterial(story.originalTitle, item, incompleteDossierFacets))
          .filter(({ item }, index, items) => items.findIndex(({ item: entry }) => entry.url.replace(/[?#].*$/u, "") === item.url.replace(/[?#].*$/u, "")) === index)
          .slice(0, 6)
        : [];
      const matched = [
        ...independentMatches.map((item) => ({ item, images: [] as SourceImage[], relation: "independent-report" as const })),
        ...researchMatches.map(({ item, images }) => ({ item, images, relation: "research-material" as const })),
      ];

      if (matched.length) {
        // A community post can be the first discovery signal while linking to
        // the real owner page. Attach new factual evidence to that canonical
        // source URL so StoryDesk can join it back to the same event.
        const evidenceGroupUrl = factualSignals[0]?.url
          ?? story.signals.find((signal) => signal.linkedSource)?.url
          ?? story.signals[0]?.url;
        const timestamp = deps.now().toISOString();
        await deps.updateState((state) => {
          const candidates = matched.map(({ item, images, relation }) => {
            const candidate = rawItemToCandidate(item, 7 * 24, story.topicIds);
            return {
              ...candidate,
              evidenceGroupUrl,
              evidenceRelation: relation,
              images: images.length ? images : candidate.images,
              imageCount: images.length ? images.length : candidate.imageCount,
            };
          });
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
              message: `为 ${story.title} 补入 ${independentMatches.length} 个独立来源、${researchMatches.length} 份专题资料`,
              level: "success",
            }],
          });
          retainWorkflowRuns(state);
        });
      }

      options.progress?.(0.92, matched.length ? "重新计算证据与专题资料完整度" : "没有找到足够匹配的来源或专题资料");
      const updatedStory = storyById(await deps.readState(), storyId, deps.now().toISOString());
      const addedSources = [...new Set(matched.map(({ item }) => {
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

export const storyEvidenceDesk = createStoryEvidenceDesk({
  resolveResearchMaterials: resolveKnownModelResearchMaterials,
});
