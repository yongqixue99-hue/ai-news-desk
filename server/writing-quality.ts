import type {
  ArticleDraftStrategy,
  ArticleEditMode,
  ArticleWritingDiagnostic,
  WritingQualityAssessment,
} from "./types.js";

export interface DraftStrategyInput {
  sourceCount: number;
  verifiedSourceCount: number;
  evidenceLength: number;
  clusterSize: number;
  /** Commentary is allowed only when the user has supplied a concrete angle. */
  userAngle?: string;
  /** Codex with explicit research Skills may recover a weak collected excerpt. */
  canResearchBeyondEvidence?: boolean;
}

export interface WritingQualityInput {
  title: string;
  paragraphs: string[];
  take?: string;
  headings?: string[];
}

export interface FactPreservationAudit {
  passed: boolean;
  protectedAnchors: string[];
  missingAnchors: string[];
}

const normalized = (value: string) => value
  .normalize("NFKC")
  .replace(/\s+/g, "")
  .toLocaleLowerCase("zh-CN");

export const recommendDraftStrategy = (input: DraftStrategyInput): ArticleDraftStrategy => {
  if ((input.userAngle || "").replace(/\s+/g, "").length >= 12) return "commentary";
  if (
    input.evidenceLength < 80
    && input.verifiedSourceCount <= 0
    && input.sourceCount <= 1
    && !input.canResearchBeyondEvidence
  ) return "skip";
  if (
    input.verifiedSourceCount >= 2
    || input.sourceCount >= 3
    || input.clusterSize >= 3
  ) return "synthesis";
  return "brief";
};

const numberAnchorPattern = /\d+(?:[,.]\d+)*(?:\s*(?:%|％|年|月|日|时|分|秒|美元|美金|元|亿元|万元|万|亿|GB|MB|TB|倍|个|名|项|家|次))?/giu;
const latinAnchorPattern = /\b[A-Za-z][A-Za-z0-9]*(?:[-./+][A-Za-z0-9]+)*\b/g;
const quoteAnchorPattern = /[“「『](.{2,40}?)[”」』]/gu;

const looksLikeNamedToken = (token: string) => {
  const uppercaseCount = [...token].filter((character) => /[A-Z]/.test(character)).length;
  return /\d|[-./+]/.test(token)
    || (uppercaseCount >= 2)
    || (uppercaseCount >= 1 && /[A-Z]/.test(token.slice(1)));
};

export const protectedFactAnchors = (text: string) => {
  const anchors = [
    ...(text.match(numberAnchorPattern) || []),
    ...(text.match(latinAnchorPattern) || []).filter(looksLikeNamedToken),
    ...[...text.matchAll(quoteAnchorPattern)].map((match) => match[1]),
  ].map((anchor) => anchor.trim()).filter(Boolean);
  return [...new Map(anchors.map((anchor) => [normalized(anchor), anchor])).values()];
};

export const auditFactPreservation = (before: string, after: string): FactPreservationAudit => {
  const protectedAnchors = protectedFactAnchors(before);
  const normalizedAfter = normalized(after);
  const missingAnchors = protectedAnchors.filter((anchor) => !normalizedAfter.includes(normalized(anchor)));
  return {
    passed: missingAnchors.length === 0,
    protectedAnchors,
    missingAnchors,
  };
};

type DiagnosticSeed = Omit<ArticleWritingDiagnostic, "severity"> & {
  severity?: ArticleWritingDiagnostic["severity"];
};

const addDiagnostic = (
  diagnostics: ArticleWritingDiagnostic[],
  seed: DiagnosticSeed,
) => {
  const diagnostic: ArticleWritingDiagnostic = { severity: "warning", ...seed };
  if (diagnostics.some((entry) => entry.id === diagnostic.id && entry.blockId === diagnostic.blockId)) return;
  diagnostics.push(diagnostic);
};

const addLieflatDiagnostic = (
  diagnostics: ArticleWritingDiagnostic[],
  ruleNumber: number,
  seed: DiagnosticSeed,
) => addDiagnostic(diagnostics, {
  ruleSource: "lieflat",
  ruleNumber,
  autoFixable: false,
  ...seed,
});

/** Quoted/code/foreign passages are source material, not copy-edit targets. */
const inspectableText = (text: string) => text
  .replace(/```[\s\S]*?```/gu, " ")
  .replace(/`[^`]+`/gu, " ")
  .replace(/[“「『][\s\S]{0,600}?[”」』]/gu, " ")
  .replace(/https?:\/\/\S+/giu, " ")
  .trim();

const shouldInspectChineseProse = (text: string) => {
  if (!text || /^(?:>|```|    )/u.test(text)) return false;
  const chineseCount = (text.match(/[\p{Script=Han}]/gu) || []).length;
  return chineseCount >= 3 && chineseCount / Math.max(1, [...text].length) >= 0.12;
};

const sentenceParts = (text: string) => text
  .split(/(?<=[。！？!?])/u)
  .map((sentence) => sentence.trim())
  .filter((sentence) => sentence.length >= 8);

const sentenceSkeleton = (sentence: string) => ({
  commaCount: (sentence.match(/[，,]/gu) || []).length,
  clauseCount: sentence.split(/[，,；;]/u).length,
  ending: sentence.at(-1),
  length: [...sentence].length,
});

const adjacentSentencesLookIsomorphic = (left: string, right: string) => {
  const a = sentenceSkeleton(left);
  const b = sentenceSkeleton(right);
  if (a.commaCount === 0 || a.commaCount !== b.commaCount || a.clauseCount !== b.clauseCount) return false;
  const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
  return ratio >= 0.76 && a.ending === b.ending;
};

const inspectLieflatBlock = (
  diagnostics: ArticleWritingDiagnostic[],
  blockId: string,
  originalText: string,
) => {
  const text = inspectableText(originalText);
  if (!shouldInspectChineseProse(text)) return;

  if (/(?:不是|并非).{1,90}(?:而是|是)|不在于.{1,90}而在于|与其说?.{1,90}不如说?|(?:表面|看似).{1,70}(?:实际|实则)|你以为.{1,70}其实|答案恰恰相反|不重要[，,]重要的是/u.test(text)) {
    addLieflatDiagnostic(diagnostics, 1, {
      id: "lieflat-reversal-shell",
      layer: "structure",
      blockId,
      message: "句子先制造一个未必存在的误解，再用固定翻案句式推翻；请确认材料是否真的走过这层修正。",
      evidence: originalText.slice(0, 130),
    });
  }

  const denseClause = text.split(/[，,；;。！？!?]/u).find((clause) => (clause.match(/、/gu) || []).length >= 2);
  if (denseClause) {
    addLieflatDiagnostic(diagnostics, 2, {
      id: "lieflat-dense-enumeration",
      layer: "surface",
      blockId,
      message: "一个分句用顿号串起了三项以上内容；若不是必须完整保留的清单，可改成概括或打散句法。",
      evidence: denseClause.slice(0, 120),
    });
  }

  const sentences = sentenceParts(text);
  if (sentences.some((sentence, index) => index > 0 && adjacentSentencesLookIsomorphic(sentences[index - 1]!, sentence))) {
    addLieflatDiagnostic(diagnostics, 3, {
      id: "lieflat-adjacent-isomorphic-sentences",
      layer: "structure",
      blockId,
      message: "相邻句子的逗号数量、成分顺序和长度过于接近，读起来像在套同一张句法表。",
      evidence: originalText.slice(0, 180),
    });
  }

  if (/[^\s—–]{3,}[—–]{1,2}(?:答案|结论|一个|一位|一条|一种|[^，。；！？!?]{1,20})[。！？!?]?/u.test(text)) {
    addLieflatDiagnostic(diagnostics, 4, {
      id: "lieflat-reveal-dash",
      layer: "surface",
      blockId,
      message: "破折号被用来制造普通判断的停顿或揭晓；若它不承担必要插入说明，改成完整句或普通标点。",
      evidence: originalText.slice(0, 130),
    });
  }

  if (/(?:一句话总结|核心是|关键在于|原因(?:如下|有\w*)?|结论|本质上|换句话说)[：:]/u.test(text)) {
    addLieflatDiagnostic(diagnostics, 5, {
      id: "lieflat-prompt-colon",
      layer: "surface",
      blockId,
      message: "冒号前是空泛提示语；删掉提示语或只换标点，保留真正的信息。",
      evidence: originalText.slice(0, 130),
    });
  }

  if (/(?:像|相当于)(?:给\S+)?(?:一个|一位).{0,18}(?:智慧|全能|永不疲倦|贴身|秒级|专业).{0,12}(?:导师|秘书|助手|顾问|管家|审查员|实习生)/u.test(text)) {
    addLieflatDiagnostic(diagnostics, 7, {
      id: "lieflat-idealized-persona",
      layer: "surface",
      blockId,
      message: "工具被比作理想化职业人格，却没有增加机制信息；应直接说明它具体做什么。",
      evidence: originalText.slice(0, 150),
    });
  }

  if (/(?:完成了对.{1,28}的(?:优化|调整|检查|改进)|实现了.{0,24}的(?:提升|增长|改善)|进行了.{0,24}的(?:优化|调整|改进))/u.test(text)) {
    addLieflatDiagnostic(diagnostics, 8, {
      id: "lieflat-nominalization",
      layer: "surface",
      blockId,
      message: "动作被写成“完成了/实现了/进行了”的名词化结构；只恢复原有动词，不补原文没有的数据。",
      evidence: originalText.slice(0, 140),
      autoFixable: true,
    });
  }

  if (/^(?:说白了|说穿了|先说结论)[，,:：]?/u.test(text)) {
    addLieflatDiagnostic(diagnostics, 9, {
      id: "lieflat-banned-starter",
      layer: "surface",
      blockId,
      message: "删掉空转起手式，直接给判断。",
      evidence: originalText.slice(0, 100),
      autoFixable: true,
    });
  }

  if (/(?:这是|这是一|需要一|有一)(?:个|种|套)?[^，。！？]{16,}的(?:工具|系统|方法|方案|能力|机制|平台|产品|流程|模型)|的[^，。！？]{1,18}的/u.test(text)) {
    addLieflatDiagnostic(diagnostics, 10, {
      id: "lieflat-long-front-modifier",
      layer: "structure",
      blockId,
      message: "中心名词前堆了过长修饰或连续“的”字，可在原段内拆成两个分句。",
      evidence: originalText.slice(0, 150),
    });
  }
  if (/^当.{3,45}时[，,]/u.test(text)) {
    addLieflatDiagnostic(diagnostics, 10, {
      id: "lieflat-when-front-clause",
      layer: "surface",
      blockId,
      message: "句首“当……时”前置了完整从句；只有时间关系不受损时才删去外壳。",
      evidence: originalText.slice(0, 130),
    });
  }
  if (/^(?:对于.{1,30}来说|对.{1,30}而言|就.{1,30}而言|关于.{1,24}|在.{1,24}方面)[，,]/u.test(text)) {
    addLieflatDiagnostic(diagnostics, 10, {
      id: "lieflat-front-topic-shell",
      layer: "surface",
      blockId,
      message: "句首话题壳可能只是英文式前置；若不改变限定范围，可把对象直接放到主语或话题位。",
      evidence: originalText.slice(0, 130),
    });
  }
  if (/^(?:此外|与此同时|总而言之|换言之)[，,]/u.test(text)) {
    addLieflatDiagnostic(diagnostics, 10, {
      id: "lieflat-front-connector",
      layer: "surface",
      severity: "info",
      blockId,
      message: "句首连接词在给全文当路标；若不是必要转折，可移到主语后或换成更直接的衔接。",
      evidence: originalText.slice(0, 110),
    });
  }
  if (/[。！？!?](?:这意味着|这表明|这说明|换句话说)/u.test(text)) {
    addLieflatDiagnostic(diagnostics, 10, {
      id: "lieflat-this-means-repeat",
      layer: "surface",
      severity: "info",
      blockId,
      message: "后一句以“这意味着/表明/说明”重述前句；仅在确属同义复述时合并，若推出了新结论则保留。",
      evidence: originalText.slice(0, 160),
    });
  }
};

const inspectBlock = (
  diagnostics: ArticleWritingDiagnostic[],
  blockId: string,
  text: string,
) => {
  inspectLieflatBlock(diagnostics, blockId, text);
  if (/^(?:在当今|随着).{0,22}(?:时代|发展|浪潮)|前所未有的速度|在这个快速变化的时代/u.test(text)) {
    addDiagnostic(diagnostics, {
      id: "stock-opening",
      layer: "surface",
      blockId,
      message: "开头使用了可套在任何主题上的时代背景，具体事件被推迟了。",
      evidence: text.slice(0, 80),
      ruleSource: "editorial",
    });
  }
  const promotionalTerms = text.match(/无缝|直观|强大|革命(?:性)?|开创性|颠覆性|令人惊叹|充满活力|前沿(?:的)?/gu) || [];
  if (promotionalTerms.length >= 2) {
    addDiagnostic(diagnostics, {
      id: "promotional-cluster",
      layer: "surface",
      blockId,
      message: "多个宣传性形容词成组出现，但没有说明可观察的产品变化。",
      evidence: promotionalTerms.join("、"),
      ruleSource: "editorial",
    });
  }
  if (/(?:总的来说|综上所述|总体而言)|无疑(?:标志着|意味着)|(?:全新|新的?)里程碑|未来可期|可以预见/u.test(text)) {
    addDiagnostic(diagnostics, {
      id: "generic-conclusion",
      layer: "surface",
      blockId,
      message: "结尾给出了通用判断，却没有增加可核验的信息或具体观察。",
      evidence: text.slice(0, 100),
      ruleSource: "editorial",
    });
  }
  if (/(?:业内人士|有专家|有分析|有观点|有人)(?:普遍)?(?:认为|表示|指出)|(?:行业|多份?)报告显示|(?:有|多项|一些)研究表明/u.test(text)) {
    addDiagnostic(diagnostics, {
      id: "unnamed-authority",
      layer: "content",
      severity: "error",
      blockId,
      message: "引用了未具名的权威或研究，读者无法回到具体来源核对。",
      evidence: text.slice(0, 100),
      ruleSource: "editorial",
    });
  }
  if (/希望这对(?:您|你)有帮助|如果(?:您|你)想(?:了解|知道|让我)|请告诉我|当然[！!，,]/u.test(text)) {
    addDiagnostic(diagnostics, {
      id: "chat-residue",
      layer: "surface",
      severity: "error",
      blockId,
      message: "正文残留了聊天机器人对用户说话的句子。",
      evidence: text.slice(0, 100),
      ruleSource: "editorial",
    });
  }
};

const editModeFor = (diagnostics: ArticleWritingDiagnostic[]): ArticleEditMode => {
  if (!diagnostics.length) return "keep";
  const editorialStructural = diagnostics.filter((item) =>
    item.ruleSource !== "lieflat" && (item.layer === "content" || item.layer === "structure"));
  const contentErrors = diagnostics.filter((item) => item.severity === "error" && item.layer === "content");
  if (editorialStructural.length >= 4 || contentErrors.length >= 2) return "rebuild";
  if (diagnostics.every((item) => item.layer === "surface") && diagnostics.length <= 2) return "light";
  return "targeted";
};

export const assessWritingQuality = (input: WritingQualityInput): WritingQualityAssessment => {
  const diagnostics: ArticleWritingDiagnostic[] = [];
  if (/^(?:AI|人工智能).{0,12}(?:时代|变革|新篇章)|迎来(?:全新|重大).{0,8}(?:变革|升级)/u.test(input.title.trim())) {
    addDiagnostic(diagnostics, {
      id: "generic-title",
      layer: "surface",
      blockId: "title",
      message: "标题只有抽象评价，没有交代谁做了什么。",
      evidence: input.title.trim(),
    });
  }
  input.paragraphs.forEach((paragraph, index) => inspectBlock(
    diagnostics,
    `paragraph:${index}`,
    paragraph.trim(),
  ));
  if (input.take?.trim()) inspectBlock(diagnostics, "take", input.take.trim());

  input.paragraphs.forEach((paragraph, index) => {
    const text = inspectableText(paragraph.trim());
    if (index > 0 && /^(?:听起来|看起来|说白了|值得注意的是|更重要的是|关键在于|问题在于|意味着|不难看出)/u.test(text)
      && !/[这那其此]|上面/u.test(text.slice(0, 20))) {
      addLieflatDiagnostic(diagnostics, 11, {
        id: "lieflat-zero-subject-comment",
        layer: "structure",
        blockId: `paragraph:${index}`,
        message: "非首段用评论语起头，却没有“这/其/上面”等回指成分，读者需要退回上一段寻找对象。",
        evidence: paragraph.slice(0, 130),
      });
    }
    if (/(?:显著提升|大幅增长|明显改善|效率的提升|大量|众多)/u.test(text)) {
      const nearby = [input.paragraphs[index - 1], paragraph, input.paragraphs[index + 1]].filter(Boolean).join(" ");
      if (/\d+(?:[,.]\d+)*(?:\s*(?:%|％|年|月|日|小时|分钟|秒|倍|元|美元))?/u.test(nearby)) {
        addLieflatDiagnostic(diagnostics, 8, {
          id: "lieflat-vague-over-existing-data",
          layer: "content",
          severity: "info",
          blockId: `paragraph:${index}`,
          message: "概括词附近已经有具体数字或时间；请把已有材料写回判断，不要补造新数字。",
          evidence: paragraph.slice(0, 130),
        });
      }
    }
  });

  const numberedHeadings = (input.headings || []).filter((heading) =>
    /^(?:[一二三四五六七八九十]+[、.．]|第[一二三四五六七八九十]+[章节部分、.．：:]?)/u.test(heading.trim()));
  if (numberedHeadings.length >= 3) {
    addLieflatDiagnostic(diagnostics, 6, {
      id: "lieflat-numbered-headings",
      layer: "structure",
      blockId: "headings",
      message: "三个以上小标题连续用序数词编号；若不是步骤、法规或需被引用的条目，只删编号并保留标题文字。",
      evidence: numberedHeadings.slice(0, 3).join(" / ").slice(0, 180),
    });
  }

  const allBlockIds = [
    "title",
    ...input.paragraphs.map((_, index) => `paragraph:${index}`),
    ...(input.take?.trim() ? ["take"] : []),
    ...((input.headings || []).length ? ["headings"] : []),
  ];
  const changedBlocks = new Set(diagnostics.flatMap((entry) => entry.blockId ? [entry.blockId] : []));
  const score = Math.min(100, diagnostics.reduce((sum, entry) =>
    sum + (entry.severity === "error" ? 25 : entry.severity === "warning" ? 12 : 6), 0));
  return {
    editMode: editModeFor(diagnostics),
    score,
    diagnostics,
    preservedBlockIds: allBlockIds.filter((blockId) => !changedBlocks.has(blockId)),
  };
};
