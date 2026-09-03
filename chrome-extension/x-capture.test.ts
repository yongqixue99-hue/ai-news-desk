import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("./manifest.json", import.meta.url), "utf8")) as {
  permissions?: string[];
  host_permissions?: string[];
  content_scripts?: Array<{ matches?: string[]; js?: string[] }>;
};
const background = await readFile(new URL("./background.js", import.meta.url), "utf8");

test("X one-click intake uses activeTab without persistent X host access", () => {
  assert.ok(manifest.permissions?.includes("activeTab"));
  assert.ok(!manifest.host_permissions?.some((entry) => /(?:x|twitter)\.com/i.test(entry)));
  assert.ok(!manifest.content_scripts?.some((entry) => (
    entry.matches?.some((match) => /(?:x|twitter)\.com/i.test(match))
    || entry.js?.includes("x-capture.js")
  )));
});

test("X one-click intake sends only a canonical URL for official oEmbed resolution", () => {
  assert.doesNotMatch(background, /x-capture\.js/u);
  assert.doesNotMatch(background, /AI_NEWS_CAPTURE_CURRENT_X_POST/u);
  assert.match(background, /https:\/\/x\.com\/\$\{tabMatch\[1\]\}\/status\/\$\{tabMatch\[2\]\}/u);
  assert.match(background, /text:\s*""/u);
});
