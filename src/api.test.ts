import assert from "node:assert/strict";
import test from "node:test";
import { api } from "./api.js";

test("human-first drafting uses the synchronous package endpoint without requesting AI generation", async () => {
  const originalFetch = globalThis.fetch;
  let captured: { input?: RequestInfo | URL; init?: RequestInit } = {};
  globalThis.fetch = async (input, init) => {
    captured = { input, init };
    return Response.json({
      reused: false,
      draft: {
        id: "draft-human-first",
        provenance: { authoringMode: "human-first" },
      },
    });
  };
  try {
    const result = await api.createHumanDraftFromPackage("package with spaces");

    assert.equal(captured.input, "/api/packages/package%20with%20spaces/human-draft");
    assert.equal(captured.init?.method, "POST");
    assert.equal(result.draft.id, "draft-human-first");
    assert.equal(result.reused, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("draft inline completion sends only cursor context and forwards cancellation", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let captured: { input?: RequestInfo | URL; init?: RequestInit } = {};
  globalThis.fetch = async (input, init) => {
    captured = { input, init };
    return Response.json({ available: true, text: "补全一句。" });
  };
  try {
    const result = await api.completeDraftInline(
      "draft/with spaces",
      { before: "光标前", after: "光标后" },
      controller.signal,
    );

    assert.equal(captured.input, "/api/drafts/draft%2Fwith%20spaces/completions");
    assert.equal(captured.init?.method, "POST");
    assert.equal(captured.init?.signal, controller.signal);
    assert.deepEqual(JSON.parse(String(captured.init?.body)), { before: "光标前", after: "光标后" });
    assert.deepEqual(result, { available: true, text: "补全一句。" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("draft inline completion parses streamed previews and resolves only the final checked result", async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  const previews: string[] = [];
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('event: preview\ndata: {"text":"先看到半句","providerName":"DeepSeek"}\n'));
      controller.enqueue(encoder.encode('\nevent: final\ndata: {"available":true,"text":"最终完整一句。","providerName":"DeepSeek","model":"deepseek-v4-flash"}\n\n'));
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } });
  try {
    const result = await api.completeDraftInline(
      "draft-stream",
      { before: "光标前", after: "" },
      new AbortController().signal,
      (preview) => previews.push(preview.text),
    );

    assert.deepEqual(previews, ["先看到半句"]);
    assert.deepEqual(result, {
      available: true,
      text: "最终完整一句。",
      providerName: "DeepSeek",
      model: "deepseek-v4-flash",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the completion provider can be assigned independently from long-form Agent roles", async () => {
  const originalFetch = globalThis.fetch;
  let captured: { input?: RequestInfo | URL; init?: RequestInit } = {};
  globalThis.fetch = async (input, init) => {
    captured = { input, init };
    return Response.json({ completionProviderId: "deepseek", providers: [] });
  };
  try {
    const result = await api.saveCompletionProvider("deepseek");

    assert.equal(captured.input, "/api/ai/completion-provider");
    assert.equal(captured.init?.method, "PATCH");
    assert.deepEqual(JSON.parse(String(captured.init?.body)), { providerId: "deepseek" });
    assert.equal(result.completionProviderId, "deepseek");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("manual X intake posts only the user-copied evidence to the free intake endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let captured: { input?: RequestInfo | URL; init?: RequestInit } = {};
  globalThis.fetch = async (input, init) => {
    captured = { input, init };
    return Response.json({ review: { id: "intake-x" } }, { status: 201 });
  };
  try {
    const result = await api.intakeXPost(
      "https://x.com/OpenAI/status/123",
      "Copied public post body with enough detail.",
      "@OpenAI",
    );

    assert.equal(captured.input, "/api/intakes/x-post");
    assert.equal(captured.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(captured.init?.body)), {
      url: "https://x.com/OpenAI/status/123",
      text: "Copied public post body with enough detail.",
      author: "@OpenAI",
    });
    assert.equal(result.review.id, "intake-x");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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
