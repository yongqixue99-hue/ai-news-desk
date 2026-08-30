import assert from "node:assert/strict";
import test from "node:test";
import {
  DuplicateMaterialError,
  normalizeMaterialInput,
  saveMaterialBytes,
  sourceImageFromMaterial,
} from "./materials.js";
import type { ImageMaterial } from "./types.js";

const existingMaterial = (overrides: Partial<ImageMaterial> = {}): ImageMaterial => ({
  id: "material_existing",
  title: "Existing image",
  fileName: "existing.png",
  localPath: "/do/not/touch/existing.png",
  publicPath: "/materials/existing.png",
  sourceUrl: "https://openai.com/news",
  attribution: "OpenAI",
  tags: ["AI"],
  rights: "licensed",
  evidenceNote: "Licensed for Xiaoheihe",
  evidencePath: "/licenses/openai.pdf",
  allowedPlatforms: ["xiaoheihe"],
  expiresAt: "2027-08-13T15:59:59.999Z",
  entityTags: ["OpenAI", "Sam Altman"],
  fingerprint: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  createdAt: "2026-08-13T00:00:00.000Z",
  ...overrides,
});

test("material input keeps copyright lifecycle metadata in a normalized record", () => {
  const normalized = normalizeMaterialInput({
    title: " OpenAI keynote ",
    attribution: " OpenAI ",
    sourceUrl: " https://openai.com/keynote ",
    tags: [" AI ", "AI", " keynote "],
    rights: "licensed",
    evidenceNote: " Commercial permission ",
    evidencePath: " /licenses/openai.pdf ",
    allowedPlatforms: [" XiaoHeiHe ", "xiaoheihe"],
    expiresAt: " 2027-08-13T15:59:59.999Z ",
    entityTags: [" OpenAI ", "openai", " Sam Altman "],
  }, "fallback");

  assert.deepEqual(normalized, {
    title: "OpenAI keynote",
    attribution: "OpenAI",
    sourceUrl: "https://openai.com/keynote",
    tags: ["AI", "keynote"],
    rights: "licensed",
    evidenceNote: "Commercial permission",
    evidencePath: "/licenses/openai.pdf",
    allowedPlatforms: ["xiaoheihe"],
    expiresAt: "2027-08-13T15:59:59.999Z",
    entityTags: ["OpenAI", "Sam Altman"],
  });
});

test("upload detects a SHA-256 duplicate before writing a second material file", async () => {
  await assert.rejects(
    () => saveMaterialBytes(
      Buffer.from("hello"),
      "image/png",
      { title: "Duplicate" },
      "duplicate",
      "",
      [existingMaterial()],
    ),
    (error: unknown) => {
      assert.ok(error instanceof DuplicateMaterialError);
      assert.equal(error.duplicateId, "material_existing");
      assert.match(error.message, /Existing image/);
      return true;
    },
  );
});

test("copying a governed material into a draft preserves every copyright field", () => {
  const image = sourceImageFromMaterial(
    existingMaterial(),
    {
      id: "draft_image",
      localPath: "/media/draft/image.png",
      publicPath: "/media/draft/image.png",
    },
  );

  assert.deepEqual({
    rights: image.rights,
    evidenceNote: image.evidenceNote,
    evidencePath: image.evidencePath,
    allowedPlatforms: image.allowedPlatforms,
    expiresAt: image.expiresAt,
    entityTags: image.entityTags,
    fingerprint: image.fingerprint,
    sourceUrl: image.sourceUrl,
  }, {
    rights: "licensed",
    evidenceNote: "Licensed for Xiaoheihe",
    evidencePath: "/licenses/openai.pdf",
    allowedPlatforms: ["xiaoheihe"],
    expiresAt: "2027-08-13T15:59:59.999Z",
    entityTags: ["OpenAI", "Sam Altman"],
    fingerprint: existingMaterial().fingerprint,
    sourceUrl: "https://openai.com/news",
  });
});
