import { candidateFromRun } from "./candidate-pool.js";
import { editorialIntakeDesk, type EditorialDraftRequest } from "./editorial-intake.js";
import { editorialGeneratorRevision } from "./draft-desk.js";
import { getLocalDatabase, readState } from "./storage.js";

/** One idempotency key for modern, batch and community compatibility routes. */
export const queueEditorialDraft = async (input: EditorialDraftRequest) => {
  const opened = await editorialIntakeDesk.open(input);
  const intent = input.intent ?? opened.intake.recommendedIntent;
  const candidate = candidateFromRun((await readState()).runs.find((run) => run.id === input.runId), input.candidateId);
  if (!candidate) throw new Error("候选不存在");
  const database = await getLocalDatabase();
  return { ...database.enqueueJob({
    type: "draft-from-editorial-intake",
    idempotencyKey: `draft-from-editorial-intake:${editorialGeneratorRevision}:${input.runId}:${input.candidateId}:${intent}:${candidate.fetchedAt}${input.sourceMode ? `:${input.sourceMode}` : ""}`,
    payload: { ...input, intent }, maxAttempts: 2,
  }), intake: opened.intake };
};
