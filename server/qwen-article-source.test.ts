import assert from "node:assert/strict";
import test from "node:test";
import { load } from "cheerio";
import { maximumOfficialIndexBytes, qwenOfficialIndexUrl } from "./official-news-index.js";
import { parseQwenArticleSource, readQwenArticleSource } from "./qwen-article-source.js";

const url = "https://qwen.ai/blog?id=e-commerce-bench";
const content = '<!doctype html><html><head><link rel="canonical" href="https://qwenlm.github.io/zh/blog/e-commerce-bench/"></head><body><nav>Another model release</nav><main><article><div class="post-content"><p>Long-running tasks use a continuing evaluation environment.</p><figure><img src="https://images.example/chart.png" alt="Task results"><figcaption>Batch size 1; 5 runs.</figcaption></figure><table><caption>Evaluation settings</caption><thead><tr><th>Tasks</th><th>Runs</th></tr></thead><tbody><tr><td>Retail</td><td>5</td></tr></tbody></table><svg><text>Evaluation chart</text></svg></div></article></main><footer>Other stories</footer></body></html>';
const article = { title: "E-Commerce Bench：长程经营，多维评估", path: "e-commerce-bench", content, extra: { date: "2026-09-03T10:00:00+08:00", author: "QwenTeam" } };
const payload = (articles: unknown[] = [article]) => JSON.stringify({ data: { articles } });
const response = (body = payload(), init: ResponseInit = {}) => new Response(body, { ...init, headers: { "content-type": "application/json", ...Object.fromEntries(new Headers(init.headers)) } });
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("the selected official article retains its body, chart conditions and original query identity", () => {
  const source = parseQwenArticleSource(payload([article, { ...article, path: "other-model", title: "Other model", content: "<p>Unrelated benchmark claims.</p>" }]), url)!;
  const $ = load(source.html);
  assert.equal(source.canonicalUrl, url);
  assert.equal(source.title, article.title);
  assert.equal(source.publishedAt, "2026-09-03T02:00:00.000Z");
  assert.equal(source.author, "QwenTeam");
  assert.equal($("article").length, 1);
  assert.equal($("article").attr("data-source-url"), url);
  assert.equal($("h1").text(), article.title);
  assert.equal($("figure figcaption").text(), "Batch size 1; 5 runs.");
  assert.equal($("table caption").text(), "Evaluation settings");
  assert.equal($("svg text").text(), "Evaluation chart");
  assert.equal($("img").attr("src"), "https://images.example/chart.png");
  assert.equal(source.html.includes("Unrelated benchmark"), false);
  assert.equal(source.html.includes("Other stories"), false);
  assert.equal(source.html.includes("qwenlm.github.io"), false);
});

test("non-allowlisted blog addresses are ignored without requesting the index", async () => {
  let calls = 0;
  const fetcher = async () => { calls += 1; return response(); };
  for (const address of ["http://qwen.ai/blog?id=e-commerce-bench", "https://qwen.ai.evil.example/blog?id=e-commerce-bench", "https://qwen.ai/blog?id=../other", "https://qwen.ai/blog?id=e-commerce-bench&id=other", "https://qwen.ai/blog?id=e-commerce-bench&target=other", "https://qwen.ai/research", "https://qwen.ai:444/blog?id=e-commerce-bench"]) {
    assert.equal(await readQwenArticleSource(address, { fetcher }), undefined);
    assert.equal(parseQwenArticleSource("not JSON", address), undefined);
  }
  assert.equal(calls, 0);
  assert.equal(parseQwenArticleSource(payload(), `${url}&utm_source=news#evaluation`)?.canonicalUrl, url);
});

test("duplicate or absent slug matches fail rather than selecting another article", () => {
  assert.throws(() => parseQwenArticleSource(payload([article, { ...article, path: " e-commerce-bench " }]), url), /不唯一/);
  assert.throws(() => parseQwenArticleSource(payload([{ ...article, path: "different-slug" }]), url), /未找到/);
  assert.throws(() => parseQwenArticleSource('{"data":{}}', url), /格式/);
});

test("non-HTML, empty, ambiguous, or shell content cannot masquerade as article text", () => {
  for (const invalid of ["Plain prose is not the promised HTML source", "{\"content\":\"other article\"}", { html: "<p>Wrong type</p>" }, "<p></p>", "<script>globalThis.executed = true</script>", "<html><body><main>Loading a blog...</main></body></html>", "<article><p>One</p></article><article><p>Two</p></article>"]) {
    assert.throws(() => parseQwenArticleSource(payload([{ ...article, content: invalid }]), url), /正文/);
  }
});

test("HTML fragments are wrapped and titles are escaped rather than executed", () => {
  const source = parseQwenArticleSource(payload([{ ...article, title: "Model <2 & 3>", content: "<p>A bounded article body.</p>" }]), url)!;
  assert.equal(load(source.html)("h1").text(), "Model <2 & 3>");
  assert.equal(source.html.includes("<h1>Model <2"), false);
});

test("referenced aside footnotes reach the shared article reader without being stripped by the index adapter", () => {
  const source = parseQwenArticleSource(payload([{ ...article, content: '<article><p>Evaluation score 80<sup><a href="#fn-budget">1</a></sup>.</p><aside class="footnotes"><p id="fn-budget" role="doc-footnote">Five runs; 10-token budget.</p></aside></article>' }]), url)!;
  assert.equal(load(source.html)("#fn-budget").text(), "Five runs; 10-token budget.");
});

test("invalid or missing publication dates stay unknown", () => {
  for (const date of [undefined, "not a date", "2026-02-30", "2026-09-03T10:00:00"]) {
    assert.equal(parseQwenArticleSource(payload([{ ...article, extra: { date } }]), url)?.publishedAt, undefined);
  }
});

test("the offline parser enforces the same bounded official-index size", () => {
  assert.throws(() => parseQwenArticleSource(payload() + " ".repeat(maximumOfficialIndexBytes), url), /超过允许大小/);
});

test("read uses only the fixed official endpoint and rejects unexpected redirects", async () => {
  const endpoints: string[] = [];
  const source = await readQwenArticleSource(url, { fetcher: async (endpoint) => { endpoints.push(endpoint); return response(); } });
  assert.equal(source?.canonicalUrl, url);
  assert.deepEqual(endpoints, [qwenOfficialIndexUrl]);
  await assert.rejects(readQwenArticleSource(url, { fetcher: async () => response("", { status: 302, headers: { location: "https://elsewhere.example/index" } }) }), /重定向/);
  await assert.rejects(readQwenArticleSource(url, { fetcher: async () => {
    const result = response();
    Object.defineProperty(result, "url", { value: "https://elsewhere.example/index" });
    return result;
  } }), /重定向/);
});

test("HTTP error, non-JSON transport and oversize bodies fail without exposing response content", async () => {
  await assert.rejects(readQwenArticleSource(url, { fetcher: async () => response("private-error-detail", { status: 503 }) }), /HTTP 503/);
  await assert.rejects(readQwenArticleSource(url, { fetcher: async () => new Response("private-error-detail", { headers: { "content-type": "text/html" } }) }), /JSON/);
  await assert.rejects(readQwenArticleSource(url, { fetcher: async () => response(payload(), { headers: { "content-length": String(maximumOfficialIndexBytes + 1) } }) }), /超过允许大小/);
});

test("concurrent article readers share one index fetch and subsequent reads fetch again", async () => {
  let calls = 0;
  const fetcher = async () => { calls += 1; await tick(); return response(payload([article, { ...article, path: "other-model", title: "Other model", content: "<p>A different article.</p>" }])); };
  const [first, second] = await Promise.all([readQwenArticleSource(url, { fetcher }), readQwenArticleSource("https://qwen.ai/blog?id=other-model", { fetcher })]);
  assert.equal(calls, 1);
  assert.equal(first?.title, article.title);
  assert.equal(second?.title, "Other model");
  await readQwenArticleSource(url, { fetcher });
  assert.equal(calls, 2);
});

test("one cancelled reader does not cancel another consumer of the same in-flight index", async () => {
  const controller = new AbortController();
  let release!: () => void;
  let fetchSignal: AbortSignal | undefined;
  const fetcher = async (_endpoint: string, init: RequestInit) => {
    fetchSignal = init.signal ?? undefined;
    await new Promise<void>((resolve) => { release = resolve; });
    return response();
  };
  const cancelled = readQwenArticleSource(url, { fetcher, signal: controller.signal });
  const cancellation = assert.rejects(cancelled, { name: "AbortError" });
  const remaining = readQwenArticleSource(url, { fetcher });
  await tick();
  controller.abort();
  await cancellation;
  assert.equal(fetchSignal?.aborted, false);
  release();
  assert.equal((await remaining)?.title, article.title);
});

test("cancelling the last consumer aborts the outstanding fetch", async () => {
  const controller = new AbortController();
  let fetchSignal: AbortSignal | undefined;
  const fetcher = async (_endpoint: string, init: RequestInit) => {
    fetchSignal = init.signal ?? undefined;
    await new Promise<void>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true }));
    return response();
  };
  const pending = readQwenArticleSource(url, { fetcher, signal: controller.signal });
  const cancellation = assert.rejects(pending, { name: "AbortError" });
  await tick();
  controller.abort();
  await cancellation;
  assert.equal(fetchSignal?.aborted, true);
});
