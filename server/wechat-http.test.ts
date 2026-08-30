import assert from "node:assert/strict";
import test from "node:test";
import { createWeChatHttpGateway } from "./wechat-http.js";

test("the WeChat HTTP adapter obtains a stable token before reading the draft count", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const gateway = createWeChatHttpGateway({
    appId: "wx-personal-account",
    appSecret: "wechat-super-secret",
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) {
        return new Response(JSON.stringify({ access_token: "stable-token", expires_in: 7200 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ total_count: 4 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    clock: () => 1_000_000,
  });

  const count = await gateway.countDrafts();

  assert.equal(count, 4);
  assert.equal(calls[0].url, "https://api.weixin.qq.com/cgi-bin/stable_token");
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    grant_type: "client_credential",
    appid: "wx-personal-account",
    secret: "wechat-super-secret",
    force_refresh: false,
  });
  assert.equal(calls[1].url, "https://api.weixin.qq.com/cgi-bin/draft/count?access_token=stable-token");
  assert.equal(calls[1].init?.method, "GET");
  assert.equal(JSON.stringify({ count, url: calls[1].url }).includes("wechat-super-secret"), false);
});

test("the WeChat HTTP adapter reuses its token while uploading content and cover images", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const gateway = createWeChatHttpGateway({
    appId: "wx-personal-account",
    appSecret: "wechat-super-secret",
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) {
        return Response.json({ access_token: "stable-token", expires_in: 7200 });
      }
      if (String(url).includes("/media/uploadimg")) {
        return Response.json({ url: "https://mmbiz.qpic.cn/content-image.jpg" });
      }
      return Response.json({ media_id: "cover-media-id", url: "https://mmbiz.qpic.cn/cover.jpg" });
    },
    clock: () => 1_000_000,
  });
  const asset = {
    bytes: new Uint8Array([1, 2, 3]),
    fileName: "news-cover.jpg",
    contentType: "image/jpeg" as const,
  };

  const content = await gateway.uploadContentImage(asset);
  const cover = await gateway.uploadPermanentImage(asset);

  assert.deepEqual(content, { url: "https://mmbiz.qpic.cn/content-image.jpg" });
  assert.deepEqual(cover, { mediaId: "cover-media-id", url: "https://mmbiz.qpic.cn/cover.jpg" });
  assert.equal(calls.length, 3, "one token request should serve both uploads");
  assert.equal(calls[1].url, "https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=stable-token");
  assert.equal(calls[2].url, "https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=stable-token&type=image");
  assert.equal(calls[1].init?.method, "POST");
  assert.equal(calls[2].init?.method, "POST");
  assert.ok(calls[1].init?.body instanceof FormData);
  assert.ok(calls[2].init?.body instanceof FormData);
  assert.equal((calls[1].init?.body as FormData).get("media") instanceof Blob, true);
  assert.equal((calls[2].init?.body as FormData).get("media") instanceof Blob, true);
});

test("the WeChat HTTP adapter creates and updates the same draft media id", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const gateway = createWeChatHttpGateway({
    appId: "wx-personal-account",
    appSecret: "wechat-super-secret",
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) return Response.json({ access_token: "stable-token", expires_in: 7200 });
      if (String(url).includes("/draft/add")) return Response.json({ media_id: "draft-media-id" });
      return Response.json({ errcode: 0, errmsg: "ok" });
    },
    clock: () => 1_000_000,
  });
  const article = {
    title: "一篇可读的 AI 新闻解读",
    author: "作者",
    digest: "摘要",
    content: "<p>正文</p>",
    thumb_media_id: "cover-media-id",
    need_open_comment: 0 as const,
    only_fans_can_comment: 0 as const,
  };

  const created = await gateway.addDraft(article);
  await gateway.updateDraft(created.mediaId, { ...article, title: "更新后的标题" });

  assert.deepEqual(created, { mediaId: "draft-media-id" });
  assert.equal(calls[1].url, "https://api.weixin.qq.com/cgi-bin/draft/add?access_token=stable-token");
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { articles: [article] });
  assert.equal(calls[2].url, "https://api.weixin.qq.com/cgi-bin/draft/update?access_token=stable-token");
  assert.deepEqual(JSON.parse(String(calls[2].init?.body)), {
    media_id: "draft-media-id",
    index: 0,
    articles: { ...article, title: "更新后的标题" },
  });
});

test("the WeChat HTTP adapter turns common platform errors into safe setup guidance", async () => {
  const scenarios = [
    [40164, "当前出口 IP 不在微信公众号白名单中，请到微信公众平台添加后重试"],
    [40125, "微信公众号 AppSecret 无效，请重新保存后重试"],
    [48001, "当前公众号没有草稿接口权限，请确认账号类型及接口权限"],
  ] as const;

  for (const [errcode, expected] of scenarios) {
    const gateway = createWeChatHttpGateway({
      appId: "wx-personal-account",
      appSecret: "wechat-super-secret",
      fetcher: async (url) => String(url).includes("stable_token")
        ? Response.json({ access_token: "stable-token", expires_in: 7200 })
        : Response.json({ errcode, errmsg: `unsafe upstream detail: wechat-super-secret` }),
    });

    await assert.rejects(gateway.countDrafts(), (error: Error) => {
      assert.match(error.message, new RegExp(expected));
      assert.doesNotMatch(error.message, /wechat-super-secret|unsafe upstream detail/);
      return true;
    });
  }
});
