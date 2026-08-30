import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { loadWeChatImageFile, loadWeChatPlacementImage } from "./wechat-image.js";

test("WeChat images are converted to a safe JPEG below the platform upload limit", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ai-news-wechat-image-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const inputPath = path.join(directory, "超大封面.png");
  await sharp({
    create: {
      width: 2400,
      height: 1600,
      channels: 4,
      background: { r: 28, g: 36, b: 58, alpha: 0.72 },
    },
  }).png({ compressionLevel: 0 }).toFile(inputPath);
  assert.ok((await stat(inputPath)).size > 1_000_000, "the fixture should exceed WeChat's limit");

  const asset = await loadWeChatImageFile(inputPath);
  const metadata = await sharp(asset.bytes).metadata();

  assert.equal(asset.contentType, "image/jpeg");
  assert.equal(asset.fileName, "超大封面.jpg");
  assert.ok(asset.bytes.byteLength <= 1_000_000);
  assert.equal(metadata.format, "jpeg");
  assert.ok((metadata.width ?? Infinity) <= 1600);
});

test("a mutable draft cannot make WeChat sync read an image outside managed media", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ai-news-wechat-escape-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const inputPath = path.join(directory, "outside.png");
  await sharp({ create: { width: 20, height: 20, channels: 3, background: "#334155" } })
    .png()
    .toFile(inputPath);

  await assert.rejects(loadWeChatPlacementImage({
    id: "placement-outside",
    afterParagraph: 0,
    caption: "越界图片",
    image: {
      id: "image-outside",
      url: "/media/outside.png",
      localPath: inputPath,
      caption: "越界图片",
      attribution: "测试",
      sourceUrl: "https://example.com/image",
      selected: true,
      rights: "owned",
      allowedPlatforms: ["wechat"],
    },
  }), /受管目录|拒绝读取/);
});
