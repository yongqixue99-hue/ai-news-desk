import type {
  WeChatDraftArticlePayload,
  WeChatDraftGateway,
  WeChatImageAsset,
} from "./wechat-draft.js";

interface WeChatHttpGatewayOptions {
  appId: string;
  appSecret: string;
  fetcher?: typeof fetch;
  clock?: () => number;
}

interface WeChatResponseError {
  errcode?: number;
  errmsg?: string;
}

const apiRoot = "https://api.weixin.qq.com";

export class WeChatApiError extends Error {
  constructor(readonly code: number, detail: string, readonly definitive = true) { super(detail); this.name = "WeChatApiError"; }
}

const safeWeChatError = (code: number) => {
  if (code === 40164) return "当前出口 IP 不在微信公众号白名单中，请到微信公众平台添加后重试";
  if (code === 40125 || code === 40001) return "微信公众号 AppSecret 无效，请重新保存后重试";
  if (code === 48001) return "当前公众号没有草稿接口权限，请确认账号类型及接口权限";
  if (code === 40013) return "微信公众号 AppID 无效，请检查后重试";
  if ([40007, 46001].includes(code)) return "微信草稿或素材已不存在，请到公众号后台核对；本次不会自动新建重复草稿";
  if ([45009, 45011].includes(code)) return "微信接口调用频率已达限制，请稍后重试";
  return `微信接口返回错误 ${code}`;
};

const responseJson = async <T>(response: Response): Promise<T> => {
  const payload = await response.json().catch(() => { throw new Error("微信响应无法读取，请核对草稿箱结果后重试"); }) as T & WeChatResponseError;
  if (!payload || typeof payload !== "object") throw new Error("微信返回了无效响应，请先核对草稿箱结果");
  if (!response.ok || (typeof payload.errcode === "number" && payload.errcode !== 0)) {
    const code = payload.errcode ?? response.status;
    // Only extract an IPv4 address from the documented whitelist error; never echo upstream secrets.
    const candidate = code === 40164 ? /invalid ip (\d{1,3}(?:\.\d{1,3}){3})\b/u.exec(payload.errmsg || "")?.[1] : undefined;
    const ip = candidate && candidate.split(".").every(part => Number(part) <= 255) ? candidate : undefined;
    throw new WeChatApiError(code, safeWeChatError(code) + (ip ? `（微信识别到的出口 IP：${ip}）` : ""), typeof payload.errcode === "number" && payload.errcode !== 0);
  }
  return payload;
};

export const createWeChatHttpGateway = (
  options: WeChatHttpGatewayOptions,
): WeChatDraftGateway => {
  const fetcher = options.fetcher ?? fetch;
  const clock = options.clock ?? Date.now;
  let cachedToken: { value: string; expiresAt: number } | undefined;

  const accessToken = async () => {
    if (cachedToken && cachedToken.expiresAt > clock()) return cachedToken.value;
    const response = await fetcher(`${apiRoot}/cgi-bin/stable_token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credential",
        appid: options.appId,
        secret: options.appSecret,
        force_refresh: false,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await responseJson<{ access_token?: string; expires_in?: number }>(response);
    if (!payload.access_token) throw new Error("微信没有返回 access_token");
    const lifetimeSeconds = Math.max(60, Number(payload.expires_in || 7200) - 300);
    cachedToken = { value: payload.access_token, expiresAt: clock() + lifetimeSeconds * 1_000 };
    return cachedToken.value;
  };

  const authenticatedUrl = async (pathName: string, query: Record<string, string> = {}) => {
    const url = new URL(pathName, apiRoot);
    url.searchParams.set("access_token", await accessToken());
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return url.toString();
  };

  const imageForm = (asset: WeChatImageAsset) => {
    const form = new FormData();
    form.append(
      "media",
      new Blob([new Uint8Array(asset.bytes)], { type: asset.contentType }),
      asset.fileName,
    );
    return form;
  };

  const postJson = async <T>(pathName: string, body: unknown) => {
    const response = await fetcher(await authenticatedUrl(pathName), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    return responseJson<T>(response);
  };

  return {
    getDraft: async (mediaId: string) => {
      const payload = await postJson<{ news_item?: WeChatDraftArticlePayload[] }>("/cgi-bin/draft/get", { media_id: mediaId });
      if (!payload.news_item?.[0]?.title || typeof payload.news_item[0].content !== "string") throw new Error("微信没有返回可核对的草稿内容");
      return payload.news_item[0];
    },
    countDrafts: async () => {
      const response = await fetcher(await authenticatedUrl("/cgi-bin/draft/count"), {
        method: "GET",
        signal: AbortSignal.timeout(20_000),
      });
      const payload = await responseJson<{ total_count?: number }>(response);
      if (!Number.isInteger(payload.total_count) || Number(payload.total_count) < 0) throw new Error("微信没有返回有效的草稿接口检查结果");
      return Number(payload.total_count);
    },
    uploadContentImage: async (asset: WeChatImageAsset) => {
      const response = await fetcher(await authenticatedUrl("/cgi-bin/media/uploadimg"), {
        method: "POST",
        body: imageForm(asset),
        signal: AbortSignal.timeout(30_000),
      });
      const payload = await responseJson<{ url?: string }>(response);
      if (!payload.url) throw new Error("微信没有返回正文图片地址");
      return { url: payload.url };
    },
    uploadPermanentImage: async (asset: WeChatImageAsset) => {
      const response = await fetcher(await authenticatedUrl("/cgi-bin/material/add_material", { type: "image" }), {
        method: "POST",
        body: imageForm(asset),
        signal: AbortSignal.timeout(30_000),
      });
      const payload = await responseJson<{ media_id?: string; url?: string }>(response);
      if (!payload.media_id) throw new Error("微信没有返回封面素材 media_id");
      return { mediaId: payload.media_id, ...(payload.url ? { url: payload.url } : {}) };
    },
    addDraft: async (article: WeChatDraftArticlePayload) => {
      const payload = await postJson<{ media_id?: string }>("/cgi-bin/draft/add", {
        articles: [article],
      });
      if (!payload.media_id) throw new Error("微信没有返回草稿 media_id");
      return { mediaId: payload.media_id };
    },
    updateDraft: async (mediaId: string, article: WeChatDraftArticlePayload) => {
      const result = await postJson<WeChatResponseError>("/cgi-bin/draft/update", {
        media_id: mediaId,
        index: 0,
        articles: article,
      });
      if (result.errcode !== 0) throw new Error("微信没有明确确认更新结果，请先核对草稿箱");
    },
  };
};
