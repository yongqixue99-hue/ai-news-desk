import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { TextDecoder } from "node:util";

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export type WindowsServiceLogEncoding =
  | "empty"
  | "utf8"
  | "utf8-bom"
  | "utf16le-bom"
  | "utf16be-bom"
  | "probable-utf16le"
  | "probable-utf16be"
  | "invalid-utf8";

const hasPrefix = (value: Buffer, prefix: ArrayLike<number>) => {
  if (value.length < prefix.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (value[index] !== prefix[index]) return false;
  }
  return true;
};

const probableUtf16Encoding = (value: Buffer) => {
  const sample = value.subarray(0, Math.min(value.length, 16 * 1024));
  if (sample.length < 2) return undefined;

  let evenNulls = 0;
  let oddNulls = 0;
  let evenBytes = 0;
  let oddBytes = 0;
  for (let index = 0; index < sample.length; index += 1) {
    if (index % 2 === 0) {
      evenBytes += 1;
      if (sample[index] === 0) evenNulls += 1;
    } else {
      oddBytes += 1;
      if (sample[index] === 0) oddNulls += 1;
    }
  }

  const evenRatio = evenBytes === 0 ? 0 : evenNulls / evenBytes;
  const oddRatio = oddBytes === 0 ? 0 : oddNulls / oddBytes;
  if (oddNulls >= 1 && oddRatio >= 0.5 && evenRatio <= 0.1) {
    return "probable-utf16le" as const;
  }
  if (evenNulls >= 1 && evenRatio >= 0.5 && oddRatio <= 0.1) {
    return "probable-utf16be" as const;
  }
  return undefined;
};

export const classifyWindowsServiceLogEncoding = (
  value: Buffer,
): WindowsServiceLogEncoding => {
  if (value.length === 0) return "empty";
  if (hasPrefix(value, [0xff, 0xfe])) return "utf16le-bom";
  if (hasPrefix(value, [0xfe, 0xff])) return "utf16be-bom";

  const probableUtf16 = probableUtf16Encoding(value);
  if (probableUtf16) return probableUtf16;

  const hasUtf8Bom = hasPrefix(value, UTF8_BOM);
  try {
    utf8Decoder.decode(hasUtf8Bom ? value.subarray(UTF8_BOM.length) : value);
    return hasUtf8Bom ? "utf8-bom" : "utf8";
  } catch {
    return "invalid-utf8";
  }
};

const legacyPathFor = (logPath: string, encoding: WindowsServiceLogEncoding, now: Date) => {
  const timestamp = now.toISOString().replace(/[-:.]/gu, "");
  const basePath = `${logPath}.legacy-${encoding}-${timestamp}`;
  let candidate = basePath;
  let suffix = 2;
  while (existsSync(candidate)) {
    candidate = `${basePath}-${suffix}`;
    suffix += 1;
  }
  return candidate;
};

const rotateBySize = (logPath: string, retainedLogs: number) => {
  const oldestLogPath = `${logPath}.${retainedLogs}`;
  if (existsSync(oldestLogPath)) unlinkSync(oldestLogPath);
  for (let index = retainedLogs - 1; index >= 1; index -= 1) {
    const source = `${logPath}.${index}`;
    if (existsSync(source)) renameSync(source, `${logPath}.${index + 1}`);
  }
  const rotatedPath = `${logPath}.1`;
  renameSync(logPath, rotatedPath);
  return rotatedPath;
};

export type WindowsServiceLogPreparation = {
  encoding?: WindowsServiceLogEncoding;
  archivedPath?: string;
  archiveReason?: "legacy-encoding" | "size-limit" | "utf8-bom-upgrade";
};

export const formatWindowsServiceFatal = (kind: string, reason: unknown) => {
  const detail = reason instanceof Error
    ? reason.stack || `${reason.name}: ${reason.message}`
    : String(reason);
  return `${kind}: ${detail.replace(/\s*\r?\n\s*/gu, " | ")}`;
};

export const prepareWindowsServiceLog = (input: {
  logPath: string;
  maximumLogBytes: number;
  retainedLogs: number;
  now?: Date;
}): WindowsServiceLogPreparation => {
  if (!Number.isInteger(input.retainedLogs) || input.retainedLogs < 1) {
    throw new Error("retainedLogs must be a positive integer");
  }
  mkdirSync(path.dirname(input.logPath), { recursive: true });

  let preparation: WindowsServiceLogPreparation = {};
  if (existsSync(input.logPath)) {
    const value = readFileSync(input.logPath);
    const encoding = classifyWindowsServiceLogEncoding(value);
    preparation.encoding = encoding;
    if (!["empty", "utf8-bom"].includes(encoding)) {
      const archivedPath = legacyPathFor(input.logPath, encoding, input.now ?? new Date());
      renameSync(input.logPath, archivedPath);
      preparation.archivedPath = archivedPath;
      preparation.archiveReason = encoding === "utf8" ? "utf8-bom-upgrade" : "legacy-encoding";
    } else if (statSync(input.logPath).size >= input.maximumLogBytes) {
      preparation.archivedPath = rotateBySize(input.logPath, input.retainedLogs);
      preparation.archiveReason = "size-limit";
    }
  }

  if (!existsSync(input.logPath) || statSync(input.logPath).size === 0) {
    // A BOM lets Windows PowerShell 5.1 auto-detect UTF-8 instead of treating
    // Chinese log messages as the active ANSI code page.
    writeFileSync(input.logPath, UTF8_BOM);
  }
  return preparation;
};

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException).code;

export const windowsServiceLogLockEndpoint = (logPath: string) => {
  const resolvedPath = path.resolve(logPath).replaceAll("\\", "/");
  const normalizedPath = process.platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath;
  const identity = createHash("sha256").update(normalizedPath).digest("hex").slice(0, 24);
  return process.platform === "win32"
    ? `\\\\.\\pipe\\ai-news-desk-service-log-${identity}`
    : path.join(os.tmpdir(), `ai-news-desk-service-log-${identity}.sock`);
};

export type WindowsServiceLogLock = {
  endpoint: string;
  release: () => Promise<void>;
};

export const acquireWindowsServiceLogLock = async (input: {
  logPath: string;
  endpoint?: string;
}): Promise<WindowsServiceLogLock> => {
  const endpoint = input.endpoint ?? windowsServiceLogLockEndpoint(input.logPath);
  const lockServer = createServer((connection) => connection.destroy());
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        lockServer.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        lockServer.off("error", onError);
        resolve();
      };
      lockServer.once("error", onError);
      lockServer.once("listening", onListening);
      lockServer.listen(endpoint);
    });
  } catch (error) {
    if (errorCode(error) === "EADDRINUSE") {
      throw new Error("Windows service log is already owned by another active process", {
        cause: error,
      });
    }
    throw error;
  }
  lockServer.unref();

  let released = false;
  return {
    endpoint,
    release: async () => {
      if (released) return;
      released = true;
      await new Promise<void>((resolve, reject) => {
        lockServer.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
};
