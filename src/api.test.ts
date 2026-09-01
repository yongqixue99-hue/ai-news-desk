import assert from "node:assert/strict";
import test from "node:test";
import { api } from "./api.js";

test("portable archive inspection uploads the selected tar.gz as a raw dry-run request", async () => {
  const originalFetch = globalThis.fetch;
  const file = new File(["archive"], "mac-backup.tar.gz", { type: "application/gzip" });
  let captured: { input?: RequestInfo | URL; init?: RequestInit } = {};
  globalThis.fetch = async (input, init) => {
    captured = { input, init };
    return new Response(JSON.stringify({ valid: true, dryRun: true, imported: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const preview = await api.inspectPortableArchive(file);

    assert.equal(captured.input, "/api/data/archive/inspect");
    assert.equal(captured.init?.method, "POST");
    assert.equal(captured.init?.body, file);
    assert.equal(new Headers(captured.init?.headers).get("content-type"), "application/gzip");
    assert.equal(new Headers(captured.init?.headers).get("x-archive-filename"), encodeURIComponent(file.name));
    assert.equal(preview.imported, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("portable archive import reuploads the same file with the one-time confirmation token", async () => {
  const originalFetch = globalThis.fetch;
  const file = new File(["archive"], "mac-backup.tar.gz", { type: "application/gzip" });
  let captured: { input?: RequestInfo | URL; init?: RequestInit } = {};
  globalThis.fetch = async (input, init) => {
    captured = { input, init };
    return new Response(JSON.stringify({ ok: true, imported: true, reused: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await api.importPortableArchive(file, "one-time-token");
    assert.equal(captured.input, "/api/data/archive/import");
    assert.equal(captured.init?.method, "POST");
    assert.equal(captured.init?.body, file);
    assert.equal(new Headers(captured.init?.headers).get("x-archive-confirmation"), "one-time-token");
    assert.equal(result.imported, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
