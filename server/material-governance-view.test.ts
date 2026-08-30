import assert from "node:assert/strict";
import test from "node:test";
import { materialGovernanceView } from "../src/material-governance-view.js";
import type { ImageMaterial } from "./types.js";

const material = (overrides: Partial<ImageMaterial> = {}): ImageMaterial => ({
  id: "material_1",
  title: "Official image",
  fileName: "image.png",
  localPath: "/materials/image.png",
  publicPath: "/materials/image.png",
  sourceUrl: "https://openai.com/news",
  attribution: "OpenAI",
  tags: ["AI"],
  rights: "official",
  evidenceNote: "Official launch page",
  allowedPlatforms: ["xiaoheihe"],
  entityTags: ["OpenAI"],
  fingerprint: "a".repeat(64),
  createdAt: "2026-08-13T00:00:00.000Z",
  ...overrides,
});

test("material card view exposes the publish blocker instead of showing every asset as reusable", () => {
  const blocked = materialGovernanceView(material({
    rights: "licensed",
    evidenceNote: undefined,
    allowedPlatforms: [],
  }), "xiaoheihe", "2026-08-13T01:00:00.000Z");
  const warning = materialGovernanceView(material(), "xiaoheihe", "2026-08-13T01:00:00.000Z");

  assert.equal(blocked.status, "blocked");
  assert.match(blocked.detail, /授权证据|小黑盒/);
  assert.equal(warning.status, "warning");
  assert.match(warning.detail, /官方.*授权/);
});
