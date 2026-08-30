import assert from "node:assert/strict";
import test from "node:test";
import { collectCommunitySources } from "./community-sources.js";
import type { SourceConfig } from "./types.js";

const zhihuSource: SourceConfig = {
  id: "zhihu-community",
  name: "知乎科技讨论",
  kind: "zhihu",
  homepageUrl: "https://www.zhihu.com/hot",
  query: "人工智能 大模型 科技",
  topicIds: ["ai", "technology"],
  enabled: true,
  selected: true,
  category: "community",
  role: "community",
  discoveryOnly: true,
};

const last30DaysSource: SourceConfig = {
  id: "last30days-community",
  name: "Last30days 社区趋势",
  kind: "last30days",
  homepageUrl: "https://github.com/mvanhorn/last30days-skill",
  topicIds: ["ai", "technology"],
  enabled: true,
  selected: true,
  category: "community",
  role: "community",
  discoveryOnly: true,
};

test("Zhihu CLI search becomes provenance-preserving community discovery items", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const result = await collectCommunitySources([zhihuSource], ["ai"], {}, {
    now: () => new Date("2026-08-18T12:00:00.000Z"),
    runCommand: async (command, args) => {
      calls.push({ command, args });
      return {
        stdout: JSON.stringify([
          {
            rank: 1,
            title: "如何看待某公司发布新的大模型？",
            type: "question",
            author: "示例用户",
            votes: 328,
            url: "https://www.zhihu.com/question/123456",
          },
          { rank: 2, title: "没有链接的结果", votes: 10 },
        ]),
        stderr: "",
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "opencli");
  assert.deepEqual(calls[0].args.slice(0, 4), ["zhihu", "search", "人工智能 大模型 科技", "--limit"]);
  assert.deepEqual(result.failures, {});
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].source_type, "zhihu");
  assert.equal(result.items[0].url, "https://www.zhihu.com/question/123456");
  assert.equal(result.items[0].fetched_at, "2026-08-18T12:00:00.000Z");
  assert.equal(result.items[0].metadata?.feed_name, "知乎科技讨论");
  assert.equal(result.items[0].metadata?.score, 328);
  assert.equal(result.items[0].metadata?.discovery_only, true);
});

test("an unavailable Zhihu login is isolated as a source failure", async () => {
  const result = await collectCommunitySources([zhihuSource], ["ai"], {}, {
    runCommand: async () => {
      throw new Error("知乎 CLI 超时或尚未登录");
    },
  });

  assert.deepEqual(result.items, []);
  assert.match(result.failures[zhihuSource.id], /尚未登录/);
});

test("last30days turns a trend into a direct community candidate without mixing platform engagement", async () => {
  const calls: string[] = [];
  const result = await collectCommunitySources([last30DaysSource], ["ai"], { keywords: "AI 编程" }, {
    now: () => new Date("2026-08-27T12:00:00.000Z"),
    last30DaysDiscover: async (domain) => {
      calls.push(domain);
      return {
        domain,
        generatedAt: "2026-08-27T11:58:00.000Z",
        windowDays: 30,
        outcome: "ok",
        warnings: [],
        topics: [{
          rank: 1,
          topic: "Developers are replacing brittle coding workflows",
          whySpiking: "Three communities discussed the same failure mode this week.",
          momentum: "new-this-week",
          velocityScore: 82.5,
          sources: ["reddit", "hackernews", "web"],
          evidenceUrls: [
            "https://example.com/analysis",
            "https://www.reddit.com/r/programming/comments/example/thread/",
          ],
          topComment: "The useful part is the review loop, not another wrapper.",
          corroborationCount: 3,
        }],
      };
    },
  });

  assert.deepEqual(calls, ["AI 编程"]);
  assert.deepEqual(result.failures, {});
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].source_type, "last30days");
  assert.equal(result.items[0].url, "https://www.reddit.com/r/programming/comments/example/thread/");
  assert.match(result.items[0].content ?? "", /社区原句/);
  assert.equal(result.items[0].metadata?.source_role, "community");
  assert.equal(result.items[0].metadata?.last30days_velocity, 82.5);
  assert.equal(result.items[0].metadata?.score, undefined);
  assert.equal(result.items[0].metadata?.comment_count, undefined);
});

test("a last30days setup problem does not stop other community connectors", async () => {
  const result = await collectCommunitySources([last30DaysSource], ["ai"], {}, {
    last30DaysDiscover: async () => {
      throw new Error("尚未完成首次初始化；不会读取浏览器 Cookie");
    },
  });

  assert.deepEqual(result.items, []);
  assert.match(result.failures[last30DaysSource.id], /首次初始化/);
});
