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

  const isArticleDraftUrl = (value) => /^https:\/\/(?:www\.)?xiaoheihe\.cn\/creator\/editor\/draft\/article\/[A-Za-z0-9_-]+\/?$/u.test(String(value || ""));
  const isHash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
  const checkpointIsBound = (job, checkpoint, live) => checkpoint
    && ["xiaoheihe-article-checkpoint/v1", "xiaoheihe-article-checkpoint/v2"].includes(checkpoint.schemaVersion)
    && checkpoint.draftId === job.draftId && isHash(checkpoint.contentHash) && isHash(checkpoint.signature)
    && isArticleDraftUrl(checkpoint.pageUrl) && checkpoint.pageUrl === live?.pageUrl
    && Array.isArray(checkpoint.imageIds) && checkpoint.imageIds.every(id => typeof id === "string" && id)
    && new Set(checkpoint.imageIds).size === checkpoint.imageIds.length;

  const sameIds = (a, b) => Array.isArray(a) && Array.isArray(b)
    && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const validUploadedIds = (ids, images) => Array.isArray(images)
    && images.every(image => image && typeof image.id === "string" && ids.includes(image.id) && /^https:\/\//u.test(image.source || ""))
    && new Set(images.map(image => image.id)).size === images.length;
  const validUploaded = (job, images) => validUploadedIds(imagePayload(job).map(image => image.id), images);

  /** Only a fresh read of this exact remote draft can authorize skipping a write. */
  const runArticleContent = async (job, dependencies) => {
    const checkpoint = await dependencies.loadCheckpoint();
    const live = await dependencies.readLive();
    let uploadedImages = [], resumingImages = false;
    if (checkpointIsBound(job, checkpoint, live)) {
      const partial = checkpoint.schemaVersion === "xiaoheihe-article-checkpoint/v2" && checkpoint.stage === "images";
      const partialValid = partial && validUploadedIds(checkpoint.imageIds, checkpoint.uploadedImages)
        && sameIds(checkpoint.imageIds, checkpoint.uploadedImages.map(image => image.id))
        && Array.isArray(checkpoint.pendingImageIds) && checkpoint.pendingImageIds.every(id => typeof id === "string" && id && !checkpoint.imageIds.includes(id))
        && new Set(checkpoint.pendingImageIds).size === checkpoint.pendingImageIds.length
        && sameIds(checkpoint.pendingImageIds, live.pendingImageIds);
      if (live.signature !== checkpoint.signature || live.imageCount !== checkpoint.imageIds.length
        || (partial ? !partialValid : live.pendingMarkers)) {
        return { ready: false, steps: [{ name: "正文", ok: false, detail: "小黑盒正文或图片已在平台变化，请先核对；本次没有覆盖平台中的修改" }] };
      }
      if (isHash(job.contentHash) && job.contentHash === checkpoint.contentHash
        && live.title === String(job.title || "").trim()) {
        if (partial) {
          if (!sameIds([...checkpoint.imageIds, ...checkpoint.pendingImageIds], imagePayload(job).map(image => image.id))) {
            return { ready: false, steps: [{ name: "配图", ok: false, detail: "续接图片记录与当前稿件不一致，请重新核对" }] };
          }
          uploadedImages = checkpoint.uploadedImages; resumingImages = true;
        }
        else if (sameIds(checkpoint.imageIds, imagePayload(job).map(image => image.id))) {
          return { ready: true, resumed: true, steps: [
            { name: "标题", ok: true, detail: "已回读核对，保留当前标题" },
            { name: "正文", ok: true, detail: "已回读核对，保留当前正文，仅续接发布设置" },
            { name: "配图", ok: true, detail: `已回读核对 ${live.imageCount} 张图片，不重复上传` },
          ] };
        }
      }
    }
    const steps = [];
    const saveProgress = async uploaded => {
      if (!validUploaded(job, uploaded) || !isHash(job.contentHash)) return;
      const after = await dependencies.readLive();
      const pending = imagePayload(job).filter(image => !uploaded.some(item => item.id === image.id)).map(image => image.id);
      if (!isArticleDraftUrl(after?.pageUrl) || !isHash(after.signature) || after.title !== String(job.title || "").trim()
        || after.imageCount !== uploaded.length || !sameIds(after.pendingImageIds, pending)) return;
      uploadedImages = uploaded.map(image => ({ id: image.id, source: image.source }));
      await dependencies.saveCheckpoint({ schemaVersion: "xiaoheihe-article-checkpoint/v2", stage: "images",
        draftId: job.draftId, contentHash: job.contentHash, pageUrl: after.pageUrl, signature: after.signature,
        imageIds: uploadedImages.map(image => image.id), uploadedImages, pendingImageIds: pending });
    };
    if (resumingImages) {
      steps.push({ name: "标题", ok: true, detail: "保留已核对的标题" }, { name: "正文", ok: true, detail: "保留正文，仅续接未完成图片" });
    } else {
      await dependencies.clearCheckpoint();
      steps.push(await dependencies.fillTitle(), await dependencies.fillBody());
    }
    if (steps.some(step => !step.ok)) return { ready: false, steps };
    if (!resumingImages) await saveProgress([]);
    const images = await dependencies.uploadImages({ uploadedImages, onProgress: saveProgress });
    steps.push(images);
    if (!images.ok) return { ready: false, steps };
    const after = await dependencies.readLive();
    if (isHash(job.contentHash) && isArticleDraftUrl(after?.pageUrl) && isHash(after.signature)
      && after.title === String(job.title || "").trim() && !after.pendingMarkers && after.imageCount === imagePayload(job).length) {
      await dependencies.saveCheckpoint({ schemaVersion: "xiaoheihe-article-checkpoint/v2", stage: "complete",
        draftId: job.draftId, contentHash: job.contentHash, pageUrl: after.pageUrl,
        signature: after.signature, imageIds: imagePayload(job).map(image => image.id), uploadedImages, pendingImageIds: [] });
    }
    return { ready: true, resumed: false, steps };
  };

  const runCover = async (job, dependencies) => {
    const stored = await dependencies.loadCheckpoint();
    const live = await dependencies.readLive();
    if (stored?.schemaVersion === "xiaoheihe-cover-checkpoint/v1" && stored.draftId === job.draftId
      && stored.pageUrl === live?.pageUrl && isArticleDraftUrl(stored.pageUrl) && /^https:\/\//u.test(stored.source || "")) {
      if (stored.source !== live.source) return { ok: false, detail: "平台封面已变化，请先核对；本次没有覆盖平台修改" };
      if (isHash(job.coverHash) && stored.coverHash === job.coverHash) return { ok: true, detail: "已回读核对封面，不重复上传" };
    }
    const result = await dependencies.upload();
    if (result?.ok) {
      const after = await dependencies.readLive();
      if (isHash(job.coverHash) && isArticleDraftUrl(after?.pageUrl) && /^https:\/\//u.test(after.source || "")) {
        await dependencies.saveCheckpoint({ schemaVersion: "xiaoheihe-cover-checkpoint/v1", draftId: job.draftId,
          pageUrl: after.pageUrl, coverHash: job.coverHash, source: after.source });
      }
    }
    return result;
  };

  globalThis.XiaoheihePublisherJob = {
    markerIdsFromBodyHtml,
    validateArticleImagePayload,
    validateImagePostPayload,
    runArticleContent,
    runCover,
  };
})();
