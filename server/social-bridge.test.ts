import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:net";
import { once } from "node:events";
import { WebSocket } from "ws";
import { SocialBridge } from "./social-bridge.js";
const extensionId = "a".repeat(32);
const token = "test-only-token-not-a-credential";
const freePort = async () => {
  const server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error("port missing");
  await new Promise<void>(resolve => server.close(() => resolve())); return address.port;
};
test("bridge rejects web origins and other extensions, authenticates allowed protocol requests", async () => {
  const port = await freePort(); const bridge = new SocialBridge(port, 1000);
  await bridge.start(extensionId, token);
  try {
    for (const origin of ["https://evil.test", `chrome-extension://${"b".repeat(32)}`]) {
      const socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin });
      await assert.rejects(once(socket, "open"), /401/); socket.terminate();
    }
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin: `chrome-extension://${extensionId}` });
    await once(socket, "open");
    socket.on("message", data => { const request = JSON.parse(data.toString()); assert.equal(request.token, token); assert.equal(request.method, "listPlatforms"); socket.send(JSON.stringify({ id: request.id, result: [{ id: "zhihu" }] })); });
    assert.deepEqual(await bridge.request("listPlatforms"), [{ id: "zhihu" }]);
    assert.equal(bridge.connected, true);
  } finally { await bridge.stop(); }
});
test("disconnect and timeouts reject pending work without replaying", async () => {
  const port = await freePort(); const bridge = new SocialBridge(port, 30);
  await bridge.start(extensionId, token);
  try {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin: `chrome-extension://${extensionId}` }); await once(socket, "open");
    await assert.rejects(bridge.request("checkAuth"), /超时/);
    const pending = bridge.request("syncArticle"); socket.close(); await assert.rejects(pending, /中断/);
  } finally { await bridge.stop(); }
});
