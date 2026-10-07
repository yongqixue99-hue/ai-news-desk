import assert from "node:assert/strict";
import test from "node:test";
import { evaluateLocalRequest } from "./http-security.js";
import { createLocalSecurityMiddleware } from "./http-security.js";
import express from "express";
import { once } from "node:events";
import { ExtensionPublisherBridge, MINIMUM_EXTENSION_VERSION } from "./publisher-extension.js";

test("local API guard rejects DNS rebinding hosts and cross-origin mutations", () => {
  assert.deepEqual(evaluateLocalRequest({
    host: "attacker.example",
    method: "GET",
    port: 4317,
  }), { allowed: false, reason: "host" });
  assert.deepEqual(evaluateLocalRequest({
    host: "127.0.0.1:4317",
    origin: "https://attacker.example",
    method: "POST",
    port: 4317,
  }), { allowed: false, reason: "origin" });
});

test("local API guard allows same-origin browser calls and originless local automation", () => {
  assert.deepEqual(evaluateLocalRequest({
    host: "127.0.0.1:4317",
    origin: "http://127.0.0.1:4317",
    method: "PATCH",
    port: 4317,
  }), { allowed: true });
  assert.deepEqual(evaluateLocalRequest({
    host: "localhost:4317",
    method: "POST",
    port: 4317,
  }), { allowed: true });
});

test("the installed extension can pair and return a job through the real local HTTP guard", async () => {
  const bridge = new ExtensionPublisherBridge();
  const app = express();
  let port = 0;
  app.use((req, res, next) => createLocalSecurityMiddleware(port, {
    publisherExtensionToken: () => bridge.token,
  })(req, res, next));
  app.use(express.json());
  app.get("/api/publisher/extension/bootstrap", (_req, res) => res.json(bridge.bootstrap()));
  app.post("/api/publisher/extension/heartbeat", (req, res) => res.json(bridge.heartbeat(req.get("x-ai-news-extension-token"), req.body.clientId, req.body.version)));
  app.post("/api/publisher/extension/jobs/:id/result", (_req, res) => res.json({ ok: true }));
  app.post("/api/settings", (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  port = address.port;
  const origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
  const base = `http://127.0.0.1:${port}`;
  try {
    const pair = await fetch(`${base}/api/publisher/extension/bootstrap`, { headers: { origin } });
    const { token } = await pair.json();
    const headers = { origin, "content-type": "application/json", "x-ai-news-extension-token": token };
    const heartbeat = await fetch(`${base}/api/publisher/extension/heartbeat`, { method: "POST", headers,
      body: JSON.stringify({ clientId: "abcdefghijklmnopabcdefghijklmnop", version: MINIMUM_EXTENSION_VERSION }) });
    assert.equal(heartbeat.status, 200, await heartbeat.text());
    assert.equal(bridge.status().ok, true);
    const result = await fetch(`${base}/api/publisher/extension/jobs/fill_test/result`, { method: "POST", headers, body: "{}" });
    assert.equal(result.status, 200);
    for (const [pathname, overrides] of [
      ["/api/settings", {}],
      ["/api/publisher/extension/heartbeat", { "x-ai-news-extension-token": "invalid" }],
      ["/api/publisher/extension/heartbeat", { "x-ai-news-extension-token": "" }],
      ["/api/publisher/extension/heartbeat", { origin: "https://attacker.example" }],
      ["/api/publisher/extension/heartbeat", { origin: `${origin}.attacker.example` }],
    ] as const) {
      const rejected = await fetch(`${base}${pathname}`, { method: "POST", headers: { ...headers, ...overrides }, body: "{}" });
      assert.equal(rejected.status, 403, pathname);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
