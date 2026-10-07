import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultState } from "./defaults.js";
import { createBlankDraftInState } from "./draft-library.js";
import { createDeliveryBatchDesk, type DeliveryDriver } from "./delivery-batch-desk.js";
import { deliveryPlatforms, retryableDeliveryPlatforms, type DeliveryPlatform } from "./delivery-batch-types.js";

const fixture = () => {
  const state = createDefaultState();
  const draft = createBlankDraftInState(state);
  draft.title = "交付版本一";
  let clock = Date.parse("2026-10-02T00:00:00Z");
  const calls: DeliveryPlatform[] = [];
  const opened: DeliveryPlatform[][] = [];
  const drivers = {} as Record<DeliveryPlatform, DeliveryDriver>;
  for (const { id } of deliveryPlatforms) drivers[id] = {
    revision: value => value.title,
    inspect: async () => ({ ready: true, detail: "已连接", accountBinding: "account-one" }),
    deliver: async () => { calls.push(id); return { status: "verified", detail: "已核对" }; },
    recover: async () => undefined,
  };
  const dependencies = { read: async () => structuredClone(state), update: async <T>(mutate: (value: typeof state) => T) => mutate(state),
    drivers, now: () => clock, open: async (platforms: DeliveryPlatform[]) => { opened.push(platforms); } };
  return { state, draft, calls, opened, drivers, dependencies, desk: createDeliveryBatchDesk(dependencies),
    advance: (ms: number) => { clock += ms; } };
};

/** Keep polling during active time; one large jump represents suspension. */
const elapseWithTicks = async (f: ReturnType<typeof fixture>, duration: number) => {
  for (let elapsed = 0; elapsed < duration;) {
    const step = Math.min(20_000, duration - elapsed);
    f.advance(step); elapsed += step;
    await f.desk.tick();
  }
};

test("a twenty-minute suspension preserves an in-flight delivery until its active timeout", async () => {
  const f = fixture();
  let release!: () => void, signal: AbortSignal | undefined;
  const slow = new Promise<void>(resolve => { release = resolve; });
  f.drivers.wechat.deliver = async (_draft, _state, _target, cancellation) => {
    signal = cancellation; f.calls.push("wechat"); await slow;
    return { status: "verified", detail: "已核对" };
  };
  await f.desk.start(f.draft.id, ["wechat"], f.draft.updatedAt);
  const first = f.desk.tick();
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    f.advance(20 * 60_000);
    await f.desk.tick();
    assert.equal(f.draft.deliveryBatches![0].targets[0].status, "sending");
    assert.equal(signal?.aborted, false);
    assert.deepEqual(f.calls, ["wechat"]);
  } finally { release(); await first; }
  assert.equal(f.draft.deliveryBatches![0].targets[0].status, "verified");
});

test("suspension does not extend the ten-minute login expiry", async () => {
  const f = fixture();
  f.drivers.zhihu.inspect = async () => ({ ready: false, status: "waiting-login", detail: "等待登录" });
  const batch = await f.desk.start(f.draft.id, ["zhihu"], f.draft.updatedAt);
  await f.desk.tick();
  f.advance(20 * 60_000);
  await f.desk.tick();
  assert.equal(f.draft.deliveryBatches![0].expiresAt, batch.expiresAt);
  assert.equal(f.draft.deliveryBatches![0].targets[0].status, "failed");
  assert.match(f.draft.deliveryBatches![0].targets[0].detail, /超过 10 分钟/);
  assert.deepEqual(f.calls, []);
});

test("a slow platform does not delay another platform's login resumption", async () => {
  const f = fixture();
  let release!: () => void, signedIn = false, firstFinished = false;
  const slow = new Promise<void>(resolve => { release = resolve; });
  f.drivers.wechat.deliver = async () => { f.calls.push("wechat"); await slow; return { status: "verified", detail: "已核对" }; };
  f.drivers.baijiahao.inspect = async () => ({ ready: signedIn, status: "waiting-login", detail: "等待登录", accountBinding: "account-one" });
  await f.desk.start(f.draft.id, ["wechat", "baijiahao"], f.draft.updatedAt);
  const first = f.desk.tick().then(() => { firstFinished = true; });
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(f.draft.deliveryBatches![0].targets.find(target => target.platform === "baijiahao")?.status, "waiting-login");
    signedIn = true;
    await f.desk.tick();
    assert.equal(firstFinished, false);
    assert.deepEqual(f.calls, ["wechat", "baijiahao"]);
  } finally { release(); await first; }
});

test("sending timeout stays unknown and a late result cannot silently revive it", async () => {
  const f = fixture();
  let release!: () => void, signal: AbortSignal | undefined;
  const slow = new Promise<void>(resolve => { release = resolve; });
  f.drivers.wechat.deliver = async (_draft, _state, _target, cancellation) => {
    signal = cancellation; f.calls.push("wechat"); await slow;
    return { status: "verified", detail: "late response" };
  };
  const batch = await f.desk.start(f.draft.id, ["wechat"], f.draft.updatedAt);
  const first = f.desk.tick();
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    await elapseWithTicks(f, 10 * 60_000);
    assert.equal(f.draft.deliveryBatches![0].targets[0].status, "unknown");
    assert.equal(signal?.aborted, true);
    await assert.rejects(f.desk.start(f.draft.id, ["wechat"], f.draft.updatedAt, batch.id), /结果未知/);
  } finally { release(); await first; }
  assert.equal(f.draft.deliveryBatches![0].targets[0].status, "unknown");
  assert.deepEqual(f.calls, ["wechat"]);
});

test("a timed-out connection read cannot claim a write when it eventually returns", async () => {
  const f = fixture();
  let release!: () => void;
  const slow = new Promise<void>(resolve => { release = resolve; });
  f.drivers.zhihu.inspect = async () => { await slow; return { ready: true, detail: "late auth", accountBinding: "account-one" }; };
  await f.desk.start(f.draft.id, ["zhihu"], f.draft.updatedAt);
  const first = f.desk.tick();
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    f.advance(30_000);
    await f.desk.tick();
    assert.equal(f.draft.deliveryBatches![0].targets[0].status, "failed");
  } finally { release(); await first; }
  assert.deepEqual(f.calls, []);
});

test("a timeout receipt retries local persistence after a transient storage failure without another remote write", async () => {
  const f = fixture(); let release!: () => void, fail = false;
  const slow = new Promise<void>(resolve => { release = resolve; });
  f.drivers.wechat.deliver = async () => { f.calls.push("wechat"); await slow; return { status: "verified", detail: "late" }; };
  const update = f.dependencies.update;
  f.dependencies.update = async mutate => { if (fail) { fail = false; throw new Error("storage busy"); } return update(mutate); };
  await f.desk.start(f.draft.id, ["wechat"], f.draft.updatedAt);
  const first = f.desk.tick();
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    await elapseWithTicks(f, 10 * 60_000 - 20_000);
    f.advance(20_000); fail = true;
    await assert.rejects(f.desk.tick(), /storage busy/);
    await f.desk.tick();
    assert.equal(f.draft.deliveryBatches![0].targets[0].status, "unknown");
    assert.deepEqual(f.calls, ["wechat"]);
  } finally { release(); await first; }
});

test("one saved version fans out independently; duplicate clicks share one persisted batch", async () => {
  const f = fixture();
  f.drivers.zhihu.deliver = async () => { f.calls.push("zhihu"); return { status: "failed", detail: "图片未上传" }; };
  const first = await f.desk.start(f.draft.id, ["wechat", "xiaoheihe", "zhihu"], f.draft.updatedAt);
  const duplicate = await f.desk.start(f.draft.id, ["wechat", "xiaoheihe", "zhihu"], f.draft.updatedAt);
  assert.equal(first.id, duplicate.id);
  assert.equal(f.opened.length, 1);
  await f.desk.tick();
  assert.equal(f.calls.length, 3);
  assert.equal(f.draft.deliveryBatches![0]!.targets.filter(target => target.status === "verified").length, 2);
  assert.equal(f.draft.deliveryBatches![0]!.targets.find(target => target.platform === "zhihu")?.status, "failed");
  await assert.rejects(f.desk.start(f.draft.id, ["wechat"], f.draft.updatedAt, first.id), /仅可重试/);
  await f.desk.start(f.draft.id, ["zhihu"], f.draft.updatedAt, first.id);
  await f.desk.tick();
  assert.deepEqual(f.calls, ["wechat", "xiaoheihe", "zhihu", "zhihu"]);
});

test("login waiting resumes automatically but a changed saved version is never delivered", async () => {
  const f = fixture();
  let signedIn = false;
  f.drivers.baijiahao.inspect = async () => ({ ready: signedIn, status: "waiting-login", detail: "等待登录", accountBinding: "account-one" });
  await f.desk.start(f.draft.id, ["baijiahao"], f.draft.updatedAt);
  await f.desk.tick();
  await f.desk.tick();
  assert.equal(f.draft.deliveryBatches![0]!.targets[0]!.status, "waiting-login");
  assert.equal(f.calls.length, 0);
  signedIn = true;
  f.draft.title = "交付版本二";
  await f.desk.tick();
  assert.equal(f.draft.deliveryBatches![0]!.targets[0]!.status, "failed");
  assert.equal(f.calls.length, 0);
  await f.desk.start(f.draft.id, ["baijiahao"], f.draft.updatedAt);
  await f.desk.tick();
  assert.deepEqual(f.calls, ["baijiahao"]);
});

test("restart recovery only reads evidence; missing receipts and failed reads stay unknown", async () => {
  for (const mode of ["found", "missing", "read-failed"]) {
    const f = fixture();
    await f.desk.start(f.draft.id, ["wechat"], f.draft.updatedAt);
    f.draft.deliveryBatches![0]!.targets[0]!.status = "sending";
    f.drivers.wechat.recover = async () => {
      if (mode === "read-failed") throw new Error("network unavailable");
      return mode === "found" ? { status: "verified", detail: "已恢复原回执" } : undefined;
    };
    const restarted = createDeliveryBatchDesk(f.dependencies);
    await restarted.tick();
    assert.equal(f.calls.length, 0);
    assert.equal(f.draft.deliveryBatches![0]!.targets[0]!.status, mode === "found" ? "verified" : "unknown");
    if (mode !== "found") await assert.rejects(restarted.start(f.draft.id, ["wechat"], f.draft.updatedAt, f.draft.deliveryBatches![0]!.id), /结果未知/);
  }
});

test("cancelled waiting targets do not send, and the expiration limit stops stale login tasks", async () => {
  const f = fixture();
  f.drivers.zhihu.inspect = async () => ({ ready: false, status: "waiting-connection", detail: "等待同步助手" });
  const batch = await f.desk.start(f.draft.id, ["zhihu"], f.draft.updatedAt);
  await f.desk.tick();
  await f.desk.cancel(f.draft.id, batch.id);
  await f.desk.tick();
  assert.equal(f.draft.deliveryBatches![0]!.targets[0]!.status, "cancelled");
  await f.desk.start(f.draft.id, ["zhihu"], f.draft.updatedAt, batch.id);
  f.advance(10 * 60_000);
  await f.desk.tick();
  assert.equal(f.draft.deliveryBatches![0]!.targets[0]!.status, "failed");
  assert.equal(f.calls.length, 0);
});

test("a remote mutation that throws without conclusive evidence cannot become a retryable failure", async () => {
  const f = fixture();
  f.drivers.wechat.deliver = async () => { f.calls.push("wechat"); throw new Error("response lost"); };
  await f.desk.start(f.draft.id, ["wechat"], f.draft.updatedAt);
  await f.desk.tick();
  assert.equal(f.draft.deliveryBatches![0]!.targets[0]!.status, "unknown");
  await f.desk.tick();
  assert.equal(f.calls.length, 1);
});

test("manual resolution unlocks only the confirmed failure and idle polling uses the small projection", async () => {
  const f = fixture();
  const batch = await f.desk.start(f.draft.id, ["zhihu", "toutiao"], f.draft.updatedAt);
  f.draft.deliveryBatches![0]!.targets.forEach(target => { target.status = "unknown"; });
  f.drivers.zhihu.recover = async () => ({ status: "failed", detail: "用户已确认未收到" });
  await f.desk.reconcile(f.draft.id);
  assert.deepEqual(retryableDeliveryPlatforms(f.draft.deliveryBatches![0]), ["zhihu"]);
  assert.equal(f.calls.length, 0);
  await f.desk.start(f.draft.id, ["zhihu"], f.draft.updatedAt, batch.id);
  let fullReads = 0;
  await createDeliveryBatchDesk({ ...f.dependencies, pending: async () => [], read: async () => { fullReads++; return f.state; } }).tick();
  assert.equal(fullReads, 0);
});

test("an account identified when the user selected delivery cannot silently switch while waiting", async () => {
  const f = fixture();
  await f.desk.start(f.draft.id, ["zhihu"], f.draft.updatedAt, undefined, { zhihu: "account-one" });
  f.drivers.zhihu.inspect = async () => ({ ready: true, detail: "已登录其他账号", accountBinding: "account-two" });
  await f.desk.tick();
  assert.equal(f.calls.length, 0);
  assert.match(f.draft.deliveryBatches![0]!.targets[0]!.detail, /账号已变化/);
});
