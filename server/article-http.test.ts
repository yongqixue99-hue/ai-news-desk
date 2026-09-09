import assert from "node:assert/strict";
import test from "node:test";
import { fetchArticleDocument } from "./extractor.js";

test("article retrieval survives the public-site rejection reproduced for the old reader identity", async () => {
  const response = await fetchArticleDocument(new URL("https://openai.com/index/introducing-chatgpt-images-2-5/"), {
    fetcher: async (_url, init) => {
      const userAgent = new Headers(init?.headers).get("user-agent") ?? "";
      return /AI-News-Desk/iu.test(userAgent)
        ? new Response("request rejected", { status: 403 })
        : new Response("<article>Original source body</article>", { status: 200 });
    },
  });
  assert.equal(response.status, 200, "a readable public article must reach extraction instead of repeating the rejected request");
});

test("reader still returns genuine access failures for the caller to handle", async () => {
  const response = await fetchArticleDocument(new URL("https://example.com/article"), { language: "en-US,en;q=0.9",
    fetcher: async (_url, init) => { assert.equal(new Headers(init?.headers).get("accept-language"), "en-US,en;q=0.9"); return new Response("", { status: 403 }); },
  });
  assert.equal(response.status, 403);
});
