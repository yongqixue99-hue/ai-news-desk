// Read-only design preview: serves the working-tree frontend and forwards only
// GET requests to the running local service. Every write is refused here, so
// reviewing the UI cannot change drafts, runs, settings or deliveries.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const target = "http://127.0.0.1:4317";
const readOnly = {
  target,
  changeOrigin: true,
  configure(proxy) {
    proxy.on("proxyReq", (proxyRequest) => {
      proxyRequest.removeHeader("origin");
      proxyRequest.removeHeader("referer");
    });
  },
  bypass(request, response) {
    if (request.method === "GET" || request.method === "HEAD") return undefined;
    response.statusCode = 405;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ error: "只读预览：此操作未发送到正式服务。" }));
    return false;
  },
};

export default defineConfig({
  root,
  plugins: [react()],
  cacheDir: path.join(root, ".artifacts/ui-preview/.vite"),
  server: {
    host: "127.0.0.1",
    port: 4399,
    strictPort: true,
    proxy: { "/api": readOnly, "/media": readOnly, "/materials": readOnly },
  },
});
