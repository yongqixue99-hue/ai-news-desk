import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { createCoalescedRefresh } from "../coalesced-refresh";
import { waitForProductJob, deferredJobMessage } from "../product-job-wait";
import type { CommunityView } from "../../server/community-view";
import type { EditorialIntent } from "../types";
import { CommunityWorkspace } from "./CommunityWorkspace";
import { PageLoading } from "./PageLoading";

export function CommunityPage({ onOpenDraft, onNotice }: {
  onOpenDraft: (id: string) => void | Promise<void>;
  onNotice: (kind: "error" | "success", message: string) => void;
}) {
  const [view, setView] = useState<CommunityView>();
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState<() => Promise<void>>(() => async () => undefined);
  useEffect(() => {
    let active = true;
    const loader = createCoalescedRefresh({ read: api.community, apply: next => { setView(next); setError(""); } });
    const read = () => loader.request(true).catch(error => { if (active) setError(error instanceof Error ? error.message : String(error)); });
    setRefresh(() => read);
    void read();
    const visible = () => { if (document.visibilityState === "visible") void read(); };
    const timer = window.setInterval(visible, 60_000);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false; loader.dispose(); clearInterval(timer);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  const createDraft = useCallback(async (runId: string, candidateId: string, intent: EditorialIntent) => {
    try {
      const queued = await api.createEditorialDraft(runId, candidateId, intent);
      const waited = await waitForProductJob(queued.job, { read: api.productJob });
      if (waited.deferred) { onNotice("success", deferredJobMessage(waited.job)); return; }
      const result = waited.job.result as { draftId?: string } | undefined;
      const draftId = result?.draftId ?? queued.draft?.id;
      if (waited.job.status !== "complete" || !draftId) throw new Error(waited.job.error || "成稿尚未完成，可在任务进度查看原因");
      await onOpenDraft(draftId);
    } catch (error) {
      onNotice("error", error instanceof Error ? error.message : String(error));
    }
  }, [onNotice, onOpenDraft]);
  if (!view) return error ? <div className="page"><p role="alert">{error}</p><button className="secondary-button" onClick={() => void refresh()}>重新读取</button></div> : <PageLoading label="正在读取社区热点…" />;
  return <>
    {error ? <p className="community-refresh-error" role="status">更新暂未完成，保留当前内容。<button className="text-button" onClick={() => void refresh()}>重试</button></p> : null}
    <CommunityWorkspace feed={view.feed} sources={view.sources} settings={view.settings}
      onCreateDraft={createDraft}
      onFeedback={async (runId, candidateId, kind) => { try { await api.setCandidateFeedback(runId, candidateId, kind); await refresh(); } catch (error) { onNotice("error", String(error)); } }}
      onRestoreFeedback={async (runId, candidateId) => { try { await api.restoreCandidateFeedback(runId, candidateId); await refresh(); } catch (error) { onNotice("error", String(error)); } }}
      onAutoBrief={async requests => { await Promise.all(requests.slice(0, 3).map(request => api.briefCandidates(request.runId, request.candidateIds))); await refresh(); }} />
  </>;
}
