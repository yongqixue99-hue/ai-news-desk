import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { startOwnedServer } from "./startup.js";

class FakeServer extends EventEmitter {
  listening = false;
}

test("a process that cannot bind the port never recovers runs or starts the scheduler", async () => {
  const calls: string[] = [];
  const server = new FakeServer();
  const startup = startOwnedServer({
    listen: () => {
      calls.push("listen");
      queueMicrotask(() => server.emit("error", Object.assign(new Error("address in use"), { code: "EADDRINUSE" })));
      return server;
    },
    recoverInterruptedRuns: async () => { calls.push("recover"); },
    startScheduler: () => { calls.push("scheduler"); },
  });

  await assert.rejects(startup, /address in use/);
  assert.deepEqual(calls, ["listen"]);
});

test("run recovery starts only after this process owns the listening port", async () => {
  const calls: string[] = [];
  const server = new FakeServer();
  await startOwnedServer({
    listen: () => {
      calls.push("listen");
      queueMicrotask(() => {
        server.listening = true;
        server.emit("listening");
      });
      return server;
    },
    recoverInterruptedRuns: async () => { calls.push("recover"); },
    startScheduler: () => { calls.push("scheduler"); },
  });

  assert.deepEqual(calls, ["listen", "recover", "scheduler"]);
});
