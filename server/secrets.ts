import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const serviceName = "cn.ai-news-desk.provider-api-key";
const weChatServiceName = "cn.ai-news-desk.wechat-app-secret";
const weChatAccountName = "primary";

const ensureMacKeychain = () => {
  if (process.platform !== "darwin") {
    throw new Error("当前版本只支持在 macOS 钥匙串中保存 API Key");
  }
};

export const providerKeyHint = (value: string) => {
  const key = value.trim();
  if (key.length < 9) return "••••••••";
  return `${key.slice(0, 3)}••••${key.slice(-4)}`;
};

export const setProviderApiKey = async (providerId: string, apiKey: string) => {
  ensureMacKeychain();
  const value = apiKey.trim();
  if (!value) throw new Error("API Key 不能为空");
  await execFileAsync("security", [
    "add-generic-password",
    "-U",
    "-a",
    providerId,
    "-s",
    serviceName,
    "-w",
    value,
  ]);
  return providerKeyHint(value);
};

export const getProviderApiKey = async (providerId: string) => {
  ensureMacKeychain();
  try {
    const result = await execFileAsync(
      "security",
      ["find-generic-password", "-a", providerId, "-s", serviceName, "-w"],
      { encoding: "utf8" },
    );
    const value = String(result.stdout).trim();
    if (!value) throw new Error("尚未配置 API Key");
    return value;
  } catch (error) {
    const detail = error as NodeJS.ErrnoException & { stderr?: string };
    if (detail.code === "ENOENT") throw new Error("系统中找不到 macOS security 命令");
    throw new Error("尚未在 macOS 钥匙串中找到这个厂商的 API Key");
  }
};

export const deleteProviderApiKey = async (providerId: string) => {
  ensureMacKeychain();
  await execFileAsync("security", [
    "delete-generic-password",
    "-a",
    providerId,
    "-s",
    serviceName,
  ]).catch(() => undefined);
};

export const weChatSecretHint = (value: string) => {
  const secret = value.trim();
  return secret.length >= 4 ? `••••••${secret.slice(-4)}` : "••••••••";
};

export const setWeChatAppSecret = async (appSecret: string) => {
  ensureMacKeychain();
  const value = appSecret.trim();
  if (!value) throw new Error("微信公众号 AppSecret 不能为空");
  await execFileAsync("security", [
    "add-generic-password",
    "-U",
    "-a",
    weChatAccountName,
    "-s",
    weChatServiceName,
    "-w",
    value,
  ]);
  return weChatSecretHint(value);
};

export const getWeChatAppSecret = async () => {
  ensureMacKeychain();
  try {
    const result = await execFileAsync(
      "security",
      ["find-generic-password", "-a", weChatAccountName, "-s", weChatServiceName, "-w"],
      { encoding: "utf8" },
    );
    const value = String(result.stdout).trim();
    if (!value) throw new Error("尚未配置微信公众号 AppSecret");
    return value;
  } catch (error) {
    const detail = error as NodeJS.ErrnoException;
    if (detail.code === "ENOENT") throw new Error("系统中找不到 macOS security 命令");
    throw new Error("尚未在 macOS 钥匙串中找到微信公众号 AppSecret");
  }
};

export const deleteWeChatAppSecret = async () => {
  ensureMacKeychain();
  await execFileAsync("security", [
    "delete-generic-password",
    "-a",
    weChatAccountName,
    "-s",
    weChatServiceName,
  ]).catch(() => undefined);
};
