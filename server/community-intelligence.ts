import { createHash } from "node:crypto";
import { load } from "cheerio";
import { getLocalDatabase, readState } from "./storage.js";
import { storyById } from "./story-desk.js";
import type { DiscussionSample } from "./product-types.js";

export interface HackerNewsItem {
  id: number;
  by?: string;
  time?: number;
  text?: string;
  parent?: number;
  kids?: number[];
  deleted?: boolean;
  dead?: boolean;
  type?: string;
}

interface PendingComment {
  id: number;
  parentId: number;
  branchId: string;
  depth: number;
}

const HN_ITEM_ENDPOINT = "https://hacker-news.firebaseio.com/v0/item";
const inFlight = new Map<string, Promise<DiscussionSample[]>>();

const hnIdFrom = (value: string | undefined) => {
  if (!value) return undefined;
  try {
    const id = Number(new URL(value).searchParams.get("id"));
    return Number.isSafeInteger(id) && id > 0 ? id : undefined;
  } catch {
    return undefined;
  }
};

const cleanCommentHtml = (value: string) => {
  const $ = load(`<main>${value}</main>`);
  $("script,style,iframe,form").remove();
  $("p").append("\n");
  return $("main").text().replace(/\s+/gu, " ").trim().slice(0, 4_000);
};

const kindFor = (text: string): DiscussionSample["kind"] => {
  if (/\?|？|\bhow\b|怎么|为什么|有没有/iu.test(text)) return "question";
  if (/workaround|\bfix\b|solution|解决|步骤|配置|安装|部署/iu.test(text)) return "solution";
  if (/\bi (?:use|used|tested|run|ran)\b|in production|我用|我们用|实测|试过|遇到/iu.test(text)) return "experience";
  if (/predict|expect|will likely|未来|将会|可能|会不会/iu.test(text)) return "prediction";
  if (/however|but |disagree|not really|但是|不过|反对|不同意|问题在于/iu.test(text)) return "counterpoint";
  return "opinion";
};

const fetchItem = async (id: number) => {
  const response = await fetch(`${HN_ITEM_ENDPOINT}/${id}.json`, {
    signal: AbortSignal.timeout(12_000),
    headers: { accept: "application/json", "user-agent": "AI-News-Desk/0.1" },
  });
  if (!response.ok) throw new Error(`Hacker News 评论读取失败：HTTP ${response.status}`);
  return response.json() as Promise<HackerNewsItem | null>;
};

export const collectHackerNewsDiscussion = async (input: {
  rootId: number;
  signalId: string;
  limit?: number;
  getItem?: (id: number) => Promise<HackerNewsItem | null>;
}): Promise<DiscussionSample[]> => {
  const limit = Math.max(1, Math.min(160, input.limit ?? 120));
  const getItem = input.getItem ?? fetchItem;
  const root = await getItem(input.rootId);
  const queue: PendingComment[] = (root?.kids ?? []).map((id) => ({
    id,
    parentId: input.rootId,
    branchId: String(id),
    depth: 0,
  }));
  const samples: DiscussionSample[] = [];
  while (queue.length && samples.length < limit) {
    const batch = queue.splice(0, Math.min(12, queue.length));
    const items = await Promise.all(batch.map(async (pending) => ({
      pending,
      item: await getItem(pending.id).catch(() => null),
    })));
    for (const { pending, item } of items) {
      if (!item) continue;
      for (const childId of item.kids ?? []) {
        if (queue.length + samples.length >= limit * 4) break;
        queue.push({
          id: childId,
          parentId: item.id,
          branchId: pending.branchId,
          depth: pending.depth + 1,
        });
      }
      if (item.deleted || item.dead || item.type !== "comment" || !item.by || !item.text) continue;
      const originalText = cleanCommentHtml(item.text);
      if (originalText.length < 20) continue;
      samples.push({
        id: `hn_${item.id}_${createHash("sha1").update(originalText).digest("hex").slice(0, 8)}`,
        signalId: input.signalId,
        platform: "Hacker News",
        author: item.by,
        permalink: `https://news.ycombinator.com/item?id=${item.id}`,
        originalText,
        kind: kindFor(originalText),
        branchId: pending.branchId,
        parentId: String(item.parent ?? pending.parentId),
        depth: pending.depth,
        publishedAt: item.time ? new Date(item.time * 1_000).toISOString() : undefined,
      });
      if (samples.length >= limit) break;
    }
  }
  return samples;
};

const hydrate = async (storyId: string, force: boolean, limit: number) => {
  const database = await getLocalDatabase();
  const cached = database.listDiscussionSamples<DiscussionSample>(storyId, limit);
  if (cached.length && !force) return cached;
  const story = storyById(await readState(), storyId);
  if (!story) throw new Error("Story 不存在");
  const hackerNewsSignals = story.signals.filter((signal) =>
    signal.isCommunity && /hacker\s*news|hackernews/iu.test(`${signal.sourceName} ${signal.sourceType}`));
  if (!hackerNewsSignals.length) return cached;
  const all: DiscussionSample[] = [];
  for (const signal of hackerNewsSignals) {
    const rootId = hnIdFrom(signal.discussionUrl);
    if (!rootId) continue;
    const samples = await collectHackerNewsDiscussion({
      rootId,
      signalId: `${signal.runId}:${signal.candidateId}`,
      limit: Math.max(1, limit - all.length),
    }).catch(() => []);
    all.push(...samples);
    if (all.length >= limit) break;
  }
  if (all.length) database.replaceDiscussionSamples(storyId, "Hacker News", all);
  return all.length ? all : cached;
};

/**
 * Community intelligence reads complete public discussion trees into durable,
 * attributable samples. External comments remain untrusted data and are never
 * interpreted as Agent instructions.
 */
export const hydrateStoryDiscussion = (storyId: string, options: { force?: boolean; limit?: number } = {}) => {
  const key = `${storyId}:${Boolean(options.force)}`;
  const running = inFlight.get(key);
  if (running) return running;
  const operation = hydrate(storyId, Boolean(options.force), Math.max(1, Math.min(160, options.limit ?? 120)))
    .finally(() => inFlight.delete(key));
  inFlight.set(key, operation);
  return operation;
};
