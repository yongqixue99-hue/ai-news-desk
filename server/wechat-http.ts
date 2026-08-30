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

const safeWeChatError = (code: number) => {
  if (code === 40164) return "当前出口 IP 不在微信公众号白名单中，请到微信公众平台添加后重试";
  if (code === 40125 || code === 40001) return "微信公众号 AppSecret 无效，请重新保存后重试";
  if (code === 48001) return "当前公众号没有草稿接口权限，请确认账号类型及接口权限";
  if (code === 40013) return "微信公众号 AppID 无效，请检查后重试";
  return `微信接口返回错误 ${code}`;
};

const responseJson = async <T>(response: Response): Promise<T> => {
  const payload = await response.json().catch(() => ({})) as T & WeChatResponseError;
  if (!response.ok || (typeof payload.errcode === "number" && payload.errcode !== 0)) {
    throw new Error(safeWeChatError(payload.errcode ?? response.status));
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
    countDrafts: async () => {
      const response = await fetcher(await authenticatedUrl("/cgi-bin/draft/count"), {
        method: "GET",
        signal: AbortSignal.timeout(20_000),
      });
      const payload = await responseJson<{ total_count?: number }>(response);
      return Number(payload.total_count || 0);
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
      await postJson("/cgi-bin/draft/update", {
        media_id: mediaId,
        index: 0,
        articles: article,
      });
    },
  };
};
