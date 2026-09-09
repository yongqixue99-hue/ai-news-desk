import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SourceConfig } from "./types.js";
import {
  deepseekOfficialUpdatesUrl, geminiOfficialChangelogUrl,
  maximumOfficialUpdateBytes, parseDeepSeekOfficialUpdates, parseGeminiOfficialChangelog,
  extractOfficialUpdateSection,
  parseClaudeOfficialFeed, claudeOfficialFeedUrl, claudeOfficialChangelogUrl,
} from "./official-update-index.js";

const now = "2026-09-08T02:00:00.000Z";
const source = (id: string): SourceConfig => ({ id, name: id, kind: "rss", enabled: true,
  selected: true, category: "AI", role: "official", discoveryOnly: false });
const deepseek = source("deepseek-official");
const gemini = source("gemini-official");
const fixture = (name: string) => readFileSync(new URL(`./fixtures/official-update-${name}.html`, import.meta.url), "utf8");
const deepseekPage = (body: string) => `<main><article><div class="theme-doc-markdown"><div class="row"><div class="col">${body}</div></div></div></article></main>`;
const geminiPage = (body: string) => `<main><article><div class="devsite-article-body">${body}</div></article></main>`;

test("Claude RSS requires agreement between the calendar label, pubDate and official section URL", () => {
  const rss = (title: string, date: string, url: string) => `<rss><channel><item><title>${title}</title><pubDate>${date}</pubDate><link>${url}</link>
    <description><![CDATA[<ul><li>We've launched Claude Fable 5.1.</li></ul>]]></description></item></channel></rss>`;
  const title = "Claude Platform release notes — September 1, 2026";
  const date = "Tue, 01 Sep 2026 00:00:00 GMT";
  const url = `${claudeOfficialChangelogUrl}#september-1-2026`;
  const valid = parseClaudeOfficialFeed(rss(title, date, url), source("Anthropic"), now)[0];
  assert.equal(valid.metadata?.feed_url, claudeOfficialFeedUrl);
  assert.equal(valid.metadata?.date_precision, "day");
  for (const body of [rss(title, "Wed, 02 Sep 2026 00:00:00 GMT", url),
    rss(title, date, `${claudeOfficialChangelogUrl}#september-2-2026`),
    rss(title, date, "https://evil.example/#september-1-2026"),
    rss("Claude Platform release notes — February 30, 2026", date, url),
    rss(title, "not-a-date", url)]) {
    assert.throws(() => parseClaudeOfficialFeed(body, source("Anthropic"), now), /日期条目/u);
  }
});

test("Claude evidence fails closed on missing or stale date anchors", () => {
  const body = '<main><article><div class="docs-prose"><h3 id="september-1-2026">September 1, 2026</h3><ul><li>Model release.</li></ul></div></article></main>';
  for (const url of [claudeOfficialChangelogUrl, `${claudeOfficialChangelogUrl}#september-2-2026`]) {
    assert.throws(() => extractOfficialUpdateSection(body, url), /永久链接|条目不存在/u);
  }
});

test("selected update HTML retains its own footnote container for bounded body extraction", () => {
  const html = geminiPage('<h2 id="09-03-2026">September 3, 2026</h2><p><strong>Model X preview</strong> has special pricing<a href="#price-note">[1]</a>.</p><aside id="price-note">Preview pricing ends September 30, 2026.</aside><h2 id="09-02-2026">September 2, 2026</h2><p>Other event.</p><aside>Other event conditions.</aside>');
  const section = extractOfficialUpdateSection(html, `${geminiOfficialChangelogUrl}#09-03-2026`)!;
  assert.match(section.html, /Preview pricing ends September 30, 2026/u);
  assert.doesNotMatch(section.html, /Other event conditions/u);
});

test("DeepSeek actual heading excerpts retain per-event permalinks, original dates and attribution", () => {
  const items = parseDeepSeekOfficialUpdates(fixture("deepseek-updates"), deepseek, now);
  assert.equal(items.length, 2);
  assert.equal(items[0]?.title, "DeepSeek-V4-Flash-Vision-Exp Release");
  assert.equal(items[0]?.published_at, "2026-08-21T00:00:00.000Z");
  assert.equal(items[0]?.url, `${deepseekOfficialUpdatesUrl}#deepseek-v4-flash-vision-exp-release`);
  assert.equal(items[0]?.author, "DeepSeek");
  assert.equal(items[0]?.metadata?.source_id, deepseek.id);
  assert.equal(items[0]?.metadata?.source_role, "official");
  assert.equal(items[0]?.metadata?.date_precision, "day");
  assert.equal(items[0]?.metadata?.original_date_text, "Date: 2026-08-21");
  assert.equal(items[0]?.fetched_at, now);
  assert.notEqual(items[0]?.id, items[1]?.id);
  assert.match(items[0]?.content ?? "", /deepseek-v4-flash-vision-exp/);
});

test("Gemini actual date sections preserve the original named change and the date anchor", () => {
  const items = parseGeminiOfficialChangelog(fixture("gemini-changelog"), gemini, now);
  assert.equal(items.length, 2);
  assert.equal(items[0]?.title, "Lyria 3.5 in public preview");
  assert.equal(items[0]?.url, `${geminiOfficialChangelogUrl}#09-03-2026`);
  assert.equal(items[0]?.published_at, "2026-09-03T00:00:00.000Z");
  assert.equal(items[1]?.published_at, "2026-09-02T00:00:00.000Z");
  assert.equal(items[0]?.author, "Google");
  assert.equal(items[0]?.metadata?.event_granularity, "dated-section");
  assert.notEqual(items[0]?.id, items[1]?.id);
});

test("Gemini rejects a localized page even when a few date headings remain English", () => {
  const mixed = Array.from({ length: 20 }, (_, index) => {
    const day = index + 1;
    const date = index < 4 ? `September ${day}, 2026` : `${day} de septiembre de 2026`;
    return `<h2 id="09-${String(day).padStart(2, "0")}-2026">${date}</h2><p><strong>Actualizaciones del modelo</strong> Detalles.</p>`;
  }).join("");
  for (const language of ["es", "es-419-x-mtfrom-en", "zh-CN"]) {
    const html = `<html lang="${language}"><body>${geminiPage(mixed)}</body></html>`;
    assert.throws(() => parseGeminiOfficialChangelog(html, gemini, now), /语言.*英文/);
    assert.throws(() => extractOfficialUpdateSection(html, `${geminiOfficialChangelogUrl}#09-01-2026`), /语言.*英文/);
  }
});

test("Gemini rejects low date-format coverage when language metadata is missing or misleading", () => {
  const mixed = Array.from({ length: 20 }, (_, index) => {
    const day = index + 1;
    const date = index < 4 ? `September ${day}, 2026` : `${day} de septiembre de 2026`;
    return `<h2 id="09-${String(day).padStart(2, "0")}-2026">${date}</h2><p><strong>Update ${day}</strong> Details.</p>`;
  }).join("");
  for (const html of [geminiPage(mixed), `<html lang="en"><body>${geminiPage(mixed)}</body></html>`]) {
    assert.throws(() => parseGeminiOfficialChangelog(html, gemini, now), /日期标题格式.*4.*20/);
  }
});

test("Gemini date coverage ignores generic headings and preserves English pages without language metadata", () => {
  const content = '<h2 id="09-01-2026">September 1, 2026</h2><p><strong>Model release</strong> Details.</p>'
    + Array.from({ length: 20 }, (_, index) => `<h2 id="guide-${index}">API guide ${index}</h2><p>Documentation.</p>`).join("");
  for (const html of [geminiPage(content), `<html lang="en-US"><body>${geminiPage(content)}</body></html>`]) {
    const items = parseGeminiOfficialChangelog(html, gemini, now);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.url, `${geminiOfficialChangelogUrl}#09-01-2026`);
  }
});

test("DeepSeek separates same-day events and never borrows content or dates from the next section", () => {
  const html = deepseekPage(`<h2 id="date-2026-09-01">Date: 2026-09-01</h2>
    <h3 id="model-a">Model A</h3><p>First release.</p><h3 id="model-b">Model B</h3><p>Second release.</p>
    <h2 id="undated">Overview</h2><h3 id="no-date">Undated release</h3><p>Not a dated update.</p>
    <h2 id="date-2026-08-01">Date: 2026-08-01</h2><h3 id="model-c">Model C</h3><p>Old release.</p>`);
  const items = parseDeepSeekOfficialUpdates(html, deepseek, now);
  assert.equal(items.length, 3);
  assert.deepEqual(items.slice(0, 2).map((item) => item.title), ["Model A", "Model B"]);
  assert.equal(items[0]?.content, "First release.");
  assert.equal(items[1]?.content, "Second release.");
  assert.equal(items[2]?.published_at, "2026-08-01T00:00:00.000Z");
});

test("invalid calendar dates, page modification metadata and undated entries never manufacture freshness", () => {
  const html = geminiPage(`<meta property="article:modified_time" content="${now}">
    <h2 id="02-30-2026">February 30, 2026</h2><p><strong>Invalid calendar</strong> Ignored.</p>
    <h2 id="unknown">Latest updates</h2><p><strong>No date</strong> Ignored.</p>
    <h2 id="02-29-2024">February 29, 2024</h2><p><strong>Leap day</strong> Kept.</p>
    <footer>Last updated September 8, 2026.</footer>`);
  const items = parseGeminiOfficialChangelog(html, gemini, now);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.published_at, "2024-02-29T00:00:00.000Z");
  assert.doesNotMatch(items[0]?.content ?? "", /Last updated|Ignored/);
  assert.throws(() => parseDeepSeekOfficialUpdates(deepseekPage('<h2 id="bad">Date: 2026-02-30</h2><h3 id="x">Bad date</h3><p>Release</p>'), deepseek, now), /没有可识别的带日期更新/);
});

test("unsafe or missing event anchors are rejected, while body links cannot change the event URL", () => {
  const html = deepseekPage(`<h2 id="date-2026-09-01">Date: 2026-09-01</h2>
    <h3 id="valid">Safe release<a class="hash-link" href="#valid">#</a></h3><p><a href="https://evil.example/">Body reference</a></p>
    <h3 id="javascript:alert(1)">Bad anchor</h3><p>Ignored.</p>
    <h3>No anchor</h3><p>Ignored.</p>
    <h3 id="foreign"><a class="hash-link" href="https://evil.example/#foreign">Bad permalink</a></h3><p>Ignored.</p>
    <h3 id="script"><a class="hash-link" href="javascript:alert(1)">Bad scheme</a></h3><p>Ignored.</p>`);
  const items = parseDeepSeekOfficialUpdates(html, deepseek, now);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.url, `${deepseekOfficialUpdatesUrl}#valid`);
  assert.equal(items[0]?.title, "Safe release");
  assert.equal(items[0]?.content, "Body reference");
});

test("validation pages and missing expected article structures fail visibly instead of appearing healthy", () => {
  for (const html of ["<html><title>Just a moment...</title><p>Verify you are human</p></html>",
    "<main><h2 id='09-01-2026'>September 1, 2026</h2><p>Missing official content container.</p></main>",
    geminiPage('<h2 id="09-01-2026">September 1, 2026</h2>')]) {
    assert.throws(() => parseGeminiOfficialChangelog(html, gemini, now), /结构|带日期更新/);
  }
  assert.throws(() => parseDeepSeekOfficialUpdates(deepseekPage('<h2 id="date-2026-09-01">Date: 2026-09-01</h2><p>Missing event headings.</p>'), deepseek, now), /带日期更新/);
});

test("official update parsing is bounded and excludes active or hidden page elements", () => {
  const dates = Array.from({ length: 120 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, index + 1));
    const label = `${date.toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
    return `<h2 id="date-${index}">${label}</h2><p><strong>${"Title ".repeat(120)}</strong>${"Update ".repeat(2200)}</p><script>script trap</script><div hidden>hidden trap</div>`;
  }).join("");
  const items = parseGeminiOfficialChangelog(geminiPage(dates), gemini, now);
  assert.equal(items.length, 100);
  assert.ok(items.every((item) => item.title.length <= 500 && (item.content?.length ?? 0) <= 12000));
  assert.ok(items.every((item) => !/script trap|hidden trap/.test(item.content ?? "")));
  assert.ok(Date.parse(items[0]?.published_at ?? "") >= Date.parse(items.at(-1)?.published_at ?? ""));
  assert.throws(() => parseGeminiOfficialChangelog("x".repeat(maximumOfficialUpdateBytes + 1), gemini, now), /体积/);
});

test("repeated collection keeps event identifiers stable without swallowing duplicate anchors", () => {
  const html = geminiPage('<h2 id="09-01-2026">September 1, 2026</h2><p><strong>First update</strong> Details.</p><h2 id="09-01-2026">September 1, 2026</h2><p>Duplicate heading.</p>');
  const before = parseGeminiOfficialChangelog(html, gemini, now);
  const later = parseGeminiOfficialChangelog(html, gemini, "2026-09-09T00:00:00.000Z");
  assert.equal(before.length, 1);
  assert.equal(before[0]?.id, later[0]?.id);
  assert.equal(before[0]?.published_at, later[0]?.published_at);
});

test("DeepSeek evidence extraction isolates one event without adjacent dates or same-day prices", () => {
  const html = deepseekPage(`<h2 id="date-2026-09-01">Date: 2026-09-01</h2>
    <h3 id="model-a">Model A</h3><p>Its own release details.</p><img src="https://api-docs.deepseek.com/a.png">
    <h3 id="model-b">Model B</h3><p>Neighbor price is $99.</p>
    <h2 id="date-2026-08-01">Date: 2026-08-01</h2><h3 id="model-c">Model C</h3><p>Old price was $999.</p>
    <aside>Right-hand table of contents.</aside>`);
  const section = extractOfficialUpdateSection(html, `${deepseekOfficialUpdatesUrl}#model-a`);
  assert.equal(section?.title, "Model A");
  assert.equal(section?.publishedAt, "2026-09-01T00:00:00.000Z");
  assert.match(section?.html ?? "", /Its own release details|a\.png/);
  assert.doesNotMatch(section?.html ?? "", /\$99|\$999|Model B|Model C|table of contents/);
  const raw = parseDeepSeekOfficialUpdates(html, deepseek, now).find((item) => item.url.endsWith("#model-a"));
  assert.equal(raw?.title, section?.title);
  assert.equal(raw?.published_at, section?.publishedAt);
});

test("Gemini evidence extraction freezes only the selected date section and keeps images and tables", () => {
  const html = geminiPage(`<h2 id="09-01-2026">September 1, 2026</h2><p><strong>Current model</strong> Its release.</p>
    <table><tr><td>Rate</td><td>$2</td></tr></table><img src="https://ai.google.dev/current.png">
    <h2 id="08-01-2026">August 1, 2026</h2><p><strong>Previous model</strong> Previous price: $10.</p>`);
  const section = extractOfficialUpdateSection(html, `${geminiOfficialChangelogUrl}#09-01-2026`);
  assert.equal(section?.title, "Current model");
  assert.equal(section?.publishedAt, "2026-09-01T00:00:00.000Z");
  assert.match(section?.html ?? "", /<table>|\$2|current\.png/);
  assert.doesNotMatch(section?.html ?? "", /Previous model|\$10|08-01-2026/);
});

test("known update pages fail closed when an event cannot be resolved, and unrelated pages are left alone", () => {
  const html = fixture("gemini-changelog");
  assert.equal(extractOfficialUpdateSection(html, "https://example.com/article"), undefined);
  for (const url of [geminiOfficialChangelogUrl, `${geminiOfficialChangelogUrl}#missing`, `${geminiOfficialChangelogUrl}#%ZZ`, `${geminiOfficialChangelogUrl}?view=other#09-03-2026`]) {
    assert.throws(() => extractOfficialUpdateSection(html, url), /更新条目|永久链接/);
  }
  assert.throws(() => extractOfficialUpdateSection(geminiPage('<h2 id="undated">Latest</h2><p>Cannot date.</p>'), `${geminiOfficialChangelogUrl}#undated`), /带日期更新|更新条目/);
});
