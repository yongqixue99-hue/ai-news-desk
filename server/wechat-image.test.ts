import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { loadWeChatImageFile, loadWeChatPlacementImage } from "./wechat-image.js";
import { workflowMediaRoot } from "./storage.js";

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
  const fingerprint = createHash("sha256").update(await readFile(inputPath)).digest("hex");

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
      fingerprint,
    },
  }), /受管目录|拒绝读取/);
});

test("WeChat rejects a managed image whose bytes changed after draft review", async (context) => {
  await mkdir(workflowMediaRoot, { recursive: true });
  const directory = await mkdtemp(path.join(workflowMediaRoot, "wechat-fingerprint-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const inputPath = path.join(directory, "cover.png");
  await sharp({ create: { width: 40, height: 40, channels: 3, background: "#334155" } })
    .png()
    .toFile(inputPath);
  const reviewedFingerprint = createHash("sha256").update(await readFile(inputPath)).digest("hex");
  await sharp({ create: { width: 40, height: 40, channels: 3, background: "#dc2626" } })
    .png()
    .toFile(inputPath);

  await assert.rejects(loadWeChatPlacementImage({
    id: "placement-replaced",
    afterParagraph: 0,
    caption: "已替换封面",
    image: {
      id: "image-replaced",
      url: "/media/cover.png",
      localPath: inputPath,
      publicPath: "/media/cover.png",
      caption: "已替换封面",
      attribution: "测试",
      sourceUrl: "https://example.com/image",
      selected: true,
      rights: "owned",
      allowedPlatforms: ["wechat"],
      fingerprint: reviewedFingerprint,
    },
  }), /文件.*变化|重新插入/u);
});

test("WeChat accepts a managed image when its reviewed SHA-256 still matches", async (context) => {
  await mkdir(workflowMediaRoot, { recursive: true });
  const directory = await mkdtemp(path.join(workflowMediaRoot, "wechat-matching-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const inputPath = path.join(directory, "cover.png");
  await sharp({ create: { width: 40, height: 40, channels: 3, background: "#16a34a" } })
    .png()
    .toFile(inputPath);
  const fingerprint = createHash("sha256").update(await readFile(inputPath)).digest("hex");

  const asset = await loadWeChatPlacementImage({
    id: "placement-matching",
    afterParagraph: 0,
    caption: "已审核封面",
    image: {
      id: "image-matching",
      url: "/media/cover.png",
      localPath: inputPath,
      publicPath: "/media/cover.png",
      caption: "已审核封面",
      attribution: "测试",
      sourceUrl: "https://example.com/image",
      selected: true,
      rights: "owned",
      allowedPlatforms: ["wechat"],
      fingerprint,
    },
  });

  assert.equal(asset.contentType, "image/jpeg");
  assert.ok(asset.bytes.length > 0);
});

test("WeChat blocks a draft image with no reviewed SHA-256", async () => {
  await assert.rejects(loadWeChatPlacementImage({
    id: "placement-unreviewed",
    afterParagraph: 0,
    caption: "未审核封面",
    image: {
      id: "image-unreviewed",
      url: "/media/missing.png",
      localPath: path.join(workflowMediaRoot, "missing.png"),
      publicPath: "/media/missing.png",
      caption: "未审核封面",
      attribution: "测试",
      sourceUrl: "https://example.com/image",
      selected: true,
      rights: "owned",
      allowedPlatforms: ["wechat"],
    },
  }), /缺少已审核.*SHA-256.*重新插入/u);
});
