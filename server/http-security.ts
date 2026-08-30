import type express from "express";

interface LocalRequestPolicyInput {
  host?: string;
  origin?: string;
  method: string;
  port: number;
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
  const localOrigins = new Set([
    `http://127.0.0.1:${input.port}`,
    `http://localhost:${input.port}`,
    `http://[::1]:${input.port}`,
  ]);
  return localOrigins.has(input.origin.toLowerCase())
    ? { allowed: true }
    : { allowed: false, reason: "origin" };
};

export const createLocalSecurityMiddleware = (port: number): express.RequestHandler =>
  (request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "DENY");
    const policy = evaluateLocalRequest({
      host: request.get("host"),
      origin: request.get("origin"),
      method: request.method,
      port,
    });
    if (policy.allowed) {
      next();
      return;
    }
    response.status(403).json({ error: policy.reason === "host" ? "拒绝非本机 Host" : "拒绝跨来源修改" });
  };
