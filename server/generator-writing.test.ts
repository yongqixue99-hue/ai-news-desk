import assert from "node:assert/strict";
import test from "node:test";
import { parseGeneratedArticle } from "./generator.js";

test("a factual brief may be one paragraph and does not need a forced opinion", () => {
  const article = parseGeneratedArticle(JSON.stringify({
    strategy: "brief",
    title: "OpenAI 更新 ChatGPT 数据导出入口",
    paragraphs: ["OpenAI 周二更新帮助文档，欧盟用户可从 9 月 3 日起直接导出聊天记录。"],
    take: "",
    sources: [{
      label: "OpenAI Help Center",
      url: "https://help.openai.com/example",
      kind: "primary",
      verified: true,
    }],
    uncertainties: [],
    imageSelections: [],
    discoveredImages: [],
    topics: [],
  }));

  assert.equal(article.strategy, "brief");
  assert.equal(article.paragraphs.length, 1);
  assert.equal(article.take, "");
});
