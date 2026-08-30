import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import {
  evaluateImagePublishReadiness,
  inspectLocalImageFile,
  isNeutralImagePublishReady,
} from "./image-readiness.js";
import type { SourceImage } from "./types.js";

const fixtureRoot = mkdtempSync(path.join(tmpdir(), "ai-news-image-ready-"));
after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

const createFixtureFile = (name: string) => {
  const localPath = path.join(fixtureRoot, name);
  writeFileSync(localPath, Buffer.from("real-image-bytes"));
  return localPath;
};

const image = (overrides: Partial<SourceImage> = {}): SourceImage => ({
  id: "image-1",
  url: "https://images.example/image-1.jpg",
  localPath: createFixtureFile(`image-${Math.random().toString(16).slice(2)}.jpg`),
  publicPath: "/media/image-1.jpg",
  caption: "测试图片",
  attribution: "AI News Desk",
  sourceUrl: "https://example.com/news",
  selected: true,
  rights: "owned",
  allowedPlatforms: ["*"],
  ...overrides,
});

test("a stored path is local-ready only while a non-empty native file still exists", () => {
  const existing = image();
  assert.equal(inspectLocalImageFile(existing).available, true);

  rmSync(existing.localPath!);
  const deleted = inspectLocalImageFile(existing);
  assert.equal(deleted.available, false);
  assert.match(deleted.reason || "", /不存在/u);

  const oldOperatingSystemPath = process.platform === "win32"
    ? "/Users/old-mac/ai-news-desk/media/cover.jpg"
    : "C:\\Users\\old-windows\\ai-news-desk\\media\\cover.jpg";
  const migrated = inspectLocalImageFile(image({ localPath: oldOperatingSystemPath }));
  assert.equal(migrated.available, false);
  assert.match(migrated.reason || "", /其他操作系统|不是绝对路径/u);
});

test("neutral publication readiness requires one real file and permission for both platforms", () => {
  const wechatOnly = evaluateImagePublishReadiness(image({ allowedPlatforms: ["wechat"] }));
  assert.equal(wechatOnly.ready, false);
  assert.match(wechatOnly.blockers.join("\n"), /xiaoheihe/u);

  assert.equal(isNeutralImagePublishReady(image({ allowedPlatforms: ["*"] })), true);

  const licensed = image({
    rights: "licensed",
    attribution: "Example Photographer / CC BY 4.0",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Example.jpg",
    evidenceNote: "Commons 文件页确认 CC BY 4.0。",
    licenseId: "CC-BY-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    modificationNote: "仅缩放，未裁切或调色。",
    allowedPlatforms: ["wechat", "xiaoheihe"],
  });
  assert.equal(isNeutralImagePublishReady(licensed), true);

  rmSync(licensed.localPath!);
  assert.equal(isNeutralImagePublishReady(licensed), false);
});
