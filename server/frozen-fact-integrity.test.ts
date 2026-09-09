import assert from "node:assert/strict";
import test from "node:test";
import { auditFrozenFactIntegrity } from "./frozen-fact-integrity.js";
import golden from "./fixtures/frozen-fact-integrity-golden.json";

const audit = (fact: string, paragraph: string, attributionContext?: string) =>
  auditFrozenFactIntegrity(paragraph, [{ text: fact }], { attributionContext });

for (const example of golden.cases) {
  test(`frozen fact integrity ${example.expectedPass ? "accepts" : "rejects"}: ${example.label}`, () => {
    const result = audit(example.fact, example.text);
    assert.equal(result.passed, example.expectedPass, JSON.stringify(result));
  });
}

test("attribution omission is a warning and can be established in the preceding paragraph", () => {
  const result = audit("官方自测成功率为 80%。", "成功率为 80%。");
  assert.equal(result.passed, true);
  assert.equal(result.warnings[0]?.code, "attribution-missing");
  assert.deepEqual(audit("官方自测成功率为 80%。", "成功率为 80%。", "以下结果来自厂商的内部测试。").warnings, []);
});

test("the detector does not claim full entailment for prose with no recognised quantities", () => {
  const result = audit("模型已经发布。", "模型改变了行业格局。");
  assert.equal(result.checkedQuantities, 0);
  assert.equal(result.passed, true);
});

for (const paragraph of ["召回率高 70.5-9.7%。", "召回率高 70.5–9.7%。", "召回率高 70.5至9.7%。", "Recall is between 70.5 and 9.7% higher."]) {
  test(`shared percent unit checks the lower endpoint: ${paragraph}`, () => {
    const result = audit("召回率高 7.5-9.7%。", paragraph);
    assert.equal(result.passed, false, JSON.stringify(result));
    assert.equal(result.checkedQuantities, 2);
    assert.match(result.errors[0]!.message, /70\.5/u);
  });
}

for (const paragraph of ["通过率为 30-60%。", "通过率为 30%至60%。", "The rate is between 30 and 60%.", "The rate is between 30% and 60%."]) {
  test(`equivalent percent range notation is accepted: ${paragraph}`, () => {
    const result = audit("通过率为 30% 至 60%。", paragraph);
    assert.equal(result.passed, true, JSON.stringify(result));
    assert.equal(result.checkedQuantities, 2);
  });
}

for (const paragraph of ["成本低 20.3-5.2x。", "成本低 2.3至50.2倍。", "成本低 2.6 倍。", "成本低 2.6x。"]) {
  test(`multipliers cannot invent an endpoint or value: ${paragraph}`, () => {
    const result = audit("成本低 2.3-5.2x。", paragraph);
    assert.equal(result.passed, false, JSON.stringify(result));
    assert.equal(result.errors[0]?.code, "quantity-not-supported");
  });
}

test("multiplier units accept matching ranges and decimal Chinese multiples", () => {
  const range = audit("成本低 2.3-5.2x。", "成本低 2.3 倍至 5.2 倍。");
  assert.equal(range.passed, true, JSON.stringify(range));
  assert.equal(range.checkedQuantities, 2);
  const scalar = audit("吞吐为 2.6x。", "吞吐为 2.6 倍。");
  assert.equal(scalar.passed, true, JSON.stringify(scalar));
  assert.equal(scalar.checkedQuantities, 1);
});

test("model versions and image dimensions are not multiplier quantities", () => {
  const result = audit("工具已经发布。", "GPT3.7、GPT-4.1 与 Model2.6x 输出 1024x768 图片。");
  assert.equal(result.passed, true, JSON.stringify(result));
  assert.equal(result.checkedQuantities, 0);
});
