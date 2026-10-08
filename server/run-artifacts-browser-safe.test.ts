import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The workbench, community and aggregation views import run-artifacts.ts through
// shared view helpers. A Node built-in there breaks those pages in development.
test("run-artifacts stays free of Node built-ins because browser views load it", async () => {
  const source = await readFile(new URL("./run-artifacts.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from\s+["']node:/u);
});
