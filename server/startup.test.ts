import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadOptionalMaterialLibraryCatalog } from "./material-library-seed.js";
import { startOwnedServer } from "./startup.js";

class FakeServer extends EventEmitter {
  listening = false;
}

test("a process that cannot bind the port never initializes persisted state, recovers runs, or starts the scheduler", async () => {
  const calls: string[] = [];
  const server = new FakeServer();
  const initializePersistedWorkspace = async () => { calls.push("persistent-init-and-seed"); };
  const startup = startOwnedServer({
    listen: () => {
      calls.push("listen");
      queueMicrotask(() => server.emit("error", Object.assign(new Error("address in use"), { code: "EADDRINUSE" })));
      return server;
    },
    recoverInterruptedRuns: async () => {
      await initializePersistedWorkspace();
      calls.push("recover");
    },
    startScheduler: () => { calls.push("scheduler"); },
  });

  await assert.rejects(startup, /address in use/);
  assert.deepEqual(calls, ["listen"]);
});

test("run recovery starts only after this process owns the listening port", async () => {
  const calls: string[] = [];
  const server = new FakeServer();
  const initializePersistedWorkspace = async () => { calls.push("persistent-init-and-seed"); };
  await startOwnedServer({
    listen: () => {
      calls.push("listen");
      queueMicrotask(() => {
        server.listening = true;
        server.emit("listening");
      });
      return server;
    },
    recoverInterruptedRuns: async () => {
      await initializePersistedWorkspace();
      calls.push("recover");
    },
    startScheduler: () => { calls.push("scheduler"); },
  });

  assert.deepEqual(calls, ["listen", "persistent-init-and-seed", "recover", "scheduler"]);
});

test("an owned server still recovers and starts scheduling when the optional seed catalog is missing", async () => {
  const calls: string[] = [];
  const server = new FakeServer();
  const missingCatalog = path.join(tmpdir(), `ai-news-missing-catalog-${process.pid}-${Date.now()}.json`);
  await startOwnedServer({
    listen: () => {
      calls.push("listen");
      queueMicrotask(() => {
        server.listening = true;
        server.emit("listening");
      });
      return server;
    },
    recoverInterruptedRuns: async () => {
      const optional = await loadOptionalMaterialLibraryCatalog(missingCatalog);
      if (optional.warning) calls.push("seed-warning");
      calls.push("recover");
    },
    startScheduler: () => { calls.push("scheduler"); },
  });

  assert.deepEqual(calls, ["listen", "seed-warning", "recover", "scheduler"]);
});
