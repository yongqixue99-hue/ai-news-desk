export function PageLoading({ label = "正在打开工作台…" }: { label?: string }) {
  return (
    <div className="page-loading" role="status" aria-live="polite">
      <p>{label}</p>
      <div className="page-skeleton" aria-hidden="true">
        <div className="skeleton-title" /><div className="skeleton-line" />
        <div className="skeleton-layout"><div /><div /></div>
      </div>
    </div>
  );
}
