import { pathToFileURL } from "node:url";
import { extractPageContent } from "./extractor.js";
import { parseQwenArticleSource } from "./qwen-article-source.js";

// Original miniature fixtures, not copies of publisher articles. These check
// structural retention and refusal, not semantic truth or live source reach.
const cases = [
  { id: "rowspan", label: "合并行不会错列", html: '<table><tr><th>Model</th><th>Task</th><th>Score</th></tr><tr><td rowspan="2">Model X</td><td>A</td><td>45</td></tr><tr><td>B</td><td>67</td></tr></table>', includes: ["Model X\tB\t67"] },
  { id: "colspan", label: "合并列表头保留上下文", html: '<table><tr><th colspan="2">Preview only</th></tr><tr><td>Input</td><td>Output</td></tr><tr><td>0.2</td><td>0.8</td></tr></table>', includes: ["Preview only\tPreview only", "Input\tOutput"] },
  { id: "table-notes", label: "表名和表尾条件保留", html: '<table><caption>Batch size 1</caption><tr><td>Latency</td><td>25 ms</td></tr><tfoot><tr><td colspan="2">Vendor test, synthetic workload.</td></tr></tfoot></table>', includes: ["Batch size 1", "Vendor test, synthetic workload."] },
  { id: "footnote", label: "正文明确引用的脚注保留", html: '<p>Preview pricing<sup><a href="#fn-1">1</a></sup>.</p><aside id="fn-1">Ends September 30, 2026.</aside>', includes: ["[1]", "Ends September 30, 2026."] },
  { id: "missing-footnote", label: "缺失脚注明确提示", html: '<p>Preview pricing<sup><a href="#fn-404">1</a></sup>.</p>', warning: "脚注" },
  { id: "sidebar", label: "侧栏推荐不混入正文", html: '<p>The model is in preview.</p><aside><p>Unrelated product is free forever.</p></aside><section class="related-items"><p>Advertisement</p></section>', includes: ["The model is in preview."], excludes: ["free forever", "Advertisement"] },
  { id: "figure", label: "图注保留测试条件", html: '<figure><img src="https://example.com/chart.png"><figcaption>Internal test; batch=1; not independently verified.</figcaption></figure>', includes: ["Internal test; batch=1; not independently verified."] },
  { id: "code", label: "代码比较符不丢失", html: '<pre><code class="language-python">if count &lt; 3:\n    retry()</code></pre>', includes: ["if count < 3:\n    retry()"] },
  { id: "limit", label: "长文截断可见", html: `<p>${"Long article. ".repeat(2600)}</p>`, truncated: true },
  { id: "event-section", label: "更新页不串到另一日期", url: "https://ai.google.dev/gemini-api/docs/changelog#09-03-2026", raw: '<main><article><div class="devsite-article-body"><h2 id="09-03-2026">September 3, 2026</h2><p><strong>Model X preview</strong> is limited to research.</p><h2 id="09-02-2026">September 2, 2026</h2><p>Other model is free.</p></div></article></main>', includes: ["limited to research"], excludes: ["Other model"] },
  { id: "invalid-event", label: "锚点失效不能退回整页", url: "https://ai.google.dev/gemini-api/docs/changelog#09-04-2026", raw: '<main><article><div class="devsite-article-body"><h2 id="09-03-2026">September 3, 2026</h2><p>Model X preview.</p></div></article></main>', error: true },
  { id: "qwen-article", label: "官方接口只读取选中文章", qwen: true, includes: ["Chosen article.", "Exact caption"], excludes: ["Other article."] },
];

export const runArticleExtractionGoldenSet = async () => {
  const results = [];
  for (const entry of cases) {
    try {
      const url = new URL(entry.url ?? "https://example.com/article");
      const selected = entry.qwen ? parseQwenArticleSource(JSON.stringify({ data: { articles: [
        { path: "chosen", title: "Chosen", content: '<p>Chosen article.</p><figure><img src="https://example.com/chart.png"><figcaption>Exact caption</figcaption></figure>', extra: { date: "2026-09-08" } },
        { path: "other", title: "Other", content: "<p>Other article.</p>" },
      ] } }), "https://qwen.ai/blog?id=chosen") : undefined;
      const page = await extractPageContent(selected?.html ?? entry.raw ?? `<article>${entry.html}</article>`, url, url);
      const problems = [
        ...(entry.error ? ["应该拒绝该来源"] : []),
        ...(entry.includes ?? []).filter((value) => !page.text.includes(value)).map((value) => `缺失：${value}`),
        ...(entry.excludes ?? []).filter((value) => page.text.includes(value)).map((value) => `混入：${value}`),
        ...(entry.warning && !page.extractionWarnings?.some((value) => value.includes(entry.warning!)) ? ["缺少读取限制提示"] : []),
        ...(entry.truncated && !page.textTruncated ? ["截断未标记"] : []),
      ];
      results.push({ id: entry.id, label: entry.label, passed: !problems.length, problems });
    } catch (error) {
      results.push({ id: entry.id, label: entry.label, passed: Boolean(entry.error), problems: entry.error ? [] : [String(error)] });
    }
  }
  return { schemaVersion: "article-extraction-golden/v1", total: results.length,
    passed: results.filter((result) => result.passed).length, results };
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runArticleExtractionGoldenSet();
  console.log(JSON.stringify(report, null, 2));
  if (report.passed !== report.total) process.exitCode = 1;
}
