import { createHash } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LocalDatabase } from "./local-database.js";
import { createDefaultState } from "./defaults.js";
import type { WorkflowState } from "./types.js";

const at = "2026-10-07T12:00:00.000Z";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
export const artifactFixture = (): WorkflowState => {
  const state = createDefaultState();
  state.runs = [{ id: "synthetic-run", createdAt: at, updatedAt: at, collectedAt: at,
    status: "ready", stage: "隔离示例", windowHours: 48, sourceIds: [], scheduled: false,
    topicIds: ["ai"], keywords: "synthetic", rawCount: 1, candidates: [], logs: [], evidenceCandidates: [], aggregationItems: [],
    discoveryTrace: [{ rawId: "synthetic-raw", url: "https://example.com/synthetic", title: "隔离示例",
      stage: "candidate-limit", observedAt: at, publishedAt: at }] }];
  return state;
};
export const seedSchema6 = async (root: string, state = artifactFixture(), wholeRow = false) => {
  const store = await LocalDatabase.open({ workflowRoot: root, initialState: createDefaultState });
  store.close();
  const db = new DatabaseSync(path.join(root, "newsdesk.db"));
  db.exec("DROP TABLE IF EXISTS run_artifacts; DELETE FROM state_fragments; UPDATE metadata SET value = '6' WHERE key = 'schema_version'");
  for (const [key, value] of wholeRow ? [] : Object.entries(state)) {
    const payload = JSON.stringify(value);
    db.prepare("INSERT INTO state_fragments VALUES (?, ?, ?, ?)").run(key, payload, sha(payload), at);
  }
  const payload = JSON.stringify(wholeRow ? state : { keys: Object.keys(state).sort() });
  db.prepare("UPDATE app_state SET state_json = ?, checksum = ? WHERE id = 1").run(payload, sha(payload));
  db.close();
};
