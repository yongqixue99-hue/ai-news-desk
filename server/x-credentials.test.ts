import assert from "node:assert/strict";
import test from "node:test";
import { readXCredentialStatus } from "./x-credentials.js";

test("X credential status never exposes the stored bearer token", async () => {
  const status = await readXCredentialStatus({
    getBearerToken: async () => "AAAAAAAAAAAAAAAAsecret-1234",
  });

  assert.deepEqual(status, { configured: true, hint: "••••••1234" });
  assert.equal(JSON.stringify(status).includes("secret"), false);
});

test("X credential status reports an unavailable protected secret as not configured", async () => {
  const status = await readXCredentialStatus({
    getBearerToken: async () => { throw new Error("missing"); },
  });

  assert.deepEqual(status, { configured: false });
});
