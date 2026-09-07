import type { Settings, SourceConfig } from "./types.js";
import { sourceSupportsTopics } from "./source-routing.js";

export const officialPollInterval = (value: unknown) => Math.max(30, Math.min(240, Number(value) || 60));

export const dueOfficialSources = (sources: SourceConfig[], settings: Pick<Settings, "officialMonitorEnabled" | "officialMonitorIntervalMinutes" | "collectionTopics">, now = Date.now()) => {
  if (!settings.officialMonitorEnabled) return [];
  return sources.filter(source => {
    if (!source.enabled || !source.selected || source.role !== "official" || !["rss", "documentation"].includes(source.kind) || !sourceSupportsTopics(source, settings.collectionTopics)) return false;
    const minutes = source.kind === "documentation" ? 12 * 60 : officialPollInterval(settings.officialMonitorIntervalMinutes);
    const backoff = Math.min(8, 2 ** Math.min(3, source.consecutiveFailures || 0));
    const checked = Date.parse(source.lastCheckedAt || "");
    return !Number.isFinite(checked) || now - checked >= minutes * backoff * 60_000;
  }).sort((left, right) => Number(right.id === "openai-official" || right.id === "anthropic-official") - Number(left.id === "openai-official" || left.id === "anthropic-official")
    || Date.parse(left.lastCheckedAt || "1970-01-01") - Date.parse(right.lastCheckedAt || "1970-01-01"));
};
