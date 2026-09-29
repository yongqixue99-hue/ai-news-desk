import test from "node:test";
import assert from "node:assert/strict";
import { fetchRemote, isDisallowedRemoteAddress, readResponseBuffer, validateRemoteUrl } from "./remote-url.js";

const outcome = async (work: Promise<unknown>) => {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([work.then(() => 'completed', (e: Error) => e.message), new Promise<string>(r => { timer = setTimeout(() => r('hung'), 300); })]); }
  finally { clearTimeout(timer!); }
};

test('cancellation bounds DNS validation even when the resolver never settles', async () => {
  const controller = new AbortController();
  const pending = validateRemoteUrl('https://publisher.example/article', {
    signal: controller.signal, resolve: async () => new Promise<never>(() => {}),
  });
  controller.abort(new Error('deadline reached'));
  assert.equal(await outcome(pending), 'deadline reached');
});

test('the request cancellation still applies while consuming a stalled response body', async (t) => {
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({cancel() { cancelled = true; }})));
  const controller = new AbortController();
  const response = await fetchRemote('https://8.8.8.8/article', {signal: controller.signal});
  const pending = readResponseBuffer(response, 1024);
  controller.abort(new Error('body deadline reached'));
  assert.equal(await outcome(pending), 'body deadline reached');
  assert.equal(cancelled, true);
});

test("private, loopback and reserved addresses are rejected", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.2", "169.254.1.1", "::1", "fd00::1", "fe80::1"]) {
    assert.equal(isDisallowedRemoteAddress(address), true, address);
  }
  assert.equal(isDisallowedRemoteAddress("8.8.8.8"), false);
  assert.equal(isDisallowedRemoteAddress("2606:4700:4700::1111"), false);
});

test("unsafe schemes, credentials and literal local URLs are rejected before fetching", async () => {
  await assert.rejects(() => validateRemoteUrl("file:///etc/passwd"), /HTTP\/HTTPS/);
  await assert.rejects(() => validateRemoteUrl("http://user:pass@example.com"), /用户名或密码/);
  await assert.rejects(() => validateRemoteUrl("http://127.0.0.1:4317"), /私网|回环|保留/);
});
