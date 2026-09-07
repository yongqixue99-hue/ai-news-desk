import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { findChromeExecutable } from "../../server/chrome-launch.js";

test("native gallery upload verifies every settled image, respects existing work and never clicks publish", { timeout: 30_000 }, async () => {
  const source = await readFile(new URL("../../chrome-extension/background.js", import.meta.url), "utf8");
  const start = source.indexOf("async function uploadImagePostInPage(payload) {");
  const end = source.indexOf("\nchrome.runtime.onMessage.addListener", start);
  assert.ok(start > 0 && end > start);
  const fn = source.slice(start, end);
  const browser = await chromium.launch({ executablePath: await findChromeExecutable(), headless: true });
  try {
    const page = await browser.newPage();
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=";
    await page.route("https://images.example.test/**", route => route.fulfill({ body: Buffer.from(png, "base64"), contentType: "image/png" }));
    await page.setContent('<div class="editor-image-text__image-seletor editor__image-wrapper"><div class="editor-image-wrapper__box upload">上传</div></div><button id="publish">发布</button>');
    await page.evaluate(() => {
      document.querySelector("#publish")!.addEventListener("click", () => document.body.dataset.published = "yes");
      document.querySelector(".upload")!.addEventListener("drop", event => {
        const files = [...(event as DragEvent).dataTransfer!.files];
        document.body.dataset.files = files.map(file => file.name).join(",");
        const gallery = document.querySelector(".editor__image-wrapper")!;
        for (const [index] of files.entries()) {
          const box = document.createElement("div");
          box.className = "editor-image-wrapper__box draggable";
          box.innerHTML = '<div class="editor-image-wrapper__box-uploading">上传中</div>';
          gallery.prepend(box);
          setTimeout(() => box.innerHTML = `<img src="https://images.example.test/${index}.png">`, 80);
        }
      });
    });
    const payload = { jobId: "test-gallery", images: ["first", "second"].map(id => ({ id, fileName: id + ".png", mimeType: "image/png", dataUrl: `data:image/png;base64,${png}` })) };
    const result = await page.evaluate(async ({ fn, payload }) => await (0, eval)(`(${fn})`)(payload), { fn, payload });
    assert.equal(result.ok, true, result.detail);
    assert.equal(await page.locator("body").getAttribute("data-files"), "first.png,second.png");
    const retry = await page.evaluate(async ({ fn, payload }) => await (0, eval)(`(${fn})`)(payload), { fn, payload });
    assert.equal(retry.ok, true);
    const other = await page.evaluate(async ({ fn, payload }) => await (0, eval)(`(${fn})`)({ ...payload, jobId: "different-task" }), { fn, payload });
    assert.equal(other.ok, false);
    assert.equal(await page.locator(".draggable").count(), 2);
    assert.equal(await page.locator("body").getAttribute("data-published"), null);

    // A loading preview or a new image elsewhere on the page must not satisfy upload verification.
    await page.setContent('<div class="editor-image-text__image-seletor editor__image-wrapper"><div class="editor-image-wrapper__box upload">上传</div></div>');
    await page.evaluate(() => document.querySelector(".upload")!.addEventListener("drop", () => {
      document.querySelector(".editor__image-wrapper")!.insertAdjacentHTML("afterbegin", '<div class="editor-image-wrapper__box draggable"><div class="editor-image-wrapper__box-uploading">上传中</div></div>');
      document.body.insertAdjacentHTML("beforeend", '<img src="https://images.example.test/unrelated.png" width="100">');
      setTimeout(() => document.body.append("上传失败"), 350);
    }));
    const failed = await page.evaluate(async ({ fn, payload }) => await (0, eval)(`(${fn})`)(payload), { fn, payload });
    assert.equal(failed.ok, false);
  } finally { await browser.close(); }
});
