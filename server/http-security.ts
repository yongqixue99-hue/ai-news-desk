import type express from "express";
import { timingSafeEqual } from "node:crypto";

interface LocalRequestPolicyInput {
  host?: string;
  origin?: string;
  method: string;
  port: number;
  publisherExtensionAuthenticated?: boolean;
}

export const evaluateLocalRequest = (input: LocalRequestPolicyInput): {
  allowed: boolean;
  reason?: "host" | "origin";
} => {
  const localHosts = new Set([
    `127.0.0.1:${input.port}`,
    `localhost:${input.port}`,
    `[::1]:${input.port}`,
  ]);
  if (!input.host || !localHosts.has(input.host.toLowerCase())) return { allowed: false, reason: "host" };
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(input.method.toUpperCase());
  if (!mutation || !input.origin) return { allowed: true };
  if (input.publisherExtensionAuthenticated && /^chrome-extension:\/\/[a-p]{32}$/u.test(input.origin)) {
    return { allowed: true };
  }
  const localOrigins = new Set([
    `http://127.0.0.1:${input.port}`,
    `http://localhost:${input.port}`,
    `http://[::1]:${input.port}`,
  ]);
  return localOrigins.has(input.origin.toLowerCase())
    ? { allowed: true }
    : { allowed: false, reason: "origin" };
};

const isPublisherExtensionWrite = (request: express.Request, expectedToken?: string) => {
  // Background workers have a chrome-extension Origin. Only the paired helper's
  // two protocol writes are allowed; this is not a general extension/CSRF bypass.
  if (request.method !== "POST" || !expectedToken) return false;
  if (request.path !== "/api/publisher/extension/heartbeat"
    && !/^\/api\/publisher\/extension\/jobs\/[A-Za-z0-9_-]+\/result$/u.test(request.path)) return false;
  const actual = Buffer.from(request.get("x-ai-news-extension-token") || "");
  const expected = Buffer.from(expectedToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

export const createLocalSecurityMiddleware = (
  port: number,
  options: { publisherExtensionToken?: () => string } = {},
): express.RequestHandler =>
  (request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "DENY");
    const policy = evaluateLocalRequest({
      host: request.get("host"),
      origin: request.get("origin"),
      method: request.method,
      port,
      publisherExtensionAuthenticated: isPublisherExtensionWrite(request, options.publisherExtensionToken?.()),
    });
    if (policy.allowed) {
      next();
      return;
    }
    response.status(403).json({ error: policy.reason === "host" ? "拒绝非本机 Host" : "拒绝跨来源修改" });
  };
