import type { Express } from "express";
import { AiStyleScoreError, scoreAiStyle } from "ai-style-score";
import { deleteProviderApiKey, getProviderApiKey, setProviderApiKey } from "./secrets.js";

const providerId = "jev-style-score";
const probeText = "这是一个只用于验证接口连接的示例段落。它不包含用户稿件，也不保存任何评分结果。程序只检查 API Key 是否能调用 Jev 模型，然后把凭据放进本机受保护的密钥存储。";

const statusFor = (error: unknown) => error instanceof AiStyleScoreError
  ? error.code === "auth" ? 401
    : ["invalid_text", "too_short", "too_long", "missing_key"].includes(error.code) ? 400 : 503
  : 503;

const messageFor = (error: unknown) => error instanceof AiStyleScoreError
  ? error.message
  : "本机密钥或 Jev 服务暂时不可用";

/** The editor consumes this optional opinion; DraftDesk quality gates stay independent. */
export const registerAiStyleScoreRoutes = (app: Express) => {
  app.get("/api/ai-style-score/key", async (_request, response) => {
    try {
      await getProviderApiKey(providerId);
      response.json({ configured: true });
    } catch {
      response.json({ configured: false });
    }
  });

  app.put("/api/ai-style-score/key", async (request, response) => {
    const key = request.body?.key;
    if (typeof key !== "string" || key.trim().length < 20 || /\s/u.test(key.trim())) {
      response.status(400).json({ error: "API Key 格式不正确" }); return;
    }
    try {
      await scoreAiStyle(probeText, { apiKey: key });
      await setProviderApiKey(providerId, key);
      response.json({ configured: true });
    } catch (error) { response.status(statusFor(error)).json({ error: messageFor(error) }); }
  });

  app.delete("/api/ai-style-score/key", async (_request, response) => {
    try {
      await deleteProviderApiKey(providerId);
      response.json({ configured: false });
    } catch { response.status(503).json({ error: "无法删除本机 Jev API Key" }); }
  });

  app.post("/api/ai-style-score", async (request, response) => {
    try {
      const key = await getProviderApiKey(providerId);
      response.json(await scoreAiStyle(request.body?.text, { apiKey: key }));
    } catch (error) { response.status(statusFor(error)).json({ error: messageFor(error) }); }
  });
};
