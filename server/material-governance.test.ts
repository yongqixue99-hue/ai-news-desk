import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateMaterialPublishEligibility,
  findDuplicateMaterial,
  fingerprintSha256,
  normalizeGovernedMaterial,
  preparePublishedMaterialCandidate,
  type GovernedMaterial,
} from "./material-governance.js";

const material = (overrides: Partial<GovernedMaterial> = {}): GovernedMaterial => ({
  id: "material_one",
  title: "OpenAI launch image",
  attribution: "OpenAI",
  rights: "official",
  sourceUrl: "https://openai.com/news/launch",
  evidence: { note: "Downloaded from the official launch page" },
  allowedPlatforms: ["xiaoheihe"],
  entityTags: ["OpenAI"],
  fingerprint: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  createdAt: "2026-08-13T00:00:00.000Z",
  ...overrides,
});

test("SHA-256 fingerprint finds an exact duplicate without relying on its filename or URL", () => {
  const fingerprint = fingerprintSha256(Buffer.from("hello"));
  const existing = material();

  assert.equal(fingerprint, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  assert.equal(findDuplicateMaterial(fingerprint, [
    existing,
    material({ id: "other", fingerprint: "f".repeat(64) }),
  ])?.id, "material_one");
});

test("unknown, expired and platform-mismatched rights block publication", () => {
  const now = "2026-08-13T05:00:00.000Z";
  const unknown = evaluateMaterialPublishEligibility(
    material({ rights: "check-required" }),
    "xiaoheihe",
    now,
  );
  const expired = evaluateMaterialPublishEligibility(
    material({ rights: "licensed", expiresAt: "2026-08-12T23:59:59.000Z" }),
    "xiaoheihe",
    now,
  );
  const wrongPlatform = evaluateMaterialPublishEligibility(
    material({ rights: "owned", allowedPlatforms: ["wechat"] }),
    "xiaoheihe",
    now,
  );

  assert.equal(unknown.status, "blocked");
  assert.match(unknown.blockers.join(" "), /待确认/);
  assert.equal(expired.effectiveRights, "expired");
  assert.match(expired.blockers.join(" "), /到期/);
  assert.match(wrongPlatform.blockers.join(" "), /小黑盒|xiaoheihe/i);
});

test("licensed material requires traceable authorization evidence and a valid expiry", () => {
  const now = "2026-08-13T05:00:00.000Z";
  const missingEvidence = evaluateMaterialPublishEligibility(material({
    rights: "licensed",
    evidence: {},
    expiresAt: "2027-08-13T05:00:00.000Z",
  }), "xiaoheihe", now);
  const malformedExpiry = evaluateMaterialPublishEligibility(material({
    rights: "licensed",
    evidence: { path: "/licenses/openai.pdf" },
    expiresAt: "sometime later",
  }), "xiaoheihe", now);
  const licensed = evaluateMaterialPublishEligibility(material({
    rights: "licensed",
    evidence: { path: "/licenses/openai.pdf" },
    expiresAt: "2027-08-13T05:00:00.000Z",
  }), "xiaoheihe", now);

  assert.match(missingEvidence.blockers.join(" "), /授权证据/);
  assert.match(malformedExpiry.blockers.join(" "), /到期时间/);
  assert.equal(licensed.status, "allowed");
});

test("official and editorial screenshots remain traceable warnings rather than implied licenses", () => {
  const official = evaluateMaterialPublishEligibility(material({
    rights: "official",
  }), "xiaoheihe", "2026-08-13T05:00:00.000Z");
  const screenshot = evaluateMaterialPublishEligibility(material({
    rights: "editorial-screenshot",
    evidence: { path: "/evidence/original-screen.png" },
  }), "xiaoheihe", "2026-08-13T05:00:00.000Z");
  const untraceable = evaluateMaterialPublishEligibility(material({
    rights: "official",
    sourceUrl: undefined,
  }), "xiaoheihe", "2026-08-13T05:00:00.000Z");

  assert.equal(official.status, "warning");
  assert.equal(official.eligible, true);
  assert.match(official.warnings.join(" "), /官方.*授权/);
  assert.equal(screenshot.status, "warning");
  assert.match(screenshot.warnings.join(" "), /截图/);
  assert.match(untraceable.blockers.join(" "), /来源 URL/);
});

test("non-owned material keeps attribution and screenshot evidence as publish-time requirements", () => {
  const screenshotWithoutEvidence = evaluateMaterialPublishEligibility(material({
    rights: "editorial-screenshot",
    evidence: {},
  }), "xiaoheihe", "2026-08-13T05:00:00.000Z");
  const officialWithoutAttribution = evaluateMaterialPublishEligibility(material({
    rights: "official",
    attribution: "来源待补充",
  }), "xiaoheihe", "2026-08-13T05:00:00.000Z");

  assert.match(screenshotWithoutEvidence.blockers.join(" "), /截图证据/);
  assert.match(officialWithoutAttribution.blockers.join(" "), /署名|来源标注/);
});

test("material governance normalizes platform, entity and fingerprint metadata for stable storage", () => {
  const normalized = normalizeGovernedMaterial({
    id: " material_2 ",
    title: " Sam Altman keynote ",
    attribution: " OpenAI ",
    rights: "licensed",
    sourceUrl: " https://openai.com/keynote ",
    evidence: { note: " Commercial license ", path: " /licenses/2.pdf " },
    allowedPlatforms: [" XiaoHeiHe ", "xiaoheihe", "WECHAT", ""],
    entityTags: ["OpenAI", "openai", " Sam Altman "],
    fingerprint: "A".repeat(64),
    createdAt: "2026-08-13T05:00:00.000Z",
  });

  assert.deepEqual(normalized.allowedPlatforms, ["xiaoheihe", "wechat"]);
  assert.deepEqual(normalized.entityTags, ["OpenAI", "Sam Altman"]);
  assert.equal(normalized.fingerprint, "a".repeat(64));
  assert.deepEqual(normalized.evidence, {
    note: "Commercial license",
    path: "/licenses/2.pdf",
  });
});

test("legacy commentary screenshot rights migrate to the governed editorial status", () => {
  const normalized = normalizeGovernedMaterial({
    id: "legacy_screen",
    title: "Legacy screenshot",
    attribution: "User screenshot",
    rights: "commentary-screenshot",
    sourceUrl: "https://example.com/original",
    evidence: { path: "/evidence/legacy.png" },
    allowedPlatforms: ["xiaoheihe"],
    entityTags: [],
    fingerprint: "b".repeat(64),
    createdAt: "2026-08-13T05:00:00.000Z",
  });

  assert.equal(normalized.rights, "editorial-screenshot");
});

test("a failed publication or an image absent from the receipt cannot become reusable material", () => {
  const image = material({ rights: "owned", localPath: "/media/draft/hero.png" });
  const failed = preparePublishedMaterialCandidate({
    image,
    publication: {
      status: "failed",
      platform: "xiaoheihe",
      receiptId: "receipt_failed",
      publishedAt: "2026-08-13T06:00:00.000Z",
      usedImageIds: [image.id],
    },
    existingMaterials: [],
  });
  const unused = preparePublishedMaterialCandidate({
    image,
    publication: {
      status: "success",
      platform: "xiaoheihe",
      receiptId: "receipt_success",
      publishedAt: "2026-08-13T06:00:00.000Z",
      usedImageIds: [],
    },
    existingMaterials: [],
  });

  assert.match(failed.blockers.join(" "), /发布成功/);
  assert.match(unused.blockers.join(" "), /实际使用/);
  assert.equal(failed.candidate, undefined);
  assert.equal(unused.candidate, undefined);
});

test("successful use keeps its rights status and still requires eligibility, a local asset and no duplicate", () => {
  const publication = {
    status: "success" as const,
    platform: "xiaoheihe",
    receiptId: "receipt_1",
    publishedAt: "2026-08-13T06:00:00.000Z",
    usedImageIds: ["source_image"],
  };
  const licensedImage = material({
    id: "source_image",
    rights: "licensed",
    evidence: { path: "/licenses/openai.pdf" },
    expiresAt: "2027-08-13T05:00:00.000Z",
    localPath: "/media/draft/source.png",
  });
  const ready = preparePublishedMaterialCandidate({
    image: licensedImage,
    publication,
    existingMaterials: [],
    targetMaterialId: "material_from_publish",
  });
  const unresolved = preparePublishedMaterialCandidate({
    image: { ...licensedImage, rights: "check-required" },
    publication,
    existingMaterials: [],
  });
  const missingAsset = preparePublishedMaterialCandidate({
    image: { ...licensedImage, localPath: undefined },
    publication,
    existingMaterials: [],
  });
  const duplicate = preparePublishedMaterialCandidate({
    image: licensedImage,
    publication,
    existingMaterials: [material({ id: "already_saved" })],
  });

  assert.equal(ready.status, "ready");
  assert.equal(ready.candidate?.rights, "licensed");
  assert.equal(ready.candidate?.promotion.receiptId, "receipt_1");
  assert.match(unresolved.blockers.join(" "), /版权状态待确认/);
  assert.match(missingAsset.blockers.join(" "), /本地文件/);
  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicate.duplicateOf, "already_saved");
  assert.equal(duplicate.candidate, undefined);
});
