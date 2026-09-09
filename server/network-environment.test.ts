import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { prepareNetworkLaunch, resolveNetworkEnvironment, shouldReadSystemProxy } from "./network-environment.js";

const systemProxy = `<dictionary> {
  ExceptionsList : <array> {
    0 : *.local
  }
  HTTPEnable : 1
  HTTPProxy : 127.0.0.1
  HTTPPort : 7897
  HTTPSEnable : 1
  HTTPSProxy : ::1
  HTTPSPort : 7898
  SOCKSEnable : 1
  SOCKSProxy : 127.0.0.1
  SOCKSPort : 9999
}`;

test("macOS startup derives only enabled HTTP(S) proxies from the root system dictionary", () => {
  const resolved = resolveNetworkEnvironment({ PATH: "/runtime/bin" }, "darwin", systemProxy);
  assert.equal(resolved.HTTP_PROXY, "http://127.0.0.1:7897");
  assert.equal(resolved.HTTPS_PROXY, "http://[::1]:7898");
  assert.equal(resolved.ALL_PROXY, undefined);
  assert.equal(resolved.PATH, "/runtime/bin");
  assert.equal(resolved.NO_PROXY, "localhost,127.0.0.1,::1,[::1]");
  const nested = '<dictionary> {\n  __SCOPED__ : <dictionary> {\n    en0 : <dictionary> {\n      HTTPEnable : 1\n      HTTPProxy : 127.0.0.1\n      HTTPPort : 7897\n    }\n  }\n}';
  assert.equal(resolveNetworkEnvironment({}, "darwin", nested).HTTP_PROXY, undefined);
});

test("explicit environment proxies retain both original casing and values and suppress system fallback", () => {
  const env = { HTTP_PROXY: "http://upper.example:81", http_proxy: "http://lower.example:82", KEEP: "unchanged" };
  const snapshot = { ...env };
  const resolved = resolveNetworkEnvironment(env, "darwin", systemProxy);
  assert.equal(resolved.HTTP_PROXY, env.HTTP_PROXY);
  assert.equal(resolved.http_proxy, env.http_proxy);
  assert.equal(resolved.HTTPS_PROXY, undefined, "an HTTP-only user configuration must not silently inherit a system HTTPS proxy");
  assert.deepEqual(env, snapshot, "input environment is never mutated");
  assert.equal(shouldReadSystemProxy(env, "darwin"), false);
  assert.equal(shouldReadSystemProxy({ https_proxy: "" }, "darwin"), false, "an explicitly empty setting is also user configuration");
  assert.equal(prepareNetworkLaunch({ HTTP_PROXY: "http://upper.example:81", http_proxy: "" }, false).warning, undefined,
    "Node treats an explicitly empty lowercase value as overriding the uppercase proxy");
});

test("the effective lowercase NO_PROXY is preserved while local API hosts are added", () => {
  const resolved = resolveNetworkEnvironment({ NO_PROXY: "upper.example", no_proxy: "lower.example,localhost" }, "linux");
  assert.equal(resolved.NO_PROXY, "upper.example");
  assert.equal(resolved.no_proxy, "lower.example,localhost,127.0.0.1,::1,[::1]");
  assert.equal(resolveNetworkEnvironment({ NO_PROXY: "127.0.0.1,private.example" }, "win32").NO_PROXY,
    "127.0.0.1,private.example,localhost,::1,[::1]");
});

test("disabled or malformed system proxy endpoints cannot become launch configuration", () => {
  for (const [host, port] of [["http://proxy.example", "80"], ["user:password@proxy.example", "80"], ["proxy.example/path", "80"],
    ["proxy.example", "0"], ["proxy.example", "65536"], ["proxy.example", "abc"], ["proxy.example", "80;command"]]) {
    const raw = `<dictionary> {\n  HTTPEnable : 1\n  HTTPProxy : ${host}\n  HTTPPort : ${port}\n}`;
    assert.equal(resolveNetworkEnvironment({}, "darwin", raw).HTTP_PROXY, undefined);
  }
  assert.equal(resolveNetworkEnvironment({}, "darwin", systemProxy.replace("HTTPEnable : 1", "HTTPEnable : 0")).HTTP_PROXY, undefined);
  assert.equal(resolveNetworkEnvironment({}, "darwin", "unrecognized output").HTTP_PROXY, undefined);
});

test("SOCKS and non-macOS environments are not translated into unrelated HTTP proxies", () => {
  const env = { ALL_PROXY: "socks5://127.0.0.1:9999" };
  const resolved = resolveNetworkEnvironment(env, "win32", systemProxy);
  assert.equal(resolved.ALL_PROXY, env.ALL_PROXY);
  assert.equal(resolved.HTTP_PROXY, undefined);
  assert.equal(resolved.HTTPS_PROXY, undefined);
  assert.equal(shouldReadSystemProxy(env, "win32"), false);
  assert.equal(prepareNetworkLaunch(resolved, true).env.NODE_USE_ENV_PROXY, undefined);
});

test("native proxy support is enabled in the child startup environment, never by mutating this process", () => {
  const env = resolveNetworkEnvironment({ HTTPS_PROXY: "http://proxy.example:8080", CUSTOM: "kept" }, "linux");
  const plan = prepareNetworkLaunch(env, true);
  assert.equal(plan.env.NODE_USE_ENV_PROXY, "1");
  assert.equal(plan.env.CUSTOM, "kept");
  assert.equal(plan.warning, undefined);
  assert.equal(env.NODE_USE_ENV_PROXY, undefined);
  assert.notEqual(plan.env, env);
});

test("older Node 22 remains startable and gets a concise capability warning without proxy values", () => {
  const env = { HTTPS_PROXY: "http://user:secret@private-proxy.example:8080" };
  const plan = prepareNetworkLaunch(env, false);
  assert.equal(plan.env.NODE_USE_ENV_PROXY, undefined);
  assert.match(plan.warning ?? "", /22\.21/);
  assert.doesNotMatch(plan.warning ?? "", /user|secret|private-proxy|8080/);
});

test("an explicit proxy opt-out is respected even with an existing proxy or system settings", () => {
  const env = { NODE_USE_ENV_PROXY: "0", HTTPS_PROXY: "http://proxy.example:8080" };
  assert.equal(shouldReadSystemProxy({ NODE_USE_ENV_PROXY: "0" }, "darwin"), false);
  assert.equal(resolveNetworkEnvironment({ NODE_USE_ENV_PROXY: "0" }, "darwin", systemProxy).HTTPS_PROXY, undefined);
  for (const supported of [true, false]) {
    const plan = prepareNetworkLaunch(resolveNetworkEnvironment(env, "darwin", systemProxy), supported);
    assert.equal(plan.env.NODE_USE_ENV_PROXY, "0");
    assert.equal(plan.env.HTTPS_PROXY, env.HTTPS_PROXY);
    assert.equal(plan.warning, undefined);
  }
});

test("a real Node child bypasses the proxy for an IPv6 loopback API", async (context) => {
  if (!process.allowedNodeEnvironmentFlags.has("--use-env-proxy")) return context.skip("native proxy support requires Node 22.21+");
  const env = resolveNetworkEnvironment({ ...process.env,
    HTTP_PROXY: "http://127.0.0.1:1", http_proxy: "http://127.0.0.1:1",
    NO_PROXY: undefined, no_proxy: undefined, NODE_USE_ENV_PROXY: undefined }, process.platform);
  const plan = prepareNetworkLaunch(env, true);
  const script = `
    import { createServer } from 'node:http';
    const server = createServer((_request, response) => response.end('local-api'));
    try {
      try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '::1', resolve); }); }
      catch (error) { if (['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) { console.log(JSON.stringify({ unavailable: true })); process.exit(0); } throw error; }
      const response = await fetch('http://[::1]:' + server.address().port + '/', { signal: AbortSignal.timeout(2000) });
      console.log(JSON.stringify({ status: response.status, text: await response.text() }));
    } finally { server.closeAllConnections(); server.close(); }
  `;
  const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "--eval", script],
    { env: plan.env, timeout: 5000, maxBuffer: 16 * 1024 });
  const result = JSON.parse(stdout);
  if (result.unavailable) return context.skip("IPv6 loopback is disabled on this host");
  assert.deepEqual(result, { status: 200, text: "local-api" });
});
