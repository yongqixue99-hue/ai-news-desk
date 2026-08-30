import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { workflowRoot } from "./workspace-paths.js";

const execFileAsync = promisify(execFile);
const serviceName = "cn.ai-news-desk.provider-api-key";
const weChatServiceName = "cn.ai-news-desk.wechat-app-secret";
const weChatAccountName = "primary";
const windowsSecretPath = path.join(workflowRoot, "secrets.windows.json");

interface WindowsSecretStore {
  version: 1;
  protectedValues: Record<string, string>;
}

const emptyWindowsStore = (): WindowsSecretStore => ({ version: 1, protectedValues: {} });
let windowsMutationQueue: Promise<void> = Promise.resolve();

const runPowerShell = (script: string, input: string) => new Promise<string>((resolve, reject) => {
  const child = spawn(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += String(chunk)));
  child.stderr.on("data", (chunk) => (stderr += String(chunk)));
  child.on("error", reject);
  child.on("close", (code) => {
    if (code === 0) resolve(stdout.trim());
    else reject(new Error(stderr.trim() || `PowerShell 退出码 ${code}`));
  });
  child.stdin.end(input, "utf8");
});

const protectForWindowsUser = (value: string) => runPowerShell(
  "Add-Type -AssemblyName System.Security; $value = [Console]::In.ReadToEnd(); $bytes = [Text.Encoding]::UTF8.GetBytes($value); "
    + "$protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser); "
    + "[Console]::Out.Write([Convert]::ToBase64String($protected))",
  value,
);

const unprotectForWindowsUser = (value: string) => runPowerShell(
  "Add-Type -AssemblyName System.Security; $value = [Console]::In.ReadToEnd(); $bytes = [Convert]::FromBase64String($value); "
    + "$plain = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser); "
    + "[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))",
  value,
);

const readWindowsStore = async () => {
  try {
    const parsed = JSON.parse(await readFile(windowsSecretPath, "utf8")) as Partial<WindowsSecretStore>;
    return {
      version: 1 as const,
      protectedValues: parsed.protectedValues && typeof parsed.protectedValues === "object"
        ? parsed.protectedValues
        : {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyWindowsStore();
    throw new Error("Windows 本机密钥存储无法读取");
  }
};

const mutateWindowsStore = <T>(operation: (store: WindowsSecretStore) => Promise<T>) => {
  let result: T;
  const queued = windowsMutationQueue.then(async () => {
    const store = await readWindowsStore();
    result = await operation(store);
    await mkdir(path.dirname(windowsSecretPath), { recursive: true });
    await writeFile(windowsSecretPath, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  });
  windowsMutationQueue = queued.catch(() => undefined);
  return queued.then(() => result!);
};

const setWindowsSecret = async (key: string, value: string) => {
  const protectedValue = await protectForWindowsUser(value);
  if (!protectedValue) throw new Error("Windows DPAPI 没有返回加密结果");
  await mutateWindowsStore(async (store) => {
    store.protectedValues[key] = protectedValue;
  });
};

const getWindowsSecret = async (key: string, missingMessage: string) => {
  const store = await readWindowsStore();
  const protectedValue = store.protectedValues[key];
  if (!protectedValue) throw new Error(missingMessage);
  try {
    const value = (await unprotectForWindowsUser(protectedValue)).trim();
    if (!value) throw new Error(missingMessage);
    return value;
  } catch {
    throw new Error("Windows 本机密钥无法解密；请由当前 Windows 用户重新保存");
  }
};

const deleteWindowsSecret = (key: string) => mutateWindowsStore(async (store) => {
  delete store.protectedValues[key];
});

const ensureSupportedSecretStore = () => {
  if (process.platform !== "darwin" && process.platform !== "win32") {
    throw new Error("当前系统尚未配置受保护的本机密钥存储");
  }
};

const setMacSecret = (account: string, service: string, value: string) => execFileAsync("security", [
  "add-generic-password",
  "-U",
  "-a",
  account,
  "-s",
  service,
  "-w",
  value,
]);

const getMacSecret = async (account: string, service: string, missingMessage: string) => {
  try {
    const result = await execFileAsync(
      "security",
      ["find-generic-password", "-a", account, "-s", service, "-w"],
      { encoding: "utf8" },
    );
    const value = String(result.stdout).trim();
    if (!value) throw new Error(missingMessage);
    return value;
  } catch (error) {
    const detail = error as NodeJS.ErrnoException;
    if (detail.code === "ENOENT") throw new Error("系统中找不到 macOS security 命令");
    throw new Error(missingMessage);
  }
};

const deleteMacSecret = (account: string, service: string) => execFileAsync("security", [
  "delete-generic-password",
  "-a",
  account,
  "-s",
  service,
]).catch(() => undefined);

export const providerKeyHint = (value: string) => {
  const key = value.trim();
  if (key.length < 9) return "••••••••";
  return `${key.slice(0, 3)}••••${key.slice(-4)}`;
};

export const setProviderApiKey = async (providerId: string, apiKey: string) => {
  ensureSupportedSecretStore();
  const value = apiKey.trim();
  if (!value) throw new Error("API Key 不能为空");
  if (process.platform === "win32") await setWindowsSecret(`provider:${providerId}`, value);
  else await setMacSecret(providerId, serviceName, value);
  return providerKeyHint(value);
};

export const getProviderApiKey = async (providerId: string) => {
  ensureSupportedSecretStore();
  const missingMessage = "尚未在本机安全存储中找到这个厂商的 API Key";
  return process.platform === "win32"
    ? getWindowsSecret(`provider:${providerId}`, missingMessage)
    : getMacSecret(providerId, serviceName, missingMessage);
};

export const deleteProviderApiKey = async (providerId: string) => {
  ensureSupportedSecretStore();
  if (process.platform === "win32") await deleteWindowsSecret(`provider:${providerId}`);
  else await deleteMacSecret(providerId, serviceName);
};

export const weChatSecretHint = (value: string) => {
  const secret = value.trim();
  return secret.length >= 4 ? `••••••${secret.slice(-4)}` : "••••••••";
};

export const setWeChatAppSecret = async (appSecret: string) => {
  ensureSupportedSecretStore();
  const value = appSecret.trim();
  if (!value) throw new Error("微信公众号 AppSecret 不能为空");
  if (process.platform === "win32") await setWindowsSecret("wechat:primary", value);
  else await setMacSecret(weChatAccountName, weChatServiceName, value);
  return weChatSecretHint(value);
};

export const getWeChatAppSecret = async () => {
  ensureSupportedSecretStore();
  const missingMessage = "尚未在本机安全存储中找到微信公众号 AppSecret";
  return process.platform === "win32"
    ? getWindowsSecret("wechat:primary", missingMessage)
    : getMacSecret(weChatAccountName, weChatServiceName, missingMessage);
};

export const deleteWeChatAppSecret = async () => {
  ensureSupportedSecretStore();
  if (process.platform === "win32") await deleteWindowsSecret("wechat:primary");
  else await deleteMacSecret(weChatAccountName, weChatServiceName);
};
