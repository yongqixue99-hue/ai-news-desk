import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { workspacePath } from "./storage.js";
import type {
  AiSettings,
  ArticleDraftStrategy,
  ArticleSkillConfig,
  ArticleSkillScope,
} from "./types.js";

const allowedRoots = [
  path.join(homedir(), ".codex", "skills"),
  path.join(homedir(), ".agents", "skills"),
  workspacePath(),
];

const within = (child: string, parent: string) =>
  child === parent || child.startsWith(`${parent}${path.sep}`);

const frontmatterValue = (content: string, key: string) => {
  const frontmatter = /^---\s*\n([\s\S]*?)\n---/m.exec(content)?.[1] ?? "";
  return new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, "mi").exec(frontmatter)?.[1]?.trim();
};

export const readSkillInstructions = async (skill: ArticleSkillConfig, maximum = 32_000) => {
  try {
    return (await readFile(skill.sourcePath, "utf8")).slice(0, maximum);
  } catch {
    return "";
  }
};

const inferredScopes = (skill: ArticleSkillConfig): ArticleSkillScope[] => {
  const identity = `${skill.id} ${skill.name}`.toLocaleLowerCase("zh-CN");
  if (identity.includes("news-desk") || identity.includes("agent-reach")) {
    return ["generation", "analysis"];
  }
  return ["optimization"];
};

/** Keep research and style instructions in the tasks where they are useful. */
export const skillsForArticleTask = (
  skills: ArticleSkillConfig[],
  task: ArticleSkillScope,
) => skills.filter((skill) => skill.enabled && (
  Array.isArray(skill.scopes) && skill.scopes.length ? skill.scopes : inferredScopes(skill)
).includes(task));

const isLieflatSkill = (skill: ArticleSkillConfig) =>
  `${skill.id} ${skill.name}`.toLocaleLowerCase("zh-CN").includes("lieflat");

const isVoiceShapingSkill = (skill: ArticleSkillConfig) => {
  const identity = `${skill.id} ${skill.name}`.toLocaleLowerCase("zh-CN");
  return identity.includes("ra-renhua")
    || identity.includes("ra-人话")
    || identity.includes("humanizer")
    || identity.includes("human-writing")
    || identity.includes("ljg-plain");
};

/** Apply the user's review mode without turning every enabled writing Skill into a mandatory rewrite. */
export const skillsForWritingReview = (
  settings: Pick<AiSettings, "skills" | "writingReviewMode">,
  strategy: ArticleDraftStrategy,
) => {
  const optimizationSkills = skillsForArticleTask(settings.skills, "optimization");
  if (settings.writingReviewMode === "off") {
    return optimizationSkills.filter((skill) => !isLieflatSkill(skill) && !isVoiceShapingSkill(skill));
  }
  if (settings.writingReviewMode === "minimal") {
    return optimizationSkills.filter((skill) => !isVoiceShapingSkill(skill));
  }
  if (settings.writingReviewMode === "voice") return optimizationSkills;
  // Auto keeps briefs and synthesis source-shaped. Personal voice is added
  // only after the user explicitly supplies a commentary angle.
  return strategy === "commentary"
    ? optimizationSkills
    : optimizationSkills.filter((skill) => !isVoiceShapingSkill(skill));
};

export const importArticleSkill = async (rawPath: string): Promise<ArticleSkillConfig> => {
  const requested = path.resolve(rawPath.trim());
  const requestedStat = await stat(requested).catch(() => undefined);
  if (!requestedStat) throw new Error("没有找到这个 Skill 路径");
  const skillPath = requestedStat.isDirectory() ? path.join(requested, "SKILL.md") : requested;
  if (path.basename(skillPath).toLowerCase() !== "skill.md") {
    throw new Error("请选择 Skill 文件夹或其中的 SKILL.md");
  }
  const resolved = await realpath(skillPath);
  const realRoots = await Promise.all(allowedRoots.map((root) => realpath(root).catch(() => path.resolve(root))));
  if (!realRoots.some((root) => within(resolved, root))) {
    throw new Error("只允许导入工作区、~/.codex/skills 或 ~/.agents/skills 下的 Skill");
  }
  const content = await readFile(resolved, "utf8");
  if (!content.trim()) throw new Error("SKILL.md 内容为空");
  const folderName = path.basename(path.dirname(resolved));
  const name = frontmatterValue(content, "name") || folderName;
  const description = frontmatterValue(content, "description")
    || content.replace(/^---[\s\S]*?---/m, "").replace(/^#+\s*/gm, "").replace(/\s+/g, " ").trim().slice(0, 160)
    || "自定义文章生成规则";
  return {
    id: `skill_${createHash("sha1").update(resolved).digest("hex").slice(0, 10)}`,
    name: name.slice(0, 80),
    description: description.slice(0, 220),
    sourcePath: resolved,
    enabled: true,
    builtIn: false,
    compatibility: "prompt-compatible",
    scopes: ["optimization"],
    importedAt: new Date().toISOString(),
  };
};
