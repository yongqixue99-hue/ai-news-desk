import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditFrozenFactIntegrity } from "./frozen-fact-integrity.js";
import golden from "./fixtures/frozen-fact-integrity-golden.json";

export interface EvidenceIntegrityGoldenCase {
  id: string;
  label: string;
  category: string;
  synthetic: boolean;
  fact: string;
  text: string;
  expectedPass: boolean;
}

export const runEvidenceIntegrityGoldenSet = (cases: readonly EvidenceIntegrityGoldenCase[] = golden.cases) => {
  const results = cases.map((example) => {
    const audit = auditFrozenFactIntegrity(example.text, [{ text: example.fact }]);
    return { id: example.id, label: example.label, category: example.category,
      expectedPass: example.expectedPass, actualPass: audit.passed,
      passed: audit.passed === example.expectedPass, checkedQuantities: audit.checkedQuantities,
      errors: audit.errors, warnings: audit.warnings };
  });
  const categoryCounts = Object.fromEntries([...new Set(results.map((result) => result.category))].map((category) => {
    const members = results.filter((result) => result.category === category);
    return [category, { total: members.length, passed: members.filter((result) => result.passed).length,
      validExpressions: members.filter((result) => result.expectedPass).length,
      contradictedExpressions: members.filter((result) => !result.expectedPass).length }];
  }));
  return {
    scope: "synthetic typed-quantity/date and explicit-scope regression; not semantic entailment or model accuracy",
    total: results.length, passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    acceptedValid: results.filter((result) => result.expectedPass && result.actualPass).length,
    validTotal: results.filter((result) => result.expectedPass).length,
    rejectedContradictions: results.filter((result) => !result.expectedPass && !result.actualPass).length,
    contradictionTotal: results.filter((result) => !result.expectedPass).length,
    categoryCounts, failures: results.filter((result) => !result.passed), results,
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = runEvidenceIntegrityGoldenSet();
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`冻结事实完整性固定评测：${report.passed}/${report.total} 通过`);
    console.log(`合理表达接受 ${report.acceptedValid}/${report.validTotal}；明确矛盾拦截 ${report.rejectedContradictions}/${report.contradictionTotal}`);
    console.log(Object.entries(report.categoryCounts).map(([category, counts]) => `${category} ${counts.passed}/${counts.total}`).join(" · "));
    console.log("边界：原创合成数量、单位、日期与明确条件反转；不是完整事实审查、实时新闻准确率或模型质量分数。显式百分比和倍数区间只核端点，不推断区间排序或比较语义。表格列头、跨段计费单位、未识别实体与因果仍需证据核对。");
    for (const failure of report.failures) console.error(`- ${failure.id} ${failure.label}: 预期 ${failure.expectedPass ? "允许" : "阻止"}，实际 ${failure.actualPass ? "允许" : "阻止"}；${failure.errors.map((issue) => issue.message).join("；")}`);
  }
  if (report.failed) process.exitCode = 1;
}
