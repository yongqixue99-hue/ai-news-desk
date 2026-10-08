import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

const format = "newsdesk:runs-gzip/v1";
export const MAX_RUN_FRAGMENT_BYTES = 128 * 1024 * 1024;
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

/** Lossless runs-only representation. Large legacy archives remain readable without pruning. */
export const encodeStateFragment = (key: string, rawJson: string): string => {
  const bytes = Buffer.byteLength(rawJson);
  if (key !== "runs" || bytes < 32_768 || bytes > MAX_RUN_FRAGMENT_BYTES) return rawJson;
  return JSON.stringify({ format, bytes, sha256: sha(rawJson), data: gzipSync(rawJson, { level: 1 }).toString("base64") });
};

export const decodeStateFragment = (key: string, storedJson: string): unknown => {
  const value: unknown = JSON.parse(storedJson);
  if (key !== "runs" && value && typeof value === "object" && "format" in value && value.format === format) throw new Error("压缩表示仅适用于运行切片");
  if (key !== "runs" || Array.isArray(value) || value === null || typeof value !== "object") return value;
  const wrapper = value as Record<string, unknown>;
  if (wrapper.format !== format || Object.keys(wrapper).sort().join() !== "bytes,data,format,sha256"
    || !Number.isInteger(wrapper.bytes) || Number(wrapper.bytes) < 0 || Number(wrapper.bytes) > MAX_RUN_FRAGMENT_BYTES
    || typeof wrapper.data !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(wrapper.data)
    || typeof wrapper.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(wrapper.sha256)) throw new Error("运行切片压缩格式无效");
  const compressed = Buffer.from(wrapper.data, "base64");
  if (compressed.toString("base64") !== wrapper.data) throw new Error("运行切片编码校验失败");
  const raw = gunzipSync(compressed, { maxOutputLength: Math.max(1, Number(wrapper.bytes)) });
  if (raw.length !== wrapper.bytes || sha(raw) !== wrapper.sha256) throw new Error("运行切片内容校验失败");
  const decoded: unknown = JSON.parse(raw.toString("utf8"));
  if (!Array.isArray(decoded)) throw new Error("运行切片必须是数组");
  return decoded;
};
