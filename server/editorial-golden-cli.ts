import { runEditorialGoldenSet } from "./editorial-golden-set.js";

const report = runEditorialGoldenSet();

console.log(`编辑质量黄金集：${report.passed}/${report.total} 通过`);
console.log(`新闻 ${report.categoryCounts.news} · 社区 ${report.categoryCounts.community} · 原文 ${report.categoryCounts.source} · 写作 ${report.categoryCounts.writing} · 图片 ${report.categoryCounts.visual}`);
for (const failure of report.failures) {
  console.error(`- ${failure.id} ${failure.label}`);
  console.error(`  预期阻断：${failure.expectedBlockerIds.join(", ") || "无"}`);
  console.error(`  实际阻断：${failure.actualBlockerIds.join(", ") || "无"}`);
  console.error(`  预期警告：${failure.expectedWarningIds.join(", ") || "无"}`);
  console.error(`  实际警告：${failure.actualWarningIds.join(", ") || "无"}`);
}

if (report.failed > 0) process.exitCode = 1;
