import { randomUUID } from "node:crypto";
import { createSourceDesk } from "./source-desk.js";
import { collectPortableStructuredSources } from "./structured-collector.js";
import { isCommunityCandidate } from "./community-feed.js";
import { buildCandidateBriefingEvidence } from "./candidate-briefing.js";
import { generateCandidateBriefings } from "./candidate-briefing-service.js";
import { extractPage } from "./extractor.js";
import { selectTopAndGenerate } from "./generator.js";
import { findActiveCollectionRun, isCollectionActive } from "./run-policy.js";
import { rawItemMatchesSearch, rawItemToCandidate, sortCandidates } from "./scoring.js";
import { applySourceRunResult, sourceResultsForRun } from "./source-health.js";
import {
  dynamicTopicQuery,
  eligibleSourcesForTopics,
  routedFeedsForSource,
  sourceRoleFor,
} from "./source-routing.js";
import { getLocalDatabase, readState, updateState } from "./storage.js";
import { normalizeTopicIds, topicLabels } from "./topics.js";
import { appendWorkflowNotification } from "./notifications.js";
import { canApplyCollectionResult, markCollectionReady } from "./collection-lifecycle.js";
import { retainWorkflowRuns } from "./run-retention.js";
import {
  clearResolvedCollectionFailures,
  clearRetriedCollectionFailures,
  interruptedRunMessage,
  reconcileResolvedCollectionFailures,
} from "./run-recovery.js";
import type {
  CollectionRequest,
  CollectionTopicId,
  RawHorizonItem,
  SourceConfig,
  WorkflowRun,
} from "./types.js";

const now = () => new Date().toISOString();
const runControllers = new Map<string, AbortController>();
const briefingJobs = new Map<string, Promise<CandidateBriefingEnrichmentResult>>();

export interface CandidateBriefingEnrichmentResult {
  run: WorkflowRun;
  requested: number;
  completed: number;
  failed: number;
}

const appendLog = async (
  runId: string,
  stage: string,
  message: string,
  level: "info" | "success" | "warning" | "error" = "info",
) => {
  await updateState((state) => {
    const run = state.runs.find((entry) => entry.id === runId);
    if (!run) return;
    run.logs.push({ at: now(), stage, message, level });
    run.updatedAt = now();
  });
};

const patchRun = async (runId: string, patch: Partial<WorkflowRun>) => {
  await updateState((state) => {
    const run = state.runs.find((entry) => entry.id === runId);
    if (!run) return;
    Object.assign(run, patch, { updatedAt: now() });
  });
};

export const buildHorizonConfig = (
  sources: SourceConfig[],
  windowHours: number,
  topicIds: CollectionTopicId[],
  filters: Pick<CollectionRequest, "dateFrom" | "dateTo" | "keywords"> = {},
) => {
  const selected = sources.filter((source) => source.enabled);
  return {
    ai: {
      provider: "openai",
      model: "unused-in-fetch-only-workflow",
      api_key_env: "NEWS_DESK_UNUSED_KEY",
      languages: ["zh"],
    },
    sources: {
      hackernews: {
        enabled: selected.some((source) => source.kind === "hackernews"),
        fetch_top_stories: 50,
        min_score: 30,
        category: "technology",
        profile: "tech-news",
      },
      rss: selected.flatMap((source) => routedFeedsForSource(source, topicIds, filters)),
      reddit: { enabled: false, subreddits: [], users: [], fetch_comments: 0 },
      telegram: { enabled: false, channels: [] },
      google_news: {
        enabled: false,
        query: dynamicTopicQuery(topicIds, filters),
        language: "en",
        country: "US",
        max_results: 100,
        category: "ai-news",
        profile: "tech-news",
      },
    },
    collection: { time_window_hours: windowHours },
    processing: {
      profiles_dir: "profiles",
      default_profile: "tech-news",
      profile_settings: { "tech-news": { threshold: null, topic_dedup: true } },
    },
    display: { icon_style: "ascii" },
  };
};

export const horizonSourceKindsFor = (sources: SourceConfig[]) => [...new Set(
  sources.flatMap((source) => {
    if (source.kind === "zhihu" || source.kind === "last30days" || source.kind === "github") return [];
    return [source.kind === "google_news" ? "rss" : source.kind];
  }),
)];

const probeImages = async (runId: string, signal?: AbortSignal) => {
  const extractedSourceText = new Map<string, string>();
  const state = await updateState((current) => current);
  const run = state.runs.find((entry) => entry.id === runId);
  if (!run) return extractedSourceText;
  const topCandidates = run.candidates.slice(0, 18);
  let cursor = 0;
  const worker = async () => {
    while (!signal?.aborted && cursor < topCandidates.length) {
      const candidate = topCandidates[cursor++];
      try {
        const page = await extractPage(candidate.url, 8);
        if (page.text.trim()) extractedSourceText.set(candidate.id, page.text.slice(0, 2_400));
        await updateState((current) => {
          const target = current.runs
            .find((entry) => entry.id === runId)
            ?.candidates.find((entry) => entry.id === candidate.id);
          if (!target) return;
          target.canonicalUrl = page.canonicalUrl;
          target.imageCount = page.images.length;
          target.images = page.images;
          if (!target.excerpt && page.text) target.excerpt = page.text.slice(0, 360);
        });
      } catch {
        await updateState((current) => {
          const target = current.runs
            .find((entry) => entry.id === runId)
            ?.candidates.find((entry) => entry.id === candidate.id);
          if (target) target.imageCount = 0;
        });
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return extractedSourceText;
};

const executeCandidateBriefingEnrichment = async (
  runId: string,
  extractedSourceText: ReadonlyMap<string, string>,
  force: boolean,
  candidateIds?: ReadonlySet<string>,
  signal?: AbortSignal,
): Promise<CandidateBriefingEnrichmentResult> => {
  const state = await readState();
  const run = state.runs.find((entry) => entry.id === runId);
  if (!run) throw new Error("运行记录不存在");
  const candidates = run.candidates.filter((candidate) =>
    (!candidateIds || candidateIds.has(candidate.id)) && (
      force
      || !candidate.briefing
      || (isCommunityCandidate(candidate) && !candidate.communityInsight)
    ));
  if (!candidates.length) return { run, requested: 0, completed: 0, failed: 0 };
  const provider = state.aiSettings.providers.find((entry) => entry.id === state.aiSettings.analysisProviderId)
    ?? state.aiSettings.providers.find((entry) => entry.id === state.aiSettings.activeProviderId)
    ?? state.aiSettings.providers[0];
  if (!provider) throw new Error("没有可用的中文速读模型，请先配置 AI");

  const evidence = buildCandidateBriefingEvidence(candidates, extractedSourceText);
  const generated = await generateCandidateBriefings(runId, provider, evidence, { signal });
  const generatedById = new Map(generated.items.map((item) => [item.candidateId, item]));
  const updatedRun = await updateState((current) => {
    const target = current.runs.find((entry) => entry.id === runId);
    if (!target) throw new Error("运行记录不存在");
    if (!canApplyCollectionResult(target, signal)) return target;
    for (const candidate of target.candidates) {
      const generatedCandidate = generatedById.get(candidate.id);
      if (generatedCandidate) {
        candidate.briefing = generatedCandidate.briefing;
        if (generatedCandidate.communityInsight) candidate.communityInsight = generatedCandidate.communityInsight;
      }
    }
    current.aiRunTraces.unshift(...generated.traces);
    current.aiRunTraces = current.aiRunTraces.slice(0, 200);
    target.briefingTraceIds = [...new Set([
      ...(target.briefingTraceIds ?? []),
      ...generated.traces.map((trace) => trace.id),
    ])];
    const timestamp = now();
    target.updatedAt = timestamp;
    const completed = generated.items.length;
    const failed = candidates.length - completed;
    target.logs.push({
      at: timestamp,
      stage: "生成中文速读",
      message: failed
        ? `已生成 ${completed}/${candidates.length} 条中文速读；失败项保留原标题，可手动补全`
        : `已为 ${completed} 条候选生成中文标题与一句话摘要`,
      level: failed ? "warning" : "success",
    });
    if (generated.failures.length) {
      target.logs.push({
        at: timestamp,
        stage: "生成中文速读",
        message: generated.failures[0].slice(0, 320),
        level: "warning",
      });
    }
    return target;
  });
  return {
    run: updatedRun,
    requested: candidates.length,
    completed: generated.items.length,
    failed: candidates.length - generated.items.length,
  };
};

export const enrichCandidateBriefings = (
  runId: string,
  options: {
    extractedSourceText?: ReadonlyMap<string, string>;
    force?: boolean;
    candidateIds?: string[];
    signal?: AbortSignal;
  } = {},
) => {
  const selectedIds = options.candidateIds?.length
    ? [...new Set(options.candidateIds)].sort()
    : undefined;
  const jobKey = selectedIds ? `${runId}:${selectedIds.join(",")}` : runId;
  const running = briefingJobs.get(jobKey);
  if (running) return running;
  const job = executeCandidateBriefingEnrichment(
    runId,
    options.extractedSourceText ?? new Map(),
    Boolean(options.force),
    selectedIds ? new Set(selectedIds) : undefined,
    options.signal,
  ).finally(() => briefingJobs.delete(jobKey));
  briefingJobs.set(jobKey, job);
  return job;
};

interface CollectionRunOptions extends CollectionRequest {
  scheduled?: boolean;
  scheduledDate?: string;
  windowHours?: number;
  retryOfRunId?: string;
}

const windowHoursFromDate = (dateFrom: string) => {
  const startAt = Date.parse(`${dateFrom}T00:00:00+08:00`);
  if (!Number.isFinite(startAt)) return 24;
  return Math.max(1, Math.min(32 * 24, Math.ceil((Date.now() - startAt) / 3_600_000) + 1));
};

export const createCollectionRun = async (
  input: boolean | CollectionRunOptions = false,
): Promise<{ run: WorkflowRun; created: boolean }> => {
  const options = typeof input === "boolean" ? { scheduled: input } : input;
  let created = false;
  const run = await updateState((state) => {
    const active = findActiveCollectionRun(state.runs);
    if (active) return active;

    const timestamp = now();
    const topicIds = normalizeTopicIds(options.topicIds ?? state.settings.collectionTopics);
    const requestedSourceIds = options.sourceIds?.length
      ? options.sourceIds
      : state.sources.filter((source) => source.enabled && source.selected).map((source) => source.id);
    const requestedSourceIdSet = new Set(requestedSourceIds);
    const sourceIds = eligibleSourcesForTopics(
      state.sources.filter((source) => requestedSourceIdSet.has(source.id)),
      topicIds,
    ).map((source) => source.id);
    if (!sourceIds.length) throw new Error("所选新闻源不支持本次频道，请调整来源或频道");
    const windowHours = options.windowHours
      ?? (options.dateFrom ? windowHoursFromDate(options.dateFrom) : state.settings.windowHours);
    const keywords = options.keywords?.trim() || undefined;
    const next: WorkflowRun = {
      id: `run_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${randomUUID().slice(0, 6)}`,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "queued",
      stage: "等待启动",
      windowHours,
      topicIds,
      dateFrom: options.dateFrom,
      dateTo: options.dateTo,
      keywords,
      sourceIds,
      scheduled: Boolean(options.scheduled),
      retryOfRunId: options.retryOfRunId,
      autoGenerateCount: options.scheduled && state.settings.autoGenerate
        ? state.settings.autoGenerateCount
        : undefined,
      rawCount: 0,
      candidates: [],
      logs: [{
        at: timestamp,
        stage: "等待启动",
        message: options.retryOfRunId
          ? `正在重试运行 ${options.retryOfRunId}`
          : options.scheduled
            ? "定时心跳已触发"
            : `手动采集已进入队列${options.dateFrom && options.dateTo ? ` · ${options.dateFrom} 至 ${options.dateTo}` : ""}${keywords ? ` · 关键词：${keywords}` : ""}`,
        level: "info",
      }],
    };
    state.runs.unshift(next);
    retainWorkflowRuns(state);
    if (options.scheduledDate) state.settings.lastScheduledDate = options.scheduledDate;
    created = true;
    return next;
  });
  if (created) {
    (await getLocalDatabase()).enqueueJob({
      type: "collect-run",
      idempotencyKey: `collect-run:${run.id}`,
      payload: { runId: run.id },
      maxAttempts: 3,
    });
  }
  return { run, created };
};

export const retryCollectionRun = async (runId: string) => {
  const state = await updateState((current) => current);
  const previous = state.runs.find((run) => run.id === runId);
  if (!previous) throw new Error("运行记录不存在");
  if (isCollectionActive(previous) || previous.status === "generating") {
    throw new Error("这个任务仍在运行，无需重试");
  }
  return createCollectionRun({
    sourceIds: previous.sourceIds,
    windowHours: previous.windowHours,
    topicIds: previous.topicIds,
    dateFrom: previous.dateFrom,
    dateTo: previous.dateTo,
    keywords: previous.keywords,
    retryOfRunId: previous.id,
  });
};

export const cancelCollectionRun = async (runId: string) => {
  const controller = runControllers.get(runId);
  controller?.abort();
  (await getLocalDatabase()).cancelQueuedJob(`collect-run:${runId}`);
  return updateState((state) => {
    const run = state.runs.find((entry) => entry.id === runId);
    if (!run || !isCollectionActive(run)) return undefined;
    const timestamp = now();
    run.status = "cancelled";
    run.stage = "已取消";
    run.error = "已由用户取消";
    run.updatedAt = timestamp;
    run.completedAt = timestamp;
    run.logs.push({ at: timestamp, stage: "已取消", message: "用户取消了本次采集", level: "warning" });
    return run;
  });
};

export const recoverInterruptedRuns = async () => {
  const database = await getLocalDatabase();
  database.recoverRunningJobs();
  const resumableRunIds = new Set(database.listJobs(500)
    .filter((job) => job.type === "collect-run" && ["queued", "running", "retrying"].includes(job.status))
    .map((job) => job.payload && typeof job.payload === "object" && "runId" in job.payload
      ? String((job.payload as { runId: unknown }).runId)
      : "")
    .filter(Boolean));
  return updateState((state) => {
  const timestamp = now();
  reconcileResolvedCollectionFailures(state);
  let recovered = 0;
  for (const run of state.runs) {
    if (!isCollectionActive(run) && run.status !== "generating") continue;
    if (resumableRunIds.has(run.id) && run.status !== "generating") {
      run.status = "queued";
      run.stage = "恢复上次采集";
      run.error = undefined;
      run.updatedAt = timestamp;
      if (!run.logs.some((log) => log.stage === "恢复上次采集")) {
        run.logs.push({ at: timestamp, stage: "恢复上次采集", message: "持久任务已恢复，将从安全边界重新执行本轮采集。", level: "info" });
      }
      recovered += 1;
      continue;
    }
    run.status = "failed";
    run.stage = "上次运行中断";
    run.error = interruptedRunMessage;
    run.updatedAt = timestamp;
    run.completedAt = timestamp;
    run.logs.push({ at: timestamp, stage: "上次运行中断", message: run.error, level: "warning" });
    if (run.generation?.status === "running") {
      run.generation.status = "failed";
      run.generation.completedAt = timestamp;
      appendWorkflowNotification(state, {
        type: "ai-failed",
        severity: "error",
        title: "AI 成稿任务中断",
        message: `“${run.stage}”在服务退出前没有完成，可以从运行记录重新执行。`,
        dedupeKey: `ai-failed:${run.generation.id}`,
        target: { page: "runs", runId: run.id },
      }, { createdAt: timestamp });
    } else {
      appendWorkflowNotification(state, {
        type: "collection-failed",
        severity: "error",
        title: "新闻采集任务中断",
        message: "服务在采集完成前退出，可以从运行记录重新执行。",
        dedupeKey: `collection-failed:${run.id}`,
        target: { page: "runs", runId: run.id },
      }, { createdAt: timestamp });
    }
    recovered += 1;
  }
  return recovered;
  });
};

export const executeCollection = async (runId: string) => {
  if (runControllers.has(runId)) return;
  const controller = new AbortController();
  runControllers.set(runId, controller);
  let selectedSources: SourceConfig[] = [];
  try {
    const state = await updateState((current) => current);
    const run = state.runs.find((entry) => entry.id === runId);
    if (!run) throw new Error("运行记录不存在");
    if (run.status === "cancelled") return;
    selectedSources = eligibleSourcesForTopics(
      state.sources.filter((source) => run.sourceIds.includes(source.id)),
      normalizeTopicIds(run.topicIds),
    );
    if (!selectedSources.length) throw new Error("至少选择一个新闻源");

    await patchRun(runId, { status: "collecting", stage: "采集原始条目", error: undefined });
    await appendLog(runId, "采集原始条目", `正在读取 ${selectedSources.length} 个新闻源`);
    const topicIds = normalizeTopicIds(run.topicIds);
    const filters = { dateFrom: run.dateFrom, dateTo: run.dateTo, keywords: run.keywords };
    const sourceDesk = createSourceDesk({
      collectStructured: (structuredSources, request) =>
        collectPortableStructuredSources(structuredSources, request, { signal: controller.signal }),
    });
    const batch = await sourceDesk.collect({
      sources: selectedSources,
      topicIds,
      filters,
      signal: controller.signal,
    });
    if (controller.signal.aborted) throw new Error("采集已取消");
    for (const [sourceId, message] of Object.entries(batch.failures)) {
      const sourceName = selectedSources.find((source) => source.id === sourceId)?.name ?? sourceId;
      await appendLog(runId, "采集原始条目", `${sourceName}：${message}`, "warning");
    }
    const horizonRunId = batch.horizonRunId;
    const rawItems = batch.items;
    await patchRun(runId, {
      horizonRunId,
      rawCount: rawItems.length,
      status: "scoring",
      stage: "去重与评分",
    });
    await appendLog(
      runId,
      "采集原始条目",
      `已保留 ${rawItems.length} 条原始记录`,
      rawItems.length ? "success" : "warning",
    );

    const filteredRawItems = rawItems.filter((item) => rawItemMatchesSearch(item, {
      dateFrom: run.dateFrom,
      dateTo: run.dateTo,
      keywords: run.keywords,
    }));
    await patchRun(runId, { filteredRawCount: filteredRawItems.length });
    const preferenceState = await readState();
    const seenUrls = new Set<string>();
    const candidates = sortCandidates(
      filteredRawItems
        .filter((item) => {
          const normalized = item.url.replace(/[?#].*$/, "");
          if (seenUrls.has(normalized)) return false;
          seenUrls.add(normalized);
          return true;
        })
        .map((item) => {
          const candidate = rawItemToCandidate(item, run.windowHours, topicIds);
          const source = selectedSources.find((entry) =>
            entry.name === candidate.sourceName
            || (entry.kind === candidate.sourceType && selectedSources.filter((other) => other.kind === entry.kind).length === 1));
          // Adapter-level provenance is more specific than the connector's
          // default role. For example, a GitHub connector yields both official
          // Releases and community Issues; never flatten both back to one role.
          if (source && !candidate.sourceRole) candidate.sourceRole = sourceRoleFor(source);
          return candidate;
        }),
      preferenceState.candidateFeedback,
      preferenceState.settings.personalizationEnabled,
    );
    const sourceResults = sourceResultsForRun(selectedSources, rawItems, candidates, batch.failures);
    const checkedAt = now();
    await updateState((current) => {
      const targetRun = current.runs.find((entry) => entry.id === runId);
      if (targetRun) {
        targetRun.candidates = candidates;
        targetRun.sourceResults = sourceResults;
        targetRun.status = "extracting";
        targetRun.stage = "提取来源原图";
        targetRun.updatedAt = checkedAt;
      }
      for (const resultItem of sourceResults) {
        const source = current.sources.find((entry) => entry.id === resultItem.sourceId);
        if (!source) continue;
        applySourceRunResult(source, resultItem, checkedAt);
      }
    });
    await appendLog(
      runId,
      "去重与评分",
      `日期与关键词筛选后保留 ${filteredRawItems.length} 条，得到 ${candidates.length} 条${topicLabels(normalizeTopicIds(run.topicIds)).join("／")}候选`,
      candidates.length ? "success" : "warning",
    );
    const extractedSourceText = await probeImages(runId, controller.signal);
    if (controller.signal.aborted) throw new Error("采集已取消");
    if (candidates.length) {
      await patchRun(runId, { stage: "生成中文速读" });
      try {
        await enrichCandidateBriefings(runId, { extractedSourceText, signal: controller.signal });
      } catch (error) {
        await appendLog(
          runId,
          "生成中文速读",
          `中文速读暂未生成，候选采集不受影响：${error instanceof Error ? error.message : String(error)}`,
          "warning",
        );
      }
    }
    const completedAt = now();
    await updateState((current) => {
      const targetRun = current.runs.find((entry) => entry.id === runId);
      if (!targetRun) return;
      if (!markCollectionReady(targetRun, completedAt)) return;
      clearResolvedCollectionFailures(current, runId);
      clearRetriedCollectionFailures(current, runId);
      appendWorkflowNotification(current, {
        type: "collection-complete",
        severity: candidates.length ? "success" : "warning",
        title: "新闻采集完成",
        message: candidates.length
          ? `已整理 ${candidates.length} 条候选新闻，可以开始筛选。`
          : "本次采集没有找到符合条件的候选，请调整来源或搜索条件。",
        dedupeKey: `collection-complete:${runId}`,
        target: { page: "workbench", runId },
      }, { createdAt: completedAt });
      const highScoreCandidate = targetRun.candidates.find((candidate) => candidate.score >= 12);
      if (highScoreCandidate) {
        appendWorkflowNotification(current, {
          type: "high-score-candidate",
          severity: "info",
          title: "发现高分候选",
          message: `${highScoreCandidate.score}/15 · ${highScoreCandidate.briefing?.titleZh ?? highScoreCandidate.title}`,
          dedupeKey: `high-score-candidate:${highScoreCandidate.id}`,
          target: { page: "workbench", runId },
        }, { createdAt: completedAt });
      }
    });
    await appendLog(
      runId,
      candidates.length ? "生成中文速读" : "提取来源原图",
      candidates.length ? "候选列表与中文速读已准备好，可以勾选并分别成稿" : "采集完成，但没有候选；请查看来源诊断",
      candidates.length ? "success" : "warning",
    );
    if (run.autoGenerateCount && candidates.length) {
      await selectTopAndGenerate(runId, run.autoGenerateCount);
    }
  } catch (error) {
    const cancelled = controller.signal.aborted;
    const message = cancelled ? "已由用户取消" : error instanceof Error ? error.message : String(error);
    const timestamp = now();
    await updateState((state) => {
      const run = state.runs.find((entry) => entry.id === runId);
      if (run) {
        run.status = cancelled ? "cancelled" : "failed";
        run.stage = cancelled ? "已取消" : "采集失败";
        run.error = message;
        run.updatedAt = timestamp;
        run.completedAt = timestamp;
        if (!run.logs.some((log) => log.stage === run.stage && log.message === message)) {
          run.logs.push({ at: timestamp, stage: run.stage, message, level: cancelled ? "warning" : "error" });
        }
      }
      if (!cancelled) {
        appendWorkflowNotification(state, {
          type: "collection-failed",
          severity: "error",
          title: "新闻采集失败",
          message: "本次采集未完成，请打开运行记录查看原因并重试。",
          dedupeKey: `collection-failed:${runId}`,
          target: { page: "runs", runId },
        }, { createdAt: timestamp });
      }
      for (const source of state.sources.filter((entry) => selectedSources.some((selected) => selected.id === entry.id))) {
        source.health = cancelled ? "warning" : "error";
        source.lastCheckedAt = timestamp;
        source.lastHealthDetail = message;
        if (!cancelled) source.consecutiveFailures = (source.consecutiveFailures ?? 0) + 1;
      }
    });
    if (!cancelled) throw error;
  } finally {
    runControllers.delete(runId);
  }
};
