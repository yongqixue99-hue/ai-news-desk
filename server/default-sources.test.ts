import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultState, defaultSources, upgradeState } from "./defaults.js";
import { buildHorizonConfig, horizonSourceKindsFor } from "./horizon.js";

test("default sources are classified by editorial role and ship useful topic bundles", () => {
  const validRoles = new Set(["official", "verification", "research", "discovery", "community"]);
  assert.ok(defaultSources.length > 23);
  assert.equal(new Set(defaultSources.map((source) => source.id)).size, defaultSources.length);
  assert.ok(defaultSources.every((source) => validRoles.has(source.role ?? "")));

  const state = createDefaultState();
  const dailyAi = state.sourcePresets.find((preset) => preset.id === "preset_ai_daily");
  const discovery = state.sourcePresets.find((preset) => preset.id === "preset_discovery");
  const expanded = state.sourcePresets.find((preset) => preset.id === "preset_ai_expanded");
  const esports = state.sourcePresets.find((preset) => preset.id === "preset_esports");
  assert.ok(dailyAi);
  assert.ok(discovery);
  assert.ok(expanded);
  assert.ok(esports);
  assert.equal(state.sources.find((source) => source.id === "hackernews")?.role, "community");
  assert.ok(dailyAi.sourceIds.includes("openai-official"));
  assert.ok(dailyAi.sourceIds.includes("x-ai-official"));
  assert.ok(dailyAi.sourceIds.includes("reuters-ai"));
  assert.ok(discovery.sourceIds.includes("google-news-ai"));
  assert.ok(discovery.sourceIds.includes("last30days-community"));
  assert.ok(discovery.sourceIds.includes("zhihu-community"));
  assert.ok(expanded.sourceIds.includes("venturebeat-ai"));
  assert.ok(expanded.sourceIds.includes("microsoft-research"));
  assert.ok(expanded.sourceIds.includes("qbitai"));
  assert.ok(esports.sourceIds.includes("lpl-official"));
});

test("last30days is available as an opt-in community trend source", () => {
  const source = defaultSources.find((entry) => entry.id === "last30days-community");
  assert.ok(source);
  assert.equal(source.kind, "last30days");
  assert.equal(source.role, "community");
  assert.equal(source.discoveryOnly, true);
  assert.equal(source.enabled, true);
  assert.equal(source.selected, false);
  assert.match(source.note ?? "", /不会读取浏览器 Cookie/);
});

test("Zhihu is a disabled-by-default community discovery source until its CLI login is ready", () => {
  const source = defaultSources.find((entry) => entry.id === "zhihu-community");
  assert.ok(source);
  assert.equal(source.kind, "zhihu");
  assert.equal(source.role, "community");
  assert.equal(source.discoveryOnly, true);
  assert.equal(source.enabled, false);
  assert.equal(source.selected, false);
});

test("X official accounts ship as an opt-in first-party source until a bearer token is configured", () => {
  const source = defaultSources.find((entry) => entry.id === "x-ai-official");
  assert.ok(source);
  assert.equal(source.kind, "x");
  assert.equal(source.role, "official");
  assert.equal(source.discoveryOnly, false);
  assert.equal(source.enabled, false);
  assert.equal(source.selected, false);
  assert.match(source.query ?? "", /OpenAI/);
  assert.deepEqual(horizonSourceKindsFor([source]), []);
});

test("NVIDIA keeps official provenance while using a resilient site-scoped discovery route", () => {
  const source = defaultSources.find((entry) => entry.id === "nvidia-official");
  assert.ok(source);
  assert.equal(source.role, "official");
  assert.equal(source.homepageUrl, "https://www.nvidia.com/en-us/about-nvidia/rss/");
  assert.ok(source.routes?.length);
  assert.ok(source.routes?.every((route) => !route.url && route.query?.includes("site:blogs.nvidia.com")));
});

test("legacy zero-item warnings from a mismatched topic are repaired without clearing real errors", () => {
  const state = createDefaultState();
  const lpl = state.sources.find((source) => source.id === "lpl-official");
  const hltv = state.sources.find((source) => source.id === "hltv");
  assert.ok(lpl);
  assert.ok(hltv);
  lpl.health = "warning";
  lpl.lastRawCount = 0;
  lpl.lastHealthDetail = "本轮没有读取到条目";
  lpl.consecutiveFailures = 8;
  hltv.health = "error";
  hltv.lastRawCount = 0;
  hltv.lastHealthDetail = "来源测试超时";
  hltv.consecutiveFailures = 2;

  const upgraded = upgradeState(state);
  const repaired = upgraded.sources.find((source) => source.id === lpl.id);
  const preserved = upgraded.sources.find((source) => source.id === hltv.id);
  assert.equal(repaired?.health, "unknown");
  assert.equal(repaired?.consecutiveFailures, 0);
  assert.match(repaired?.lastHealthDetail ?? "", /未参与当前 AI 频道/);
  assert.equal(preserved?.health, "error");
  assert.equal(preserved?.consecutiveFailures, 2);
});

test("Horizon receives comprehensive news search as RSS instead of its empty adapter", () => {
  const source = defaultSources.find((entry) => entry.id === "google-news-ai");
  assert.ok(source);
  const config = buildHorizonConfig([source], 20, ["ai"]);
  assert.equal(config.sources.google_news.enabled, false);
  assert.equal(config.sources.rss.length, 1);
  assert.deepEqual(horizonSourceKindsFor([source]), ["rss"]);
});

test("v11 personal state gains classified V2EX and GitHub sources without losing stored source choices", () => {
  const legacy = createDefaultState();
  legacy.version = 11 as 14;
  legacy.sources = legacy.sources.filter((source) => !["v2ex-community", "github-project-community"].includes(source.id));
  const openai = legacy.sources.find((source) => source.id === "openai-official");
  assert.ok(openai);
  openai.selected = false;
  for (const preset of legacy.sourcePresets) {
    preset.sourceIds = preset.sourceIds.filter((sourceId) => !["v2ex-community", "github-project-community"].includes(sourceId));
  }

  const upgraded = upgradeState(legacy);
  assert.equal(upgraded.version, 14);
  assert.equal(upgraded.sources.find((source) => source.id === "openai-official")?.selected, false);
  assert.equal(upgraded.sources.find((source) => source.id === "v2ex-community")?.role, "community");
  assert.equal(upgraded.sources.find((source) => source.id === "github-project-community")?.kind, "github");
  assert.ok(upgraded.sourcePresets.find((preset) => preset.id === "preset_discovery")?.sourceIds.includes("v2ex-community"));
  assert.ok(upgraded.sourcePresets.find((preset) => preset.id === "preset_discovery")?.sourceIds.includes("github-project-community"));
});

test("v12 personal state adds the new X source to the AI daily preset exactly once", () => {
  const legacy = createDefaultState();
  legacy.version = 12 as typeof legacy.version;
  const daily = legacy.sourcePresets.find((preset) => preset.id === "preset_ai_daily");
  assert.ok(daily);
  daily.sourceIds = daily.sourceIds.filter((sourceId) => sourceId !== "x-ai-official");

  const upgraded = upgradeState(legacy);
  const sourceIds = upgraded.sourcePresets.find((preset) => preset.id === "preset_ai_daily")?.sourceIds ?? [];
  assert.equal(upgraded.version, 14);
  assert.equal(sourceIds.filter((sourceId) => sourceId === "x-ai-official").length, 1);
});
