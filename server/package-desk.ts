import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AssetCandidate,
  AssignmentMode,
  ContentPackage,
  ContentPackageSource,
  DiscussionSample,
  EditorialIntent,
  EvidenceClaim,
  SourceMaterialSnapshot,
  StoryView,
} from "./product-types.js";
import { storyById } from "./story-desk.js";
import { recommendMaterialCandidates } from "./material-recommendation.js";
import {
  inspectLocalImageFile,
  isLocalImageFileReady,
} from "./image-readiness.js";
import { workflowMediaRoot } from "./storage.js";
import {
  evaluateMaterialPublishEligibility,
  normalizeGovernedMaterial,
} from "./material-governance.js";
import { uniqueEligibleEditorialImages } from "./editorial-image-policy.js";
import { isCommunityDiscoveryFraming } from "./editorial-source-policy.js";
import type { Candidate, SourceImage, WorkflowState } from "./types.js";

const signalIdFor = (runId: string, candidateId: string) => `${runId}:${candidateId}`;
const compactWhitespace = (value: string) => value.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();

const splitClaims = (value: string) => compactWhitespace(value)
  .split(/(?<=[。！？!?；;])\s*|\n+/u)
  .map((item) => item.trim())
  .filter((item) => item.length >= 18 && item.length <= 260)
  .slice(0, 3);

const normalizedClaim = (value: string) => value
  .normalize("NFKC")
  .toLocaleLowerCase()
  .replace(/[\s，。！？、；：,.!?;:'"“”‘’（）()【】\[\]-]+/gu, "")
  .slice(0, 180);

const domainFor = (value: string) => {
  try { return new URL(value).hostname.replace(/^www\./u, ""); } catch { return value; }
};

const candidateForSignal = (state: WorkflowState, runId: string, candidateId: string) =>
  state.runs.find((run) => run.id === runId)?.candidates.find((candidate) => candidate.id === candidateId);

const evidenceClaimsFor = (state: WorkflowState, story: StoryView): EvidenceClaim[] => {
  const candidates = story.signals
    .filter((signal) => signal.factBearing ?? !signal.isCommunity)
    .map((signal) => ({
      signal,
      candidate: candidateForSignal(state, signal.runId, signal.candidateId),
    }))
    .filter((entry): entry is typeof entry & { candidate: Candidate } => Boolean(entry.candidate));
  const groups = new Map<string, Array<{ text: string; signalId: string; candidate: Candidate }>>();

  for (const { signal, candidate } of candidates) {
    const explanation = candidate.briefing?.explanation;
    const sourceTexts = [
      candidate.briefing?.summaryZh,
      ...(signal.linkedSource ? [] : [explanation?.whatHappenedZh]),
      ...(explanation?.keyPointsZh ?? []),
    ].filter((value): value is string => Boolean(value?.trim()));
    const claims = sourceTexts.flatMap(splitClaims).filter((text) => !isCommunityDiscoveryFraming(text));
    const fallbackText = candidate.briefing?.summaryZh || candidate.excerpt || candidate.title;
    const fallbackClaims = [compactWhitespace(fallbackText)].filter((text) => !isCommunityDiscoveryFraming(text));
    for (const text of claims.length ? claims : fallbackClaims) {
      const key = normalizedClaim(text);
      if (!key) continue;
      const items = groups.get(key) ?? [];
      items.push({ text, signalId: signalIdFor(signal.runId, signal.candidateId), candidate });
      groups.set(key, items);
    }
  }

  return [...groups.values()].slice(0, 16).map((support, index) => {
    const domains = new Set(support.map((item) => domainFor(item.candidate.canonicalUrl || item.candidate.url)));
    const hasOfficial = support.some((item) => item.candidate.sourceRole === "official");
    const hasFullSource = support.some((item) => item.candidate.briefing?.basis === "full-source");
    const onlyTitle = support.every((item) => !item.candidate.briefing || item.candidate.briefing.basis === "title");
    const status: EvidenceClaim["status"] = onlyTitle
      ? "unverified"
      : domains.size >= 2 || hasOfficial || hasFullSource
        ? "supported"
        : "partially-supported";
    const text = support[0]!.text;
    return {
      id: `claim_${createHash("sha1").update(`${story.id}:${index}:${text}`).digest("hex").slice(0, 12)}`,
      text,
      status,
      sourceSignalIds: [...new Set(support.map((item) => item.signalId))],
      sourceUrls: [...new Set(support.map((item) => item.candidate.canonicalUrl || item.candidate.url))],
      note: status === "unverified"
        ? "当前只有标题级信息；写稿和同步前必须补充正文证据。"
        : status === "partially-supported"
          ? "只有一个独立来源支持，成稿时应使用克制表述。"
          : domains.size >= 2
            ? `由 ${domains.size} 个独立站点支持。`
            : hasOfficial
              ? "由官方来源直接支持。"
              : "已读取来源正文。",
    };
  });
};

const sourceLabelFor = (url: string, fallback: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./u, "") || fallback;
  } catch {
    return fallback;
  }
};

/**
 * One link-post record represents two editorial resources: the linked page is
 * factual source material and the discussion URL is community context. Split
 * them here so downstream writing never has to infer which URL proves what.
 */
const packageSourcesFor = (story: StoryView): ContentPackageSource[] => {
  const sources = story.signals.flatMap((signal) => {
    const signalId = signalIdFor(signal.runId, signal.candidateId);
    const basis = signal.briefingBasis ?? "title";
    const entries: ContentPackageSource[] = [];
    if (signal.factBearing ?? !signal.isCommunity) {
      entries.push({
        signalId,
        label: signal.linkedSource ? sourceLabelFor(signal.url, signal.sourceName) : signal.sourceName,
        url: signal.url,
        role: signal.sourceRole === "community" ? "discovery" : signal.sourceRole || "discovery",
        basis,
        publishedAt: signal.publishedAt,
        isCommunity: false,
      });
    }
    if (signal.isCommunity) {
      entries.push({
        signalId,
        label: signal.sourceName,
        url: signal.discussionUrl || signal.url,
        role: "community",
        basis: signal.discussionUrl ? "excerpt" : basis,
        publishedAt: signal.publishedAt,
        isCommunity: true,
      });
    }
    return entries;
  });
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.isCommunity ? "community" : "fact"}:${source.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const sampleKindFor = (text: string): DiscussionSample["kind"] => {
  if (/\?|？|how|怎么|为何|为什么|有没有/iu.test(text)) return "question";
  if (/解决|方法|可以试|workaround|fix|步骤|配置|安装|部署/iu.test(text)) return "solution";
  if (/我用|我们用|试过|experience|tested|in production|实测|遇到/iu.test(text)) return "experience";
  if (/未来|将会|可能|predict|expect|会不会/iu.test(text)) return "prediction";
  if (/但是|不过|反对|不同意|并不|yet|however|disagree|问题在于/iu.test(text)) return "counterpoint";
  return "opinion";
};

const discussionSamplesFor = (state: WorkflowState, story: StoryView): DiscussionSample[] => {
  const samples: DiscussionSample[] = [];
  for (const signal of story.signals.filter((item) => item.isCommunity)) {
    const candidate = candidateForSignal(state, signal.runId, signal.candidateId);
    if (!candidate) continue;
    const matches = [...candidate.excerpt.matchAll(/\[([^\]]{1,80})\]:\s*([\s\S]{20,}?)(?=\s+\[[^\]]{1,80}\]:|$)/gu)];
    const rawSamples = matches.length
      ? matches.map((match) => ({ author: compactWhitespace(match[1]!), text: compactWhitespace(match[2]!) }))
      : candidate.author && candidate.excerpt.length >= 40
        ? [{ author: candidate.author, text: compactWhitespace(candidate.excerpt) }]
        : [];
    rawSamples.slice(0, 30).forEach((sample, index) => {
      const originalText = sample.text.slice(0, 1_200);
      samples.push({
        id: `sample_${createHash("sha1").update(`${signal.runId}:${signal.candidateId}:${index}:${originalText}`).digest("hex").slice(0, 12)}`,
        signalId: signalIdFor(signal.runId, signal.candidateId),
        platform: signal.sourceName,
        author: sample.author || "匿名用户",
        permalink: signal.discussionUrl || signal.url,
        originalText,
        kind: sampleKindFor(originalText),
        branchId: `${signal.candidateId}:excerpt-only`,
        publishedAt: signal.publishedAt,
      });
    });
  }
  const seen = new Set<string>();
  return samples.filter((sample) => {
    const key = `${sample.author.toLocaleLowerCase()}:${normalizedClaim(sample.originalText)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 80);
};

const rightsFor = (
  image: SourceImage,
  checkedAt: string,
): Pick<AssetCandidate, "rightsDecision" | "rightsReason"> => {
  const governed = normalizeGovernedMaterial({
    id: image.id,
    title: image.caption,
    attribution: image.attribution,
    rights: image.rights,
    sourceUrl: image.sourceUrl,
    evidence: { note: image.evidenceNote, path: image.evidencePath },
    licenseId: image.licenseId,
    licenseUrl: image.licenseUrl,
    modificationNote: image.modificationNote,
    allowedPlatforms: image.allowedPlatforms ?? (image.rights === "owned" ? ["*"] : []),
    expiresAt: image.expiresAt,
    entityTags: image.entityTags,
    fingerprint: image.fingerprint ?? "",
    createdAt: checkedAt,
    localPath: image.localPath,
    publicPath: image.publicPath,
  });
  const decision = evaluateMaterialPublishEligibility(governed, "wechat", checkedAt);
  const localFile = inspectLocalImageFile(image);
  const blockers = [
    ...(localFile.available ? [] : [localFile.reason || "图片本地文件不可用。"]),
    ...decision.blockers,
  ];
  if (blockers.length) {
    return {
      rightsDecision: "blocked",
      rightsReason: [...new Set(blockers)].join("；") || "图片权利信息不完整",
    };
  }
  if (decision.warnings.length) {
    return {
      rightsDecision: "warning",
      rightsReason: decision.warnings.join("；"),
    };
  }
  return { rightsDecision: "allowed", rightsReason: "权利状态允许进入微信公众号预检" };
};

const imageRoleFor = (image: SourceImage): AssetCandidate["role"] => {
  const text = `${image.caption} ${image.attribution} ${image.url}`;
  if (/chart|graph|benchmark|数据|图表|排行|曲线/iu.test(text)) return "data";
  if (/screenshot|界面|dashboard|产品|demo|演示/iu.test(text)) return "product";
  if (/comment|社区|reddit|hacker news|v2ex|知乎/iu.test(text)) return "community";
  return "fact";
};

const sourceImageSnapshot = (image: SourceImage): SourceImage => {
  const snapshot: SourceImage = {
    ...image,
    allowedPlatforms: image.allowedPlatforms ? [...image.allowedPlatforms] : undefined,
    entityTags: image.entityTags ? [...image.entityTags] : undefined,
  };
  if (isLocalImageFileReady(snapshot)) {
    const actual = createHash("sha256").update(readFileSync(snapshot.localPath!)).digest("hex");
    const recorded = snapshot.fingerprint?.trim().toLowerCase() || "";
    if (recorded && !/^[a-f0-9]{64}$/u.test(recorded)) {
      throw new Error(`图片 ${snapshot.id} 已记录的指纹格式无效，不能建立素材包`);
    }
    if (recorded && recorded !== actual) {
      throw new Error(`图片 ${snapshot.id} 指纹不一致，文件可能已被替换`);
    }
    snapshot.fingerprint = recorded || actual;
  }
  return snapshot;
};

const editorialPriorityFor = (image: SourceImage): 1 | 2 | 3 | 4 | 5 => {
  if (image.editorialPriority) return image.editorialPriority;
  if (image.rights === "editorial-screenshot" || image.rights === "commentary-screenshot") return 2;
  return image.id.startsWith("library:") ? 4 : 1;
};

const editorialOriginFor = (
  image: SourceImage,
  priority: 1 | 2 | 3 | 4 | 5,
): NonNullable<SourceImage["editorialOrigin"]> => image.editorialOrigin
  ?? (priority === 1
    ? "article-image"
    : priority === 2
      ? "article-screenshot"
      : priority === 3
        ? "entity-library"
        : priority === 5
          ? "generated-fallback"
          : "related-library");

const assetsFor = (
  story: StoryView,
  claims: EvidenceClaim[],
  fallbackImages: SourceImage[] = [],
  checkedAt = new Date().toISOString(),
): AssetCandidate[] => uniqueEligibleEditorialImages([...story.images, ...fallbackImages])
  .map((image, index) => {
    const editorialPriority = editorialPriorityFor(image);
    const editorialOrigin = editorialOriginFor(image, editorialPriority);
    return { image, index, editorialPriority, editorialOrigin };
  })
  .sort((left, right) => left.editorialPriority - right.editorialPriority || left.index - right.index)
  .map(({ image, editorialPriority, editorialOrigin }, index) => {
  const sourceImage = sourceImageSnapshot({ ...image, editorialPriority, editorialOrigin });
  return {
    id: `asset_${createHash("sha1").update(`${story.id}:${sourceImage.id}:${sourceImage.url}`).digest("hex").slice(0, 12)}`,
    sourceImageId: sourceImage.id,
    sourceImage,
    url: sourceImage.publicPath || sourceImage.url,
    caption: sourceImage.caption,
    attribution: sourceImage.attribution,
    sourceUrl: sourceImage.sourceUrl,
    rights: sourceImage.rights,
    ...rightsFor(sourceImage, checkedAt),
    role: index === 0 ? "cover" : imageRoleFor(sourceImage),
    width: sourceImage.width,
    height: sourceImage.height,
    recommendedAfterClaimId: claims[index % Math.max(1, claims.length)]?.id,
    origin: sourceImage.id.startsWith("library:") ? "library" : "source",
    editorialPriority,
    editorialOrigin,
    localReady: isLocalImageFileReady(sourceImage),
  };
});

const normalizedAssetGovernanceSnapshot = (asset: AssetCandidate) => {
  const image = asset.sourceImage;
  return {
    id: asset.id,
    sourceImageId: asset.sourceImageId,
    role: asset.role,
    recommendedAfterClaimId: asset.recommendedAfterClaimId,
    origin: asset.origin,
    editorialPriority: asset.editorialPriority,
    editorialOrigin: asset.editorialOrigin,
    localReady: asset.localReady,
    rightsDecision: asset.rightsDecision,
    rightsReason: asset.rightsReason,
    image: {
      id: image.id,
      url: image.url,
      caption: image.caption,
      attribution: image.attribution,
      sourceUrl: image.sourceUrl,
      width: image.width,
      height: image.height,
      selected: image.selected,
      rights: image.rights,
      evidenceNote: image.evidenceNote,
      evidencePath: image.evidencePath,
      licenseId: image.licenseId,
      licenseUrl: image.licenseUrl,
      modificationNote: image.modificationNote,
      allowedPlatforms: [...(image.allowedPlatforms ?? [])].map((item) => item.trim().toLowerCase()).sort(),
      expiresAt: image.expiresAt,
      entityTags: [...(image.entityTags ?? [])].map((item) => item.trim()).sort((left, right) => left.localeCompare(right)),
      fingerprint: image.fingerprint?.trim().toLowerCase(),
    },
  };
};

export interface FreezeContentPackageAssetsOptions {
  assetRoot?: string;
}

/**
 * Copies every local package snapshot into package-owned storage. The package
 * id is deliberately based on governance/content, not machine-specific paths;
 * repeated builds therefore reuse the same immutable package directory.
 */
export const freezeContentPackageAssets = async (
  contentPackage: ContentPackage,
  options: FreezeContentPackageAssetsOptions = {},
): Promise<ContentPackage> => {
  const frozen = structuredClone(contentPackage);
  const packageRoot = path.join(options.assetRoot ?? path.join(workflowMediaRoot, "packages"), frozen.id);
  for (const asset of frozen.assets) {
    if (!asset.localReady) continue;
    const sourceImage = asset.sourceImage;
    if (!sourceImage?.localPath?.trim() || !sourceImage.publicPath?.trim()) {
      throw new Error(`素材包图片 ${asset.sourceImageId} 缺少完整本地快照`);
    }
    const expected = sourceImage.fingerprint?.trim().toLowerCase() || "";
    if (!/^[a-f0-9]{64}$/u.test(expected)) {
      throw new Error(`素材包图片 ${asset.sourceImageId} 缺少有效 SHA-256 指纹`);
    }
    const bytes = await readFile(sourceImage.localPath);
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== expected) {
      throw new Error(`素材包图片 ${asset.sourceImageId} 内容已变化，无法冻结`);
    }
    const extension = path.extname(sourceImage.localPath).toLowerCase();
    const safeExtension = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(extension)
      ? (extension === ".jpeg" ? ".jpg" : extension)
      : ".jpg";
    const safeId = sourceImage.id.replace(/[^a-zA-Z0-9_-]/gu, "_").slice(0, 64) || "image";
    const fileName = `${safeId}-${expected.slice(0, 16)}${safeExtension}`;
    await mkdir(packageRoot, { recursive: true });
    const localPath = path.join(packageRoot, fileName);
    await writeFile(localPath, bytes);
    const publicPath = `/media/packages/${encodeURIComponent(frozen.id)}/${encodeURIComponent(fileName)}`;
    asset.sourceImage = { ...sourceImage, localPath, publicPath, fingerprint: expected };
    asset.url = publicPath;
    asset.localReady = true;
  }
  return frozen;
};

const communityEvidenceLabelFor = (samples: DiscussionSample[]) => {
  const authors = new Set(samples.map((sample) => sample.author));
  const branches = new Set(samples.map((sample) => sample.branchId).filter(Boolean));
  if (samples.length < 5) return `仅 ${samples.length} 条有效样本，只能表述为“有限样本中有人提出”`;
  if (samples.length < 15 || branches.size < 5) return `${samples.length} 条样本可列出观点，但不足以宣称多数或共识`;
  return `${samples.length} 条样本、${authors.size} 名作者、${branches.size} 个讨论分支，可提炼反复出现的主题`;
};

const anglesFor = (mode: ContentPackage["mode"], story: StoryView) => ({
  brief: ["发生了什么、何时发生、普通读者为何要在意", "把已证实事实与仍待观察的信息明确分开"],
  synthesis: ["比较不同来源各自新增了什么", "找出官方说法、独立验证与社区体验之间的差距"],
  community: ["先建立事实主干，再呈现多种真实使用观点", "保留分歧，不把少量高赞评论包装成共识"],
  playbook: ["按可复现顺序整理步骤、条件和失败案例", "把经验与官方支持范围分开标记"],
  curate: ["说明原文为什么值得读，不做无意义全文重写", "只引用必要片段并把读者带回原文"],
})[mode].map((angle) => `${angle}；围绕“${story.title}”展开`);

export interface BuildContentPackageInput {
  storyId: string;
  mode?: Exclude<AssignmentMode, "watch" | "skip">;
  intent?: EditorialIntent;
  intakeReason?: string;
  now?: string;
  discussionSamples?: DiscussionSample[];
  sourceMaterials?: SourceMaterialSnapshot[];
}

/**
 * PackageDesk is the sole writing-evidence boundary. It converts a Story into
 * a reviewable package of claims, community samples and governed assets; draft
 * generation must consume this result instead of reaching back into raw feeds.
 */
export const buildContentPackage = (state: WorkflowState, input: BuildContentPackageInput): ContentPackage => {
  const now = input.now ?? new Date().toISOString();
  const story = storyById(state, input.storyId, now);
  if (!story) throw new Error("Story 不存在或已经从当前数据中移除");
  const requestedIntent = input.intent
    ?? (input.mode === "community" ? "community" : input.mode === "curate" ? "source" : "news");
  if (!story.assignment.canDraft && requestedIntent !== "source") {
    throw new Error(story.assignment.blockers[0] || "当前 Story 不能进入成稿流程");
  }
  const mode = requestedIntent === "source" ? "curate" : input.mode ?? story.assignment.mode;
  if (mode === "watch" || mode === "skip") throw new Error("Watch 和 Skip 不会生成素材包");
  const facts = evidenceClaimsFor(state, story);
  const availableDiscussionSamples = input.discussionSamples?.length
    ? input.discussionSamples
    : discussionSamplesFor(state, story);
  const discussionSamples = requestedIntent === "community" ? availableDiscussionSamples : [];
  const localSourceImageCount = story.images.filter(isLocalImageFileReady).length;
  const fallbackImages = recommendMaterialCandidates(
    state.materials,
    story,
    Math.max(0, 2 - localSourceImageCount),
    now,
    { allowGenerated: localSourceImageCount === 0 },
  );
  const assets = assetsFor(story, facts, fallbackImages, now);
  const sourceMaterials = input.sourceMaterials ?? [];
  const blockers = requestedIntent === "source" ? [] : [...story.assignment.blockers];
  if (requestedIntent === "source" && !sourceMaterials.some((material) => material.originalText.trim().length >= 80)) {
    blockers.push("没有冻结足够完整的原始材料，不能生成原文工作副本");
  }
  if (requestedIntent !== "source" && !facts.some((claim) => claim.status === "supported" || claim.status === "partially-supported")) {
    blockers.push("没有可用于写作的正文级事实");
  }
  const uncertainties = [
    ...(requestedIntent === "source"
      ? ["这是来源派生的私有编辑工作副本；正文事实、引用范围、转载或翻译权限均需发布前复核。"]
      : [
        ...story.assignment.warnings.filter((warning) => requestedIntent === "community" || !/社区样本/u.test(warning)),
        ...story.explanation.unknowns.map((item) => `仍未知：${item}`),
        ...facts.filter((claim) => claim.status === "unverified").map((claim) => `待核验：${claim.text}`),
      ]),
    ...sourceMaterials.filter((material) => material.truncated).map(() => "原始材料过长，素材包仅冻结了前 48000 个字符。"),
    ...sourceMaterials.filter((material) => material.fromCache).map((material) => `原文使用 ${material.capturedAt} 的本地快照；发布前建议刷新来源。`),
  ];
  if (assets.some((asset) => asset.rightsDecision === "warning")) uncertainties.push("部分图片需要人工确认权利状态");
  if (assets.some((asset) => asset.rightsDecision === "blocked")) uncertainties.push("部分原图可进入私人编辑草稿，但公众号同步前会被预检拦截，需确认权利或替换");
  const sourceFingerprint = story.signals.map((signal) => `${signal.runId}:${signal.candidateId}:${signal.fetchedAt}`).sort().join("|");
  const assetFingerprint = createHash("sha256")
    .update(JSON.stringify(assets.map(normalizedAssetGovernanceSnapshot)
      .sort((left, right) => left.id.localeCompare(right.id))))
    .digest("hex");
  const evidenceFingerprint = createHash("sha256")
    .update(JSON.stringify({
      facts: facts.map((claim) => ({ text: claim.text, status: claim.status, sources: claim.sourceUrls })),
      explanationGeneratedAt: story.explanation.generatedAt,
      explanationUnknowns: story.explanation.unknowns,
      discussionSamples: discussionSamples.map((sample) => ({
        id: sample.id,
        author: sample.author,
        originalText: sample.originalText,
        permalink: sample.permalink,
      })),
    }))
    .digest("hex");
  const sourceMaterialFingerprint = createHash("sha256")
    .update(JSON.stringify(sourceMaterials.map((material) => ({
      signalId: material.signalId,
      url: material.url,
      capturedAt: material.capturedAt,
      originalText: material.originalText,
      rightsNotice: material.rightsNotice,
    }))))
    .digest("hex");
  const intent = requestedIntent;
  const id = `package_${createHash("sha256").update(`${story.id}:${mode}:${intent}:${sourceFingerprint}:${evidenceFingerprint}:${assetFingerprint}:${sourceMaterialFingerprint}`).digest("hex").slice(0, 18)}`;
  return {
    id,
    storyId: story.id,
    mode,
    intent,
    intakeReason: input.intakeReason,
    title: story.title,
    createdAt: now,
    facts,
    communitySummary: story.communitySummary,
    communityFocus: story.communityFocus,
    discussionSamples,
    sourceSignalIds: story.signals.map((signal) => signalIdFor(signal.runId, signal.candidateId)),
    sources: packageSourcesFor(story),
    sourceMaterials: sourceMaterials.length ? structuredClone(sourceMaterials) : undefined,
    imageIds: assets.map((asset) => asset.id),
    assets,
    uncertainties: [...new Set(uncertainties)],
    suggestedAngles: anglesFor(mode, story),
    communityEvidenceLabel: communityEvidenceLabelFor(discussionSamples),
    status: blockers.length ? "blocked" : "ready",
    blockers: [...new Set(blockers)],
  };
};
