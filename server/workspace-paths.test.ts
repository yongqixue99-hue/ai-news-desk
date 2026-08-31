import assert from "node:assert/strict";
import test from "node:test";
import { resolveWorkflowRoot } from "./workspace-paths.js";

test("workflow root defaults to the project-local .workflow directory on either path dialect", () => {
  assert.equal(
    resolveWorkflowRoot("E:\\projects\\desk", undefined),
    "E:\\projects\\desk\\.workflow",
  );
  assert.equal(
    resolveWorkflowRoot("/srv/desk", undefined),
    "/srv/desk/.workflow",
  );
});

test("workflow root resolves absolute and project-relative overrides in the project's path dialect", () => {
  assert.equal(
    resolveWorkflowRoot("E:\\projects\\desk", "E:\\temp\\desk-test"),
    "E:\\temp\\desk-test",
  );
  assert.equal(
    resolveWorkflowRoot("E:\\projects\\desk", ".test-data\\run-1"),
    "E:\\projects\\desk\\.test-data\\run-1",
  );
  assert.equal(
    resolveWorkflowRoot("/srv/desk", "/tmp/desk-test"),
    "/tmp/desk-test",
  );
  assert.equal(
    resolveWorkflowRoot("/srv/desk", ".test-data/run-1"),
    "/srv/desk/.test-data/run-1",
  );
});
