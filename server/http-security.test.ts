import assert from "node:assert/strict";
import test from "node:test";
import { evaluateLocalRequest } from "./http-security.js";

test("local API guard rejects DNS rebinding hosts and cross-origin mutations", () => {
  assert.deepEqual(evaluateLocalRequest({
    host: "attacker.example",
    method: "GET",
    port: 4317,
  }), { allowed: false, reason: "host" });
  assert.deepEqual(evaluateLocalRequest({
    host: "127.0.0.1:4317",
    origin: "https://attacker.example",
    method: "POST",
    port: 4317,
  }), { allowed: false, reason: "origin" });
});

test("local API guard allows same-origin browser calls and originless local automation", () => {
  assert.deepEqual(evaluateLocalRequest({
    host: "127.0.0.1:4317",
    origin: "http://127.0.0.1:4317",
    method: "PATCH",
    port: 4317,
  }), { allowed: true });
  assert.deepEqual(evaluateLocalRequest({
    host: "localhost:4317",
    method: "POST",
    port: 4317,
  }), { allowed: true });
});
