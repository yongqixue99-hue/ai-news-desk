import { createCollectionRun } from "./horizon.js";
import { localScheduleClock, scheduleIsDue } from "./run-policy.js";
import { readState } from "./storage.js";

export const runSchedulerCheck = async () => {
  const state = await readState();
  if (!scheduleIsDue(state.settings)) return;
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
