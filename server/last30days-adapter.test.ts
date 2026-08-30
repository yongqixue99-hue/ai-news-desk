import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  discoverLast30Days,
  getLast30DaysStatus,
  parseLast30DaysDiscovery,
  type Last30DaysCommandRunner,
} from "./last30days-adapter.js";

const discoveryJson = JSON.stringify({
  schema_version: "1.0",
  kind: "discovery",
  domain: "AI tools",
  generated_at: "2026-08-27T12:00:00.000Z",
  window_days: 30,
  results: [{
    rank: 1,
    topic: "A community workflow is accelerating",
    why_spiking: "Independent communities converged on the same workflow.",
    momentum: "building",
    velocity_score: 71.2,
    sources: ["reddit", "hackernews"],
    evidence_urls: ["https://news.ycombinator.com/item?id=123"],
    top_comment: "Keep the source material visible.",
    corroboration_count: 2,
  }],
  warnings: [],
  outcome: "ok",
});

test("last30days agent JSON keeps direct evidence and verbatim community context", () => {
  const result = parseLast30DaysDiscovery(discoveryJson);
  assert.equal(result.windowDays, 30);
  assert.equal(result.topics[0].momentum, "building");
  assert.equal(result.topics[0].topComment, "Keep the source material visible.");
  assert.deepEqual(result.topics[0].evidenceUrls, ["https://news.ycombinator.com/item?id=123"]);
});

test("last30days never crosses the first-run consent boundary from a background collection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "news-desk-last30days-"));
  const skillDir = path.join(root, "skill");
  await mkdir(path.join(skillDir, "scripts"), { recursive: true });
  await writeFile(path.join(skillDir, "scripts", "last30days.py"), "# test fixture\n", "utf8");
  const calls: string[][] = [];
  const runner: Last30DaysCommandRunner = async (_command, args) => {
    calls.push(args);
    return { stdout: "3.12\n", stderr: "" };
  };
  try {
    const status = await getLast30DaysStatus({
      cwd: root,
      homeDir: path.join(root, "home"),
      skillDir,
      env: {},
      runCommand: runner,
    });
    assert.equal(status.installed, true);
    assert.equal(status.setupComplete, false);
    assert.equal(status.ready, false);
    assert.match(status.detail, /首次初始化/);

    await assert.rejects(() => discoverLast30Days("AI tools", {
      cwd: root,
      homeDir: path.join(root, "home"),
      skillDir,
      env: {},
      runCommand: runner,
    }), /首次初始化/);
    assert.ok(calls.every((args) => args[0] === "-c"));
    assert.equal(calls.some((args) => args.includes("setup") || args.includes("--allow-browser-cookies")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a configured last30days run uses shallow JSON discovery and no setup command", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "news-desk-last30days-ready-"));
  const skillDir = path.join(root, "skill");
  await mkdir(path.join(skillDir, "scripts"), { recursive: true });
  await writeFile(path.join(skillDir, "scripts", "last30days.py"), "# test fixture\n", "utf8");
  const calls: string[][] = [];
  const runner: Last30DaysCommandRunner = async (_command, args) => {
    calls.push(args);
    return args[0] === "-c"
      ? { stdout: "3.12\n", stderr: "" }
      : { stdout: discoveryJson, stderr: "" };
  };
  try {
    const result = await discoverLast30Days("AI tools", {
      cwd: root,
      homeDir: path.join(root, "home"),
      skillDir,
      env: { SETUP_COMPLETE: "true" },
      runCommand: runner,
    });
    assert.equal(result.topics.length, 1);
    const discoveryCall = calls.find((args) => args[0]?.endsWith("last30days.py"));
    assert.ok(discoveryCall);
    assert.ok(discoveryCall.includes("--discover=AI tools"));
    assert.ok(discoveryCall.includes("--discover-shallow"));
    assert.ok(discoveryCall.includes("--json-profile=agent"));
    assert.equal(discoveryCall.includes("setup"), false);
    assert.equal(discoveryCall.includes("--allow-browser-cookies"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
