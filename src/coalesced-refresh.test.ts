import assert from "node:assert/strict";
import test from "node:test";
import { createCoalescedRefresh } from "./coalesced-refresh.js";

test("a mutation refresh receives the trailing snapshot, not the older in-flight state", async () => {
  const first = deferred<string>();
  const second = deferred<string>();
  let reads = 0;
  const loader = createCoalescedRefresh({ read: () => ++reads === 1 ? first.promise : second.promise, apply: () => undefined });
  const initial = loader.requestValue();
  const changed = loader.requestValue();
  first.resolve("before-save");
  assert.equal(await initial, "before-save");
  second.resolve("after-save");
  assert.equal(await changed, "after-save");
  assert.equal(reads, 2);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function fixture() {
  const reads: ReturnType<typeof deferred<string>>[] = [];
  const applied: Array<{ value: string; quiet: boolean }> = [];
  const started: boolean[] = [];
  const settled: boolean[] = [];
  let active = 0;
  let peak = 0;
  const queue = createCoalescedRefresh({
    read: () => {
      const next = deferred<string>();
      reads.push(next);
      peak = Math.max(peak, ++active);
      return next.promise.finally(() => { active -= 1; });
    },
    apply: (value, quiet) => { applied.push({ value, quiet }); },
    onStart: (quiet) => { started.push(quiet); },
    onSettled: (quiet) => { settled.push(quiet); },
  });
  return { queue, reads, applied, started, settled, peak: () => peak };
}

test("slow initial load survives a burst of workflow events, followed by one quiet refresh", async () => {
  const f = fixture();
  const initial = f.queue.request();
  const updates = Array.from({ length: 30 }, () => f.queue.request(true));
  assert.equal(f.reads.length, 1, "SSE events must not start parallel Today requests");
  f.reads[0]!.resolve("initial content");
  await initial;
  assert.deepEqual(f.applied, [{ value: "initial content", quiet: false }], "quiet events must not invalidate initial content");
  assert.equal(f.reads.length, 2);
  f.reads[1]!.resolve("new background content");
  await Promise.all(updates);
  assert.deepEqual(f.applied[1], { value: "new background content", quiet: true });
  assert.equal(f.reads.length, 2);
  assert.equal(f.peak(), 1);
});

test("manual refresh keeps priority over quiet events and awaits a read started after the action", async () => {
  const f = fixture();
  const background = f.queue.request(true);
  const quiet = f.queue.request(true);
  let manualDone = false;
  const manual = f.queue.request().then(() => { manualDone = true; });
  const lateEvent = f.queue.request(true);
  f.reads[0]!.resolve("snapshot before action");
  await background;
  assert.equal(manualDone, false, "an explicit action cannot finish with an earlier snapshot");
  assert.equal(f.reads.length, 2);
  assert.deepEqual(f.started, [true, false], "manual mode dominates a queued quiet refresh");
  f.reads[1]!.resolve("snapshot after action");
  await Promise.all([manual, quiet, lateEvent]);
  assert.equal(manualDone, true);
  assert.deepEqual(f.applied.at(-1), { value: "snapshot after action", quiet: false });
  assert.equal(f.peak(), 1);
});

test("events during the trailing refresh request only one further read", async () => {
  const f = fixture();
  const initial = f.queue.request();
  const firstEvent = f.queue.request(true);
  f.reads[0]!.resolve("initial");
  await initial;
  const nextEvents = Array.from({ length: 20 }, () => f.queue.request(true));
  assert.equal(f.reads.length, 2);
  f.reads[1]!.resolve("first update");
  await firstEvent;
  assert.equal(f.reads.length, 3);
  f.reads[2]!.resolve("last update");
  await Promise.all(nextEvents);
  assert.equal(f.reads.length, 3);
  assert.equal(f.peak(), 1);
  assert.equal(f.applied.at(-1)?.value, "last update");
});

test("unmount settles waiting callers and prevents late state updates or queued reads", async () => {
  const f = fixture();
  const initial = f.queue.request();
  const queued = f.queue.request(true);
  f.queue.dispose();
  await Promise.all([initial, queued]);
  f.reads[0]!.resolve("late response");
  await tick();
  await f.queue.request();
  assert.deepEqual(f.applied, []);
  assert.deepEqual(f.settled, []);
  assert.equal(f.reads.length, 1);
});

test("a rejected read releases the queue and preserves the queued manual refresh", async () => {
  const f = fixture();
  const failed = assert.rejects(f.queue.request(true), /offline/u);
  const manual = f.queue.request();
  f.reads[0]!.reject(new Error("offline"));
  await failed;
  assert.equal(f.reads.length, 2);
  f.reads[1]!.resolve("recovered");
  await manual;
  assert.deepEqual(f.applied, [{ value: "recovered", quiet: false }]);
  assert.deepEqual(f.settled, [true, false]);
});
