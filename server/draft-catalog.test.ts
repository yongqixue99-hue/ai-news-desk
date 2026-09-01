import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDraftCatalog } from "./draft-catalog.js";
import type { ArticleDraft } from "./types.js";

const draft = (
  id: string,
  overrides: Partial<ArticleDraft> = {},
): ArticleDraft => ({
  id,
  runId: "run-open-executive",
  candidateId: "candidate-open-executive",
  createdAt: "2026-09-01T01:00:00.000Z",
  updatedAt: "2026-09-01T01:00:00.000Z",
  status: "editing",
  title: id,
  draftStrategy: "brief",
  paragraphs: ["Open Executive 是一个开源多代理项目。"],
  take: "",
  bodyHtml: "<p>Open Executive 是一个开源多代理项目。</p>",
  sources: [],
  factClaims: [],
  uncertainties: [],
  images: [],
  community: "",
  topics: ["AI"],
  provenance: {
    originalUrl: "https://github.com/SenteLabsAI/OpenExecutive",
    generatedBy: "codex-cli",
  },
  ...overrides,
});

test("a current source-first draft safely shelves obsolete drafts for the same candidate", () => {
  const obsoleteTranslation = draft("draft-translation", {
    title: "CEO 为给 AI 腾位置裁掉开发者",
    provenance: {
      originalUrl: "https://news.ycombinator.com/item?id=49458418",
      generatedBy: "codex-cli",
    },
  });
  const obsoleteSourceFirst = draft("draft-v6", {
    createdAt: "2026-09-01T02:00:00.000Z",
    updatedAt: "2026-09-01T02:00:00.000Z",
    provenance: {
      originalUrl: "https://github.com/SenteLabsAI/OpenExecutive",
      generatedBy: "codex-cli",
      contentPackageId: "package-open-executive",
      generatorRevision: "source-first-v6",
    },
  });
  const current = draft("draft-v8", {
    createdAt: "2026-09-01T03:00:00.000Z",
    updatedAt: "2026-09-01T03:00:00.000Z",
    provenance: {
      originalUrl: "https://github.com/SenteLabsAI/OpenExecutive",
      generatedBy: "codex-cli",
      storyId: "story-open-executive",
      contentPackageId: "package-open-executive",
      generatorRevision: "source-first-v8",
    },
  });

  const normalized = normalizeDraftCatalog([obsoleteTranslation, obsoleteSourceFirst, current]);
  const byId = new Map(normalized.map((entry) => [entry.id, entry]));

  assert.equal(byId.get("draft-v8")?.status, "editing");
  assert.equal(byId.get("draft-v6")?.status, "shelved");
  assert.equal(byId.get("draft-translation")?.status, "shelved");
  assert.equal(byId.get("draft-v6")?.provenance.supersededByDraftId, "draft-v8");
  assert.equal(byId.get("draft-translation")?.provenance.supersededByDraftId, "draft-v8");
});

test("a delivered historical draft remains visible and is never auto-shelved", () => {
  const published = draft("draft-published", {
    status: "published",
    updatedAt: "2026-08-31T23:00:00.000Z",
  });
  const current = draft("draft-v8", {
    updatedAt: "2026-09-01T03:00:00.000Z",
    provenance: {
      originalUrl: "https://github.com/SenteLabsAI/OpenExecutive",
      generatedBy: "codex-cli",
      contentPackageId: "package-open-executive",
      generatorRevision: "source-first-v8",
    },
  });

  const normalized = normalizeDraftCatalog([published, current]);

  assert.equal(normalized.find((entry) => entry.id === published.id)?.status, "published");
  assert.equal(normalized.find((entry) => entry.id === published.id)?.provenance.supersededByDraftId, undefined);
});

test("two current-revision alternatives are preserved instead of silently choosing for the user", () => {
  const news = draft("draft-news", {
    provenance: {
      originalUrl: "https://github.com/SenteLabsAI/OpenExecutive",
      generatedBy: "codex-cli",
      contentPackageId: "package-news",
      generatorRevision: "source-first-v8",
    },
  });
  const community = draft("draft-community", {
    provenance: {
      originalUrl: "https://news.ycombinator.com/item?id=49458418",
      generatedBy: "codex-cli",
      contentPackageId: "package-community",
      generatorRevision: "source-first-v8",
    },
  });

  const normalized = normalizeDraftCatalog([news, community]);

  assert.deepEqual(normalized.map((entry) => entry.status), ["editing", "editing"]);
});

test("two legacy editing attempts for the exact same source keep only the newest in the primary library", () => {
  const older = draft("draft-legacy-older", {
    createdAt: "2026-08-11T12:14:13.671Z",
    updatedAt: "2026-08-11T12:14:13.671Z",
    title: "OpenAI 披露内部财务 AI 改造",
    provenance: {
      originalUrl: "https://openai.com/index/building-an-ai-native-finance-function",
      generatedBy: "codex-cli",
    },
  });
  const newer = draft("draft-legacy-newer", {
    createdAt: "2026-08-11T12:15:20.682Z",
    updatedAt: "2026-08-11T12:15:20.682Z",
    title: "OpenAI 公开 AI 原生财务部做法",
    provenance: {
      originalUrl: "https://openai.com/index/building-an-ai-native-finance-function",
      generatedBy: "codex-cli",
    },
  });

  const normalized = normalizeDraftCatalog([older, newer]);
  const byId = new Map(normalized.map((entry) => [entry.id, entry]));

  assert.equal(byId.get(newer.id)?.status, "editing");
  assert.equal(byId.get(older.id)?.status, "shelved");
  assert.equal(byId.get(older.id)?.provenance.supersededByDraftId, newer.id);
});
