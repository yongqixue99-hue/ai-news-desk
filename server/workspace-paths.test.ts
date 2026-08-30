import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { resolveWorkflowRoot } from "./workspace-paths.js";

test("workflow root defaults to the project-local .workflow directory", () => {
  assert.equal(
    resolveWorkflowRoot("E:\\projects\\desk", undefined),
    path.resolve("E:\\projects\\desk", ".workflow"),
  );
});

test("workflow root can be isolated with an absolute or project-relative environment path", () => {
  assert.equal(
    resolveWorkflowRoot("E:\\projects\\desk", "E:\\temp\\desk-test"),
    path.resolve("E:\\temp\\desk-test"),
  );
  assert.equal(
    resolveWorkflowRoot("E:\\projects\\desk", ".test-data\\run-1"),
    path.resolve("E:\\projects\\desk", ".test-data\\run-1"),
  );
});
