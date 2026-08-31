import assert from "node:assert/strict";
import test from "node:test";
import { windowsServicePath } from "./windows-service-environment.js";

test("Windows background service restores Node, npm and Codex Desktop command paths", () => {
  const value = windowsServicePath({
    currentPath: "C:\\Windows\\System32;E:\\Nodejs",
    nodeExecutable: "E:\\Nodejs\\node.exe",
    appData: "C:\\Users\\tester\\AppData\\Roaming",
    codexExecutableDirectories: ["C:\\Users\\tester\\AppData\\Local\\OpenAI\\Codex\\bin\\build-1"],
  });
  const entries = value.split(";");

  assert.equal(
    value,
    "C:\\Windows\\System32;E:\\Nodejs;C:\\Users\\tester\\AppData\\Roaming\\npm;C:\\Users\\tester\\AppData\\Local\\OpenAI\\Codex\\bin\\build-1",
  );
  assert.ok(entries.includes("E:\\Nodejs"));
  assert.ok(entries.includes("C:\\Users\\tester\\AppData\\Roaming\\npm"));
  assert.ok(entries.includes("C:\\Users\\tester\\AppData\\Local\\OpenAI\\Codex\\bin\\build-1"));
  assert.equal(entries.filter((entry) => entry.toLowerCase() === "e:\\nodejs").length, 1);
});
