import type { RunStatus, Settings, WorkflowRun } from "./types.js";

export const collectionActiveStatuses = new Set<RunStatus>([
  "queued",
  "collecting",
  "scoring",
  "extracting",
]);

export const isCollectionActive = (run: Pick<WorkflowRun, "status">) =>
  collectionActiveStatuses.has(run.status);

export const findActiveCollectionRun = (runs: WorkflowRun[]) =>
  runs.find(isCollectionActive);

const minutesSinceMidnight = (value: string) => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return -1;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return -1;
  return hours * 60 + minutes;
};

export const localScheduleClock = (date = new Date(), timeZone = "Asia/Shanghai") => ({
  date: new Intl.DateTimeFormat("sv-SE", { timeZone, dateStyle: "short" }).format(date),
  time: new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date),
});

export const scheduleIsDue = (
  settings: Pick<Settings, "scheduleEnabled" | "scheduleTime" | "lastScheduledDate">,
  date = new Date(),
  timeZone = "Asia/Shanghai",
) => {
  if (!settings.scheduleEnabled) return false;
  const clock = localScheduleClock(date, timeZone);
  if (settings.lastScheduledDate === clock.date) return false;
  const currentMinutes = minutesSinceMidnight(clock.time);
  const scheduledMinutes = minutesSinceMidnight(settings.scheduleTime);
  return currentMinutes >= 0 && scheduledMinutes >= 0 && currentMinutes >= scheduledMinutes;
};
