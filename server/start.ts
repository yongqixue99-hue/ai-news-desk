import { execFile, spawn } from "node:child_process";
import { constants } from "node:os";
import { fileURLToPath } from "node:url";
import { prepareNetworkLaunch, resolveNetworkEnvironment, shouldReadSystemProxy } from "./network-environment.js";

// This bootstrap must spawn the server: assigning NODE_USE_ENV_PROXY after
// this Node process has started does not initialize Node 22's proxy agent.
const readSystemProxy = () => new Promise<string | undefined>((resolve) => {
  execFile("/usr/sbin/scutil", ["--proxy"], { encoding: "utf8", timeout: 2_000, maxBuffer: 64 * 1024 }, (error, stdout) => {
    resolve(error ? undefined : stdout);
  });
});

const scutilOutput = shouldReadSystemProxy(process.env, process.platform) ? await readSystemProxy() : undefined;
const environment = resolveNetworkEnvironment(process.env, process.platform, scutilOutput);
const launch = prepareNetworkLaunch(environment, process.allowedNodeEnvironmentFlags.has("--use-env-proxy"));
if (launch.warning) process.stderr.write(`${launch.warning}\n`);

const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./index.ts", import.meta.url))], {
  cwd: process.cwd(), env: launch.env, stdio: "inherit", detached: false,
});
let closed = false;
let spawnFailed = false;
const forwardSignal = (signal: NodeJS.Signals) => { if (!closed) child.kill(signal); };
const onInterrupt = () => forwardSignal("SIGINT");
const onTerminate = () => forwardSignal("SIGTERM");
const onExit = () => { if (!closed) child.kill("SIGTERM"); };
process.on("SIGINT", onInterrupt);
process.on("SIGTERM", onTerminate);
process.on("exit", onExit);

child.once("error", () => {
  spawnFailed = true;
  process.stderr.write("新闻台服务启动失败，请检查 Node 运行时和项目依赖。\n");
  process.exitCode = 1;
});
child.once("close", (code, signal) => {
  closed = true;
  process.off("SIGINT", onInterrupt);
  process.off("SIGTERM", onTerminate);
  process.off("exit", onExit);
  process.exitCode = spawnFailed ? 1 : code ?? (signal ? 128 + (constants.signals[signal] ?? 1) : 1);
});
