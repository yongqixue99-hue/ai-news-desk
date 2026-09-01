import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { previewPortableArchive, type PortableArchivePreviewReport } from "./portable-archive-preview.js";

const DEFAULT_MAX_COMPRESSED_BYTES = 20 * 1024 * 1024 * 1024;

export type PortableArchiveUploadErrorCode = "upload-empty" | "upload-too-large" | "upload-failed";

export class PortableArchiveUploadError extends Error {
  readonly code: PortableArchiveUploadErrorCode;

  constructor(code: PortableArchiveUploadErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PortableArchiveUploadError";
    this.code = code;
  }
}

export interface PortableArchiveUploadOptions {
  windowsWorkflowRoot: string;
  maxCompressedBytes?: number;
  /** Test/support seam; production uses the operating system temporary directory. */
  temporaryParentDirectory?: string;
}

export const previewPortableArchiveUpload = async (
  stream: Readable,
  options: PortableArchiveUploadOptions,
): Promise<PortableArchivePreviewReport> => {
  const maximum = options.maxCompressedBytes ?? DEFAULT_MAX_COMPRESSED_BYTES;
  const temporaryRoot = await mkdtemp(path.join(options.temporaryParentDirectory ?? os.tmpdir(), "ai-news-archive-upload-"));
  const temporaryArchivePath = path.join(temporaryRoot, "archive.tar.gz");
  let bytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maximum) {
        callback(new PortableArchiveUploadError("upload-too-large", "完整归档上传大小超过安全上限"));
        return;
      }
      callback(null, buffer);
    },
  });
  try {
    try {
      await pipeline(stream, counter, createWriteStream(temporaryArchivePath, { flags: "wx" }));
    } catch (error) {
      if (error instanceof PortableArchiveUploadError) throw error;
      throw new PortableArchiveUploadError("upload-failed", "完整归档上传未完成", { cause: error });
    }
    if (bytes === 0) throw new PortableArchiveUploadError("upload-empty", "没有收到完整归档文件内容");
    return await previewPortableArchive(temporaryArchivePath, options.windowsWorkflowRoot);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
};
