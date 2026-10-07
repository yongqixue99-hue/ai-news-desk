import { artifactFromRun, type RunArtifactReader } from "./run-artifacts.js";
import { hasOfficialUpdateAnchor } from "./official-update-url.js";
import { draftDocumentBlocks as documentBlocks, retainedDraftBlocks as retainedBlocks, summarizeReworkObservations } from "./draft-rework.js";
import type { WorkflowEventRecord } from "./local-database.js";
import type { WorkflowState } from "./types.js";

const urlKey = (value: string) => {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return undefined;
    if (!hasOfficialUpdateAnchor(url)) url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_.+|fbclid|gclid)$/iu.test(key)) url.searchParams.delete(key);
    url.searchParams.sort(); url.pathname = url.pathname.replace(/\/$/u, "") || "/";
    return url.href;
  } catch { return undefined; }
};
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)]! + sorted[Math.ceil((sorted.length - 1) / 2)]!) / 2 : null;
};
const delays = (values: number[]) => ({ samples: values.length, medianMs: median(values),
  p95Ms: values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]! : null });

/** Pure projection of recorded outcomes: no fetching, model calls, learning or score updates. */
export const buildWorkflowPerformance = (state: Readonly<WorkflowState>, options: { readArtifact?: RunArtifactReader; now?: string; days?: number; benchmarkUrls?: string[]; rework?: { events: WorkflowEventRecord[]; total: number; truncated: boolean } } = {}) => {
  const now = options.now ?? new Date().toISOString();
  const days = Math.max(1, Math.min(365, options.days ?? 30));
  const since = new Date(Date.parse(now) - days * 86_400_000).toISOString();
  const inWindow = (at: string | undefined) => Boolean(at && Date.parse(at) >= Date.parse(since) && Date.parse(at) <= Date.parse(now));
  const runs = state.runs.map(run => ({ ...run, discoveryTrace: artifactFromRun(run, "discoveryTrace", options.readArtifact) })).filter(run => (!run.origin || run.origin === "collection") && inWindow(run.collectedAt ?? run.createdAt))
    .sort((a, b) => Date.parse(a.collectedAt ?? a.createdAt) - Date.parse(b.collectedAt ?? b.createdAt));
  const sources = new Map<string, { sourceId: string; name: string; attempts: number; failedAttempts: number; partialAttempts: number;
    rawCount: number; candidateCount: number; failedRoutes: number; traceRows: number; duplicateRows: number; latency: number[] }>();
  const seen = new Set<string>(), eventDelays = new Map<string, { sourceId?: string; latency: number; observedAt: number }>();
  const observed = new Map<string, Set<string>>();
  const reasons = new Map<string, number>();
  let observedRows = 0, unattributedRows = 0, priorRunRepeats = 0, unknownDates = 0;
  const rowFor = (id: string, name = id) => {
    if (!sources.has(id)) sources.set(id, { sourceId: id, name, attempts: 0, failedAttempts: 0, partialAttempts: 0,
      rawCount: 0, candidateCount: 0, failedRoutes: 0, traceRows: 0, duplicateRows: 0, latency: [] });
    return sources.get(id)!;
  };
  for (const run of runs) {
    for (const result of run.sourceResults ?? []) {
      const row = rowFor(result.sourceId, result.sourceName);
      row.attempts++; row.rawCount += result.rawCount; row.candidateCount += result.candidateCount;
      if (result.healthImpact === "failure") row.failedAttempts++;
      const failures = result.routes?.filter(route => route.status === "error").length ?? 0;
      row.failedRoutes += failures;
      if (failures && result.healthImpact !== "failure") row.partialAttempts++;
    }
    for (const reason of run.collectionFunnel?.rejections ?? []) reasons.set(reason.code, (reasons.get(reason.code) ?? 0) + reason.count);
    const runUrls = new Set<string>();
    for (const trace of run.discoveryTrace ?? []) {
      observedRows++;
      const row = trace.sourceId ? rowFor(trace.sourceId, state.sources.find(source => source.id === trace.sourceId)?.name) : undefined;
      if (row) { row.traceRows++; if (trace.stage === "duplicate-url") row.duplicateRows++; } else unattributedRows++;
      const key = urlKey(trace.url);
      if (!key) continue;
      runUrls.add(key);
      if (!observed.has(key)) observed.set(key, new Set());
      observed.get(key)!.add(trace.stage);
      // Index dates, last-modified dates and date-only headings are not original publication timestamps.
      const reliable = ["feed-published", "publisher-feed", "verified-publication", "article-metadata", "json-ld", "opengraph", "html-time"].includes(trace.dateBasis ?? "");
      const latency = Date.parse(trace.observedAt ?? "") - Date.parse(trace.publishedAt ?? "");
      if (!reliable || !Number.isFinite(latency) || latency < 0 || Date.parse(trace.observedAt!) > Date.parse(now)) { unknownDates++; continue; }
      const event = JSON.stringify([trace.sourceId ?? null, key]);
      const observedAt = Date.parse(trace.observedAt!);
      if (!eventDelays.has(event) || observedAt < eventDelays.get(event)!.observedAt) eventDelays.set(event, { sourceId: trace.sourceId, latency, observedAt });
    }
    for (const key of runUrls) { if (seen.has(key)) priorRunRepeats++; seen.add(key); }
  }
  for (const value of eventDelays.values()) {
    if (value.sourceId) sources.get(value.sourceId)?.latency.push(value.latency);
  }
  const attempts = state.draftGenerationAttempts.filter(attempt => inWindow(attempt.completedAt));
  const allFirstAttempts = new Map<string, typeof attempts[number]>();
  for (const attempt of [...state.draftGenerationAttempts].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) if (!allFirstAttempts.has(attempt.contentPackageId)) allFirstAttempts.set(attempt.contentPackageId, attempt);
  const firstAttempts = [...allFirstAttempts.values()].filter(attempt => inWindow(attempt.completedAt));
  const confirmations: Array<{ draftId: string; titleChanged: boolean; initialParagraphs: number; confirmedParagraphs: number;
    retainedParagraphs: number; changedOrRemovedParagraphs: number; addedOrChangedParagraphs: number; initialRetention: number }> = [];
  const exclusions: Record<string, number> = {};
  const exclude = (reason: string) => { exclusions[reason] = (exclusions[reason] ?? 0) + 1; };
  const drafts = [...state.drafts, ...(state.draftTrash ?? []).map(entry => entry.draft)];
  for (const draft of drafts) {
    if (draft.provenance.authoringMode !== "ai-generated") continue;
    const baseline = draft.editorialBaseline;
    if (!baseline?.confirmed || !inWindow(baseline.confirmed.confirmedAt)) { exclude("no-confirmed-final"); continue; }
    if (baseline.initial.origin !== "initial") { exclude("legacy-baseline"); continue; }
    if (!baseline.confirmed.learningEligible) { exclude("ai-assisted-or-unverified-edits"); continue; }
    const first = state.draftRevisions.filter(revision => revision.draftId === draft.id && revision.kind === "confirmed").sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!first || first.id !== baseline.confirmed.revisionId) { exclude("first-confirmation-eligibility-unavailable"); continue; }
    const before = documentBlocks(baseline.initial.snapshot), after = documentBlocks(baseline.confirmed.snapshot);
    const retained = retainedBlocks(before, after);
    if (!before.length || retained === undefined) { exclude("empty-or-too-large-baseline"); continue; }
    confirmations.push({ draftId: draft.id, titleChanged: baseline.initial.snapshot.title !== baseline.confirmed.snapshot.title,
      initialParagraphs: before.length, confirmedParagraphs: after.length, retainedParagraphs: retained,
      changedOrRemovedParagraphs: before.length - retained, addedOrChangedParagraphs: after.length - retained, initialRetention: retained / before.length });
  }
  const benchmark = [...new Set((options.benchmarkUrls ?? []).map(urlKey).filter((key): key is string => Boolean(key)))].slice(0, 100);
  return {
    version: 1, computedAt: now, window: { days, since, through: now },
    discovery: {
      runs: runs.length, runsWithTrace: runs.filter(run => Boolean(run.discoveryTrace)).length,
      runsWithSourceResults: runs.filter(run => Boolean(run.sourceResults)).length,
      observedRows, uniqueUrls: seen.size, priorRunRepeats, unattributedRows, unknownDateRows: unknownDates,
      latency: delays([...eventDelays.values()].map(value => value.latency)), rejections: Object.fromEntries(reasons),
      latencyScope: "first-recorded-observation-minus-declared-publication; includes-cold-start-and-backlog; not-a-real-time-collection-SLA",
      sources: [...sources.values()].map(({ latency, ...source }) => ({ ...source, latency: delays(latency),
        failureRate: source.attempts ? source.failedAttempts / source.attempts : null,
        duplicateRowRate: source.traceRows ? source.duplicateRows / source.traceRows : null })),
      benchmark: { provided: benchmark.length, recorded: benchmark.filter(key => observed.has(key)).length,
        events: benchmark.map(url => ({ url, recorded: observed.has(url), stages: [...observed.get(url) ?? []] })),
        scope: "supplied-urls-within-recorded-window; unrecorded-is-not-proof-of-a-live-fetch-miss" },
      liveMissRate: null,
    },
    drafts: {
      generationAttempts: attempts.length, firstAttempts: firstAttempts.length,
      firstAttemptOutcomes: { accepted: firstAttempts.filter(attempt => attempt.status === "accepted").length,
        warning: firstAttempts.filter(attempt => attempt.status === "warning").length,
        blocked: firstAttempts.filter(attempt => attempt.status === "blocked").length },
      confirmedManualSamples: confirmations.length, medianInitialParagraphRetention: median(confirmations.map(sample => sample.initialRetention)),
      samples: confirmations, exclusions,
      rework: summarizeReworkObservations(options.rework ? { ...options.rework, events: options.rework.events.filter(event => inWindow(event.createdAt)) } : undefined),
      scope: "first-confirmed-unassisted-human-edits-to-ai-drafts; exact-ordered-paragraph-retention-is-not-quality" },
  };
};
