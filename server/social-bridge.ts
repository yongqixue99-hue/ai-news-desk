import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";

export type SocialBridgeMethod = "listPlatforms" | "checkAuth" | "uploadImage" | "syncArticle";
/** Independently implemented Wechatsync request protocol. No third-party adapters are bundled. */
export class SocialBridge {
  private server?: WebSocketServer;
  private socket?: WebSocket;
  private token = "";
  private extensionId = "";
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(readonly port = 19527, private readonly timeoutMs = 180_000) {}
  get connected() { return this.socket?.readyState === WebSocket.OPEN; }
  async start(extensionId: string, token: string) {
    if (this.server && extensionId === this.extensionId && token === this.token) return;
    await this.stop();
    if (!/^[a-p]{32}$/.test(extensionId) || token.length < 16) throw new Error("请填写有效扩展 ID 和同步桥接 Token");
    this.extensionId = extensionId;
    this.token = token;
    const server = new WebSocketServer({
      host: "127.0.0.1", port: this.port, maxPayload: 2 * 1024 * 1024,
      verifyClient: ({ origin, req }: { origin: string; req: import("node:http").IncomingMessage }) => origin === `chrome-extension://${extensionId}`
        && req.headers.host === `127.0.0.1:${this.port}` && !this.connected,
    });
    this.server = server;
    server.on("connection", socket => {
      this.socket = socket;
      socket.on("message", bytes => {
        try {
          const message = JSON.parse(bytes.toString());
          const task = this.pending.get(message.id);
          if (!task) return;
          this.pending.delete(message.id); clearTimeout(task.timer);
          // Never persist or echo arbitrary extension errors (they may contain credentials).
          if (message.error) task.reject(new Error("同步助手拒绝请求，请检查 Token、登录状态和助手中的错误详情"));
          else task.resolve(message.result);
        } catch { /* Ignore malformed unsolicited messages. */ }
      });
      socket.on("error", () => socket.close());
      socket.on("close", () => {
        if (this.socket === socket) { this.socket = undefined; this.rejectPending(); }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", () => { this.server = undefined; reject(new Error("同步桥接端口被占用，请关闭其他工作台实例后重试")); });
    });
  }
  private rejectPending() {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error("同步连接已中断，已发送的任务需到平台核对")); }
    this.pending.clear();
  }
  async stop() {
    this.rejectPending();
    this.socket?.terminate(); this.socket = undefined;
    const server = this.server; this.server = undefined; this.token = "";
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  }
  request(method: SocialBridgeMethod, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.connected) return Promise.reject(new Error("文章同步助手尚未连接，请在 Chrome 中开启同步桥接"));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("同步助手响应超时，请到平台核对后再决定是否重试")); }, method === "syncArticle" || method === "uploadImage" ? this.timeoutMs : Math.min(this.timeoutMs, 15_000));
      this.pending.set(id, { resolve, reject, timer });
      this.socket!.send(JSON.stringify({ id, method, token: this.token, params }), error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(new Error("发送中断，请核对平台记录")); }
      });
    });
  }
}
