import assert from "node:assert/strict";
import test from "node:test";
import {
  assessWritingQuality,
  auditFactPreservation,
  recommendDraftStrategy,
} from "./writing-quality.js";

test("draft strategy keeps a single well-supported event concise", () => {
  assert.equal(recommendDraftStrategy({
    sourceCount: 1,
    verifiedSourceCount: 1,
    evidenceLength: 1_200,
    clusterSize: 1,
  }), "brief");
});

test("draft strategy uses synthesis for a story with several independent reports", () => {
  assert.equal(recommendDraftStrategy({
    sourceCount: 3,
    verifiedSourceCount: 2,
    evidenceLength: 4_800,
    clusterSize: 4,
  }), "synthesis");
});

test("draft strategy never invents commentary without an explicit user angle", () => {
  assert.equal(recommendDraftStrategy({
    sourceCount: 1,
    verifiedSourceCount: 1,
    evidenceLength: 1_200,
    clusterSize: 1,
    userAngle: "结合我连续使用一周后的体验，解释这次改版为什么影响普通用户。",
  }), "commentary");
  assert.equal(recommendDraftStrategy({
    sourceCount: 1,
    verifiedSourceCount: 0,
    evidenceLength: 40,
    clusterSize: 1,
  }), "skip");
  assert.equal(recommendDraftStrategy({
    sourceCount: 1,
    verifiedSourceCount: 0,
    evidenceLength: 40,
    clusterSize: 1,
    canResearchBeyondEvidence: true,
  }), "brief");
});

test("quality desk leaves a concrete, naturally structured brief alone", () => {
  const result = assessWritingQuality({
    title: "OpenAI 将在 9 月向欧盟用户开放数据导出",
    paragraphs: [
      "OpenAI 周二更新了帮助文档：欧盟用户可从 9 月 3 日起直接导出聊天记录，文件会通过邮件发送。",
      "这次变化只涉及导出入口，团队版的管理员权限没有调整。OpenAI 尚未说明其他地区何时跟进。",
    ],
    take: "",
  });

  assert.equal(result.editMode, "keep");
  assert.deepEqual(result.diagnostics, []);
});

test("quality desk applies the lieflat whitelist without banning ordinary connectors", () => {
  const result = assessWritingQuality({
    title: "AI 时代迎来全新变革",
    paragraphs: [
      "在当今快速发展的人工智能时代，AI 正以前所未有的速度改变世界。",
      "首先，这项更新提升了效率。其次，它也带来了新的可能性。",
      "真正值得关注的不是功能本身，而是它背后的行业变革。",
    ],
    take: "总的来说，这无疑标志着一个新的里程碑。",
  });

  assert.equal(result.editMode, "targeted");
  assert.ok(result.diagnostics.some((item) => item.id === "stock-opening" && item.layer === "surface"));
  assert.equal(result.diagnostics.some((item) => item.id === "mechanical-transitions"), false);
  assert.ok(result.diagnostics.some((item) => item.id === "lieflat-reversal-shell" && item.ruleNumber === 1));
  assert.ok(result.diagnostics.some((item) => item.id === "generic-conclusion"));
});

test("quality desk catches pattern clusters but does not reject a named research source", () => {
  const result = assessWritingQuality({
    title: "某公司发布新版写作工具",
    paragraphs: [
      "这次更新无缝、直观且强大。这不仅是一次升级，而是生产力革命。",
      "希望这对您有帮助，如果您想了解更多，请告诉我。",
      "OpenAI 的 2026 年研究表明，测试组完成任务的时间缩短了 18%。",
    ],
    take: "",
  });

  assert.ok(result.diagnostics.some((item) => item.id === "promotional-cluster"));
  assert.equal(result.diagnostics.some((item) => item.id === "negative-parallel-shell"), false);
  assert.ok(result.diagnostics.some((item) => item.id === "chat-residue"));
  assert.equal(result.diagnostics.some((item) => item.id === "unnamed-authority" && item.blockId === "paragraph:2"), false);
});

test("lieflat checks preserve quoted material, passive voice and legitimate numbered steps", () => {
  const result = assessWritingQuality({
    title: "模型迁移记录",
    paragraphs: [
      "团队首先备份数据，其次切换只读流量。版本在凌晨完成部署，旧实例随后被关闭。",
      "负责人说：“不是为了追求规模，而是为了降低延迟。”这段原话按来源保留。",
    ],
    headings: ["第一步：备份", "第二步：切流"],
  });

  assert.equal(result.diagnostics.some((item) => item.id === "lieflat-reversal-shell"), false);
  assert.equal(result.diagnostics.some((item) => item.id === "lieflat-numbered-headings"), false);
  assert.equal(result.diagnostics.some((item) => item.id === "mechanical-transitions"), false);
});

test("fact protection blocks a rewrite that drops dates, product names or numbers", () => {
  const unsafe = auditFactPreservation(
    "OpenAI 于 2026 年 8 月 26 日宣布 GPT-5.6 API 降价 30%。",
    "OpenAI 宣布 API 降价。",
  );
  assert.equal(unsafe.passed, false);
  assert.ok(unsafe.missingAnchors.includes("GPT-5.6"));
  assert.ok(unsafe.missingAnchors.includes("30%"));

  const safe = auditFactPreservation(
    "OpenAI 于 2026 年 8 月 26 日宣布 GPT-5.6 API 降价 30%。",
    "2026 年 8 月 26 日，OpenAI 宣布 GPT-5.6 API 的价格下调 30%。",
  );
  assert.equal(safe.passed, true);
  assert.deepEqual(safe.missingAnchors, []);
});
