import { createCollectionRun } from "./horizon.js";
import { isPortableArchiveImportActive } from "./portable-archive-importer.js";
import { localScheduleClock, scheduleIsDue } from "./run-policy.js";
import { readState } from "./storage.js";
import { officialXMonitor } from "./x-monitor-desk.js";
import { dueOfficialSources } from "./official-source-monitor.js";

export const runSchedulerCheck = async () => {
  if (isPortableArchiveImportActive()) return;
  await officialXMonitor.poll().catch((error) => {
    console.error("X 官号增量监控失败：", error instanceof Error ? error.message : String(error));
  });
  const state = await readState();
  if (!scheduleIsDue(state.settings)) {
    const sources = dueOfficialSources(state.sources, state.settings);
    // Never submit an empty source list: the collection API interprets it as all selected sources.
    if (sources.length && (!state.settings.lastOfficialPollAt || Date.now() - Date.parse(state.settings.lastOfficialPollAt) >= 5 * 60_000)) {
      await createCollectionRun({ sourceIds: sources.map(source => source.id), officialMonitor: true, windowHours: 48 });
    }
    return;
  }
  const clock = localScheduleClock();
  // The run and the daily claim are persisted in one state mutation. If a
  // manual collection is active, no claim is made and the next heartbeat will
  // try again after that run finishes.
  await createCollectionRun({ scheduled: true, scheduledDate: clock.date });
};

export const startScheduler = () => {
  const check = () => void runSchedulerCheck().catch((error) => {
    console.error("定时心跳检查失败：", error);
  });
  const timer = setInterval(check, 30_000);
  timer.unref();
  check();
  return timer;
};
