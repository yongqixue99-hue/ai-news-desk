(() => {
  const imagePayload = (job) => Array.isArray(job?.images) ? job.images : [];

  const markerIdsFromBodyHtml = (bodyHtml) => {
    const html = String(bodyHtml || "");
    const attributes = [];
    const attributePattern = /data-ai-news-image\s*=\s*(["'])([^"']+)\1/giu;
    for (const match of html.matchAll(attributePattern)) attributes.push(String(match[2] || "").trim());
    if (attributes.length) return attributes.filter(Boolean);

    const tokens = [];
    const tokenPattern = /AIIMG:([A-Za-z0-9_.:-]+)/gu;
    for (const match of html.matchAll(tokenPattern)) tokens.push(String(match[1] || "").trim());
    return tokens.filter(Boolean);
  };

  const validateArticleImagePayload = (job) => {
    const images = imagePayload(job);
    const payloadIds = images.map((image) => String(image?.id || "").trim()).filter(Boolean);
    const markerIds = markerIdsFromBodyHtml(job?.bodyHtml);
    const payloadSet = new Set(payloadIds);
    const markerSet = new Set(markerIds);
    if (payloadIds.length !== images.length || payloadSet.size !== payloadIds.length) {
      return { ok: false, detail: "发布图片载荷包含空 ID 或重复 ID", payloadIds, markerIds };
    }
    if (markerSet.size !== markerIds.length) {
      return { ok: false, detail: "正文包含重复的图片定位标记", payloadIds, markerIds };
    }
    const exact = payloadIds.length === markerIds.length
      && payloadIds.every((id) => markerSet.has(id))
      && markerIds.every((id) => payloadSet.has(id));
    if (!exact) {
      return {
        ok: false,
        detail: `正文图片标记与上传载荷不一致（标记 ${markerIds.length} 张，载荷 ${payloadIds.length} 张）`,
        payloadIds,
        markerIds,
      };
    }
    return { ok: true, detail: `图片标记与载荷一致（${payloadIds.length} 张）`, payloadIds, markerIds };
  };

  const validateImagePostPayload = (job) => {
    const images = imagePayload(job);
    if (images.length < 1 || images.length > 18) return { ok: false, detail: `工作台图文支持 1–18 张图片，当前 ${images.length} 张` };
    const ids = images.map(image => String(image?.id || "").trim());
    if (ids.some(id => !id) || new Set(ids).size !== ids.length || images.some(image => !/^data:image\/(png|jpeg|webp|gif);base64,/iu.test(image?.dataUrl || ""))) return { ok: false, detail: "图集包含重复、缺失或不可上传的图片" };
    return { ok: true, detail: `图文稿包含 ${images.length} 张待上传图片` };
  };

  globalThis.XiaoheihePublisherJob = {
    markerIdsFromBodyHtml,
    validateArticleImagePayload,
    validateImagePostPayload,
  };
})();
