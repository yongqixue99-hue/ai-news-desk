import type { BootstrapState } from "../bootstrap-state";
import { PageLoading } from "./PageLoading";

interface BootstrapStatusPageProps {
  state: BootstrapState;
  onRetry: () => void;
}

export function BootstrapStatusPage({ state, onRetry }: BootstrapStatusPageProps) {
  if (state.status === "ready") return null;
  if (state.status === "loading" || state.status === "idle") {
    return <PageLoading label="正在启动 AI 新闻台…" />;
  }
  return (
    <div className="app-loading" role="alert" aria-labelledby="bootstrap-error-title">
      <section>
        <strong id="bootstrap-error-title">AI 新闻台没有启动成功</strong>
        <p>{state.message}</p>
        <p>本地数据没有被修改。请检查服务状态后重新加载。</p>
        <button type="button" className="primary-button" onClick={onRetry}>重新加载</button>
      </section>
    </div>
  );
}
