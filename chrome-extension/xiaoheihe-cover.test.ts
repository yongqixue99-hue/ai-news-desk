import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const script = (await readFile(new URL("./xiaoheihe-cover.js", import.meta.url), "utf8")).replace("export async function", "async function");

// The live platform retains its default icon at opacity: 0 after upload.
// A loaded thumbnail, rather than absence of that fallback node, confirms success.
async function uploadWithThumbnail(opacity: string) {
  let supplied = false;
  const fallback = { style: { visibility: "visible", opacity: "0" }, getBoundingClientRect: () => ({ width: 200 }) };
  const image = {
    src: "https://img.example.test/uploaded-cover.png", complete: true, naturalWidth: 1275,
    style: { visibility: "visible", opacity }, getBoundingClientRect: () => ({ width: 200 }),
    closest: () => ({ querySelector: () => fallback }),
  };
  const input = { type: "file", files: [], dispatchEvent() { supplied = true; } };
  const selector = { querySelector: (query: string) => query === 'input[type="file"]' ? input : null };
  const trigger = { getBoundingClientRect: () => ({ width: 100 }), style: { visibility: "visible", opacity: "1" }, click() {} };
  const context = vm.createContext({
    document: { querySelector: (query: string) => query.includes("thumb-card__image") ? supplied ? image : null : query.includes("thumb-card__corner") ? trigger : selector },
    getComputedStyle: (element: typeof image) => element.style,
    fetch: async () => ({ blob: async () => new Blob(["fixture"]) }), Blob, File, Event,
    DataTransfer: class { files = []; items = { add() {} }; },
    HTMLInputElement: class { click() {} },
    setTimeout: (callback: () => void) => { callback(); },
  });
  vm.runInContext(script, context);
  return context.uploadCoverInPage({ dataUrl: "data:image/png;base64,AA==", fileName: "cover.png", mimeType: "image/png" });
}

test("cover upload accepts the live platform's loaded thumbnail with a retained hidden fallback", async () => {
  assert.equal((await uploadWithThumbnail("1")).ok, true);
});

test("cover upload does not report success while its thumbnail remains hidden", async () => {
  assert.equal((await uploadWithThumbnail("0")).ok, false);
});
