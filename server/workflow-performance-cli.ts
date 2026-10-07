import { getLocalDatabase, readStateProjection } from "./storage.js";
import { buildWorkflowPerformance } from "./workflow-performance.js";
import { readReworkObservations } from "./draft-rework.js";

// Read-only local report. No providers, network fetches, credentials or article bodies.
const now = new Date().toISOString();
const rework = readReworkObservations(await getLocalDatabase(), { now });
console.log(JSON.stringify(await readStateProjection(state => buildWorkflowPerformance(state, { now, rework })), null, 2));
