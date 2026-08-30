import assert from "node:assert/strict";
import test from "node:test";
import { skillsForArticleTask, skillsForWritingReview } from "./skill-registry.js";
import type { AiSettings, ArticleSkillConfig } from "./types.js";

const skill = (value: Partial<ArticleSkillConfig> & Pick<ArticleSkillConfig, "id" | "name">): ArticleSkillConfig => ({
  description: "test",
  sourcePath: "/tmp/SKILL.md",
  enabled: true,
  builtIn: false,
  compatibility: "prompt-compatible",
  importedAt: "2026-08-26T00:00:00.000Z",
  ...value,
});

test("article skills are scoped so source research and humanization do not pollute every prompt", () => {
  const skills = [
    skill({ id: "news-desk", name: "news-desk", compatibility: "codex-native", scopes: ["generation", "analysis"] }),
    skill({ id: "ra-renhua", name: "ra-人话", scopes: ["optimization"] }),
    skill({ id: "custom", name: "自定义改稿", scopes: ["optimization"] }),
  ];

  assert.deepEqual(skillsForArticleTask(skills, "generation").map((item) => item.id), ["news-desk"]);
  assert.deepEqual(skillsForArticleTask(skills, "analysis").map((item) => item.id), ["news-desk"]);
  assert.deepEqual(skillsForArticleTask(skills, "optimization").map((item) => item.id), ["ra-renhua", "custom"]);
});

test("legacy skills get conservative inferred scopes", () => {
  const skills = [
    skill({ id: "agent-reach", name: "agent-reach", compatibility: "codex-native" }),
    skill({ id: "legacy-writing", name: "我的写作规则" }),
  ];

  assert.deepEqual(skillsForArticleTask(skills, "generation").map((item) => item.id), ["agent-reach"]);
  assert.deepEqual(skillsForArticleTask(skills, "optimization").map((item) => item.id), ["legacy-writing"]);
});

test("auto writing review always audits with lieflat but reserves voice shaping for commentary", () => {
  const skills = [
    skill({ id: "lieflat-less-ai-tone", name: "lieflat-less-ai-tone", scopes: ["optimization"] }),
    skill({ id: "ra-renhua", name: "ra-人话", scopes: ["optimization"] }),
    skill({ id: "house-rules", name: "编辑部规则", scopes: ["optimization"] }),
  ];
  const settings = { skills, writingReviewMode: "auto" } as Pick<AiSettings, "skills" | "writingReviewMode">;

  assert.deepEqual(skillsForWritingReview(settings, "brief").map((item) => item.id), [
    "lieflat-less-ai-tone",
    "house-rules",
  ]);
  assert.deepEqual(skillsForWritingReview(settings, "commentary").map((item) => item.id), [
    "lieflat-less-ai-tone",
    "ra-renhua",
    "house-rules",
  ]);
});

test("minimal and off modes never silently invoke a voice rewrite", () => {
  const skills = [
    skill({ id: "lieflat-less-ai-tone", name: "lieflat-less-ai-tone", scopes: ["optimization"] }),
    skill({ id: "ra-renhua", name: "ra-人话", scopes: ["optimization"] }),
  ];

  assert.deepEqual(skillsForWritingReview({ skills, writingReviewMode: "minimal" }, "brief").map((item) => item.id), ["lieflat-less-ai-tone"]);
  assert.deepEqual(skillsForWritingReview({ skills, writingReviewMode: "off" }, "commentary").map((item) => item.id), []);
});
