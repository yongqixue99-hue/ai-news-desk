/** Percentiles compare observed values only, within one platform and post-age band. */
export interface CommunityMetricComparison {
  status: "unknown" | "insufficient" | "comparable";
  cohortSize: number;
  ageBand?: string;
  percentile?: number;
  points?: number;
  comments?: number;
  basis: string;
}
export const observedMetric = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
const ageBandFor = (hours: number) => hours < 6 ? "0–6 小时" : hours < 24 ? "6–24 小时" : hours < 72 ? "1–3 天" : hours <= 168 ? "3–7 天" : "7 天以上";
interface Entry { platform: string; ageHours: number; candidate: { publicationDateKnown?: boolean; engagement?: { points?: number; comments?: number } } }
export const compareCommunityMetrics = (entry: Entry, entries: Entry[]): CommunityMetricComparison => {
  const points = observedMetric(entry.candidate.engagement?.points);
  const comments = observedMetric(entry.candidate.engagement?.comments);
  const ageBand = entry.candidate.publicationDateKnown === false ? undefined : ageBandFor(entry.ageHours);
  const base = { points, comments, ageBand, cohortSize: 0 };
  if ((points === undefined && comments === undefined) || !ageBand) return { ...base, status: "unknown", basis: !ageBand ? "原始帖龄未知，未参与热度比较" : "尚无可比较的互动记录" };
  const cohort = entries.filter(other => other.platform === entry.platform && other.candidate.publicationDateKnown !== false
    && ageBandFor(other.ageHours) === ageBand
    && (observedMetric(other.candidate.engagement?.points) !== undefined) === (points !== undefined)
    && (observedMetric(other.candidate.engagement?.comments) !== undefined) === (comments !== undefined));
  if (cohort.length < 5) return { ...base, cohortSize: cohort.length, status: "insufficient", basis: `${entry.platform} · ${ageBand} · ${cohort.length} 个可比条目，暂不排序热度` };
  const values = (item: Entry) => [points === undefined ? undefined : observedMetric(item.candidate.engagement?.points), comments === undefined ? undefined : observedMetric(item.candidate.engagement?.comments)];
  const percentiles = values(entry).flatMap((value, index) => value === undefined ? [] : [cohort.reduce((sum, other) => sum + (values(other)[index]! < value ? 1 : values(other)[index] === value ? .5 : 0), 0) / cohort.length * 100]);
  const percentile = Math.round(percentiles.reduce((sum, value) => sum + value, 0) / percentiles.length);
  return { ...base, status: "comparable", cohortSize: cohort.length, percentile, basis: `${entry.platform} · ${ageBand} · ${cohort.length} 个条目的互动百分位 ${percentile}` };
};
