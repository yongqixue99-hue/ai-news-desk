import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("an invalidated content bridge stops polling after the extension reloads", async () => {
  const script = await readFile(new URL("./app-bridge.js", import.meta.url), "utf8");
  const runtime = { id: "extension-id", getManifest: () => ({ version: "0.1.24" }) };
  let requests = 0;
  const context = vm.createContext({
    chrome: { runtime }, URL, window: { location: { href: "http://127.0.0.1:4317/" } },
    document: { addEventListener() {} }, setInterval() {}, console,
    fetch: async () => { requests++; return { ok: false, status: 503 }; },
  });
  vm.runInContext(script, context);
  await new Promise(resolve => setImmediate(resolve));
  requests = 0;
  runtime.id = "";
  await context.bridgeTick();
  assert.equal(requests, 0, "a stale bridge must not claim work or send misleading heartbeats");
});

for (const failure of ["network", "http", "negative-ack"] as const) {
  test(`the content bridge retries a ${failure} receipt failure without claiming or filling again`, async () => {
    const script = await readFile(new URL("./app-bridge.js", import.meta.url), "utf8");
    let claims = 0;
    let runs = 0;
    const reports: string[] = [];
    const context = vm.createContext({
      chrome: { runtime: {
        id: "extension-id", getManifest: () => ({ version: "0.1.24" }),
        sendMessage: async () => { runs++; return { steps: [{ name: "正文", ok: true, detail: "已填好" }] }; },
      } },
      URL, window: { location: { href: "http://127.0.0.1:4317/" } },
      document: { addEventListener() {} }, setInterval() {}, console: { warn() {} },
      fetch: async (input: string, init?: RequestInit) => {
        const path = new URL(input).pathname;
        if (path.endsWith("/bootstrap")) return Response.json({ token: "paired" });
        if (path.endsWith("/heartbeat")) return Response.json({ ok: true });
        if (path.endsWith("/jobs/next")) return ++claims === 1
          ? Response.json({ id: "receipt", editorUrl: "https://xiaoheihe.cn/editor" })
          : new Response(null, { status: 204 });
        reports.push(String(init?.body));
        if (reports.length === 1) {
          if (failure === "network") throw new Error("network reset");
          if (failure === "http") return new Response(null, { status: 503 });
          return Response.json({ ok: false });
        }
        return Response.json({ ok: true });
      },
    });
    vm.runInContext(script, context);
    await new Promise(resolve => setImmediate(resolve));
    await context.bridgeTick();
    assert.equal(reports.length, 2);
    assert.equal(reports[0], reports[1]);
    assert.equal(runs, 1);
    assert.equal(claims, 1);
  });
}

test("a gone content-bridge job no longer blocks a new user request or reruns the old fill", async () => {
  const script = await readFile(new URL("./app-bridge.js", import.meta.url), "utf8");
  const ran: string[] = [];
  const warnings: string[] = [];
  let claims = 0;
  let reports = 0;
  const context = vm.createContext({
    chrome: { runtime: {
      id: "extension-id", getManifest: () => ({ version: "0.1.25" }),
      sendMessage: async (message: { job: { id: string } }) => {
        ran.push(message.job.id);
        return { steps: [{ name: "正文", ok: true, detail: "已填好" }] };
      },
    } },
    URL, window: { location: { href: "http://127.0.0.1:4317/" } },
    document: { addEventListener() {} }, setInterval() {},
    console: { warn: (...messages: unknown[]) => warnings.push(messages.map(String).join(" ")) },
    fetch: async (input: string) => {
      const path = new URL(input).pathname;
      if (path.endsWith("/bootstrap")) return Response.json({ token: "paired" });
      if (path.endsWith("/heartbeat")) return Response.json({ ok: true });
      if (path.endsWith("/jobs/next")) return Response.json({
        id: ++claims === 1 ? "old" : "new", editorUrl: "https://xiaoheihe.cn/editor",
      });
      if (++reports === 1) return new Response(null, { status: 503 });
      if (reports === 2) return new Response(null, { status: 410 });
      return Response.json({ ok: true });
    },
  });
  vm.runInContext(script, context);
  await new Promise(resolve => setImmediate(resolve));
  await context.bridgeTick();
  assert.match(warnings.join(" "), /任务已结束.*不要重复填入/);
  await context.bridgeTick();
  assert.deepEqual(ran, ["old", "new"]);
  assert.equal(claims, 2);
  assert.equal(reports, 3);
});
