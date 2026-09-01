import { Check, CheckCircle2, ExternalLink, Info, ShieldAlert } from "lucide-react";
import { buildDraftEvidenceView } from "../../server/draft-evidence-view.js";
import type { ArticleDraft, DraftFactEvidenceStatus } from "../types.js";

interface DraftEvidencePanelProps {
  draft: ArticleDraft;
  onUpdateFactClaim: (claimId: string, status: DraftFactEvidenceStatus) => void;
  onResolveFactUncertainty: (uncertainty: string) => void;
}

const sourceUrlsFor = (claim: NonNullable<ArticleDraft["factClaims"]>[number]) =>
  claim.sourceUrls?.length ? claim.sourceUrls : claim.sourceUrl ? [claim.sourceUrl] : [];

export function DraftEvidencePanel({ draft, onUpdateFactClaim, onResolveFactUncertainty }: DraftEvidencePanelProps) {
  const view = buildDraftEvidenceView(draft);
  const needsFactDecision = view.factDecisionCount > 0;
  const automaticCopy = view.automaticFactCount
    ? `${view.automaticFactCount} 条正文事实已回指来源，不需要你逐条勾选。`
    : "当前没有可自动确认的正文事实。";

  return (
    <>
      <section className={`evidence-overview ${needsFactDecision ? "attention" : "ready"}`}>
        {needsFactDecision ? <ShieldAlert size={18} /> : <CheckCircle2 size={18} />}
        <span>
          <strong>{needsFactDecision ? `确实有 ${view.factDecisionCount} 项需要你判断` : "事实来源已自动整理"}</strong>
          <small>{needsFactDecision ? "系统只保留真正影响正文准确性的事项。" : automaticCopy}</small>
        </span>
      </section>

      <section className="utility-section evidence-source-section">
        <div className="inspector-heading">
          <h3>事件来源</h3>
          <span>{view.eventSources.filter((source) => source.verified).length}/{view.eventSources.length} 已读取</span>
        </div>
        <p className="evidence-section-help">这些页面负责支持正文中的项目、公司和数据事实。</p>
        <div className="source-proof-list evidence-source-list">
          {view.eventSources.map((source, index) => (
            <a href={source.url} target="_blank" rel="noreferrer" key={`${source.url}-${index}`}>
              <span className={source.verified ? "proof-check verified" : "proof-check pending"}>
                {source.verified ? <Check size={15} /> : <Info size={15} />}
              </span>
              <span><strong>{source.label}</strong><small>{source.verified ? "系统已读取正文" : "系统尚需补充正文"}</small></span>
              <ExternalLink size={14} />
            </a>
          ))}
          {!view.eventSources.length ? <p className="empty-inspector">还没有可支持正文的事件来源，系统不会把社区评论当成新闻事实。</p> : null}
        </div>
      </section>

      {view.discoverySources.length ? (
        <details className="utility-section evidence-details discovery-details">
          <summary>
            <span><strong>发现线索</strong><small>只说明这条选题从哪里被发现，不参与新闻事实核验。</small></span>
            <em>{view.discoverySources.map((source) => source.label).join("、")}</em>
          </summary>
          <div className="evidence-detail-body">
            {view.discoverySources.map((source, index) => (
              <a href={source.url} target="_blank" rel="noreferrer" key={`${source.url}-${index}`}>
                {source.label}<ExternalLink size={12} />
              </a>
            ))}
          </div>
        </details>
      ) : null}

      <section className="utility-section fact-evidence-section simplified">
        <div className="inspector-heading">
          <h3>正文事实</h3>
          <span className={needsFactDecision ? "has-risk" : ""}>{view.automaticFactCount} 条已自动核验</span>
        </div>
        {view.automaticClaims.length ? (
          <div className="fact-claim-list automatic-facts">
            {view.automaticClaims.map((claim) => (
              <article key={claim.id} className="fact-claim automatic">
                <CheckCircle2 size={15} />
                <div>
                  <strong>{claim.claim}</strong>
                  <span>证据已保存</span>
                  {sourceUrlsFor(claim).map((sourceUrl, sourceIndex) => (
                    <a key={sourceUrl} href={sourceUrl} target="_blank" rel="noreferrer">
                      查看来源{sourceUrlsFor(claim).length > 1 ? ` ${sourceIndex + 1}` : ""}<ExternalLink size={11} />
                    </a>
                  ))}
                </div>
              </article>
            ))}
          </div>
        ) : <p className="empty-inspector">系统还没有建立可直接支持正文的事实证据。</p>}

        {view.attentionClaims.length ? (
          <div className="fact-attention-list">
            {view.attentionClaims.map((claim) => (
              <article key={claim.id} className="fact-claim attention">
                <div>
                  <strong>{claim.claim}</strong>
                  <select
                    aria-label={`证据状态：${claim.claim}`}
                    value={claim.status}
                    onChange={(event) => onUpdateFactClaim(claim.id, event.target.value as DraftFactEvidenceStatus)}
                  >
                    <option value="unverified">尚未核验</option>
                    <option value="excerpt-only">仅摘要支持</option>
                    <option value="inference">编辑推断</option>
                    <option value="full-source">已核对完整原文</option>
                    <option value="cross-confirmed">已由多源确认</option>
                  </select>
                </div>
                {sourceUrlsFor(claim).map((sourceUrl) => <a key={sourceUrl} href={sourceUrl} target="_blank" rel="noreferrer">查看证据<ExternalLink size={11} /></a>)}
              </article>
            ))}
          </div>
        ) : null}
      </section>

      {view.factUncertainties.length ? (
        <section className="utility-section evidence-actions">
          <div className="inspector-heading"><h3>需要你确认</h3><span className="has-risk">{view.factUncertainties.length} 项</span></div>
          <ul>
            {view.factUncertainties.map((item) => (
              <li key={item}><span>{item}</span><button onClick={() => onResolveFactUncertainty(item)}>我已核实</button></li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.contextNotes.length ? (
        <details className="utility-section evidence-details context-details">
          <summary><span><strong>已知边界 · {view.contextNotes.length}</strong><small>这些内容没有写成事实，不需要你处理。</small></span></summary>
          <ul>{view.contextNotes.map((item) => <li key={item}>{item.replace(/^仍未知[：:]?/u, "")}</li>)}</ul>
        </details>
      ) : null}

      {view.rightsNotes.length || view.sourceRightsDecisionCount ? (
        <section className="utility-section evidence-later-note">
          <Info size={16} />
          <span><strong>发布时再处理</strong><small>现在只需要看正文；图片或原文转载权限会在你打开“发布”时集中检查。</small></span>
        </section>
      ) : null}

      {view.discussionNotes.length ? (
        <details className="utility-section evidence-details discussion-details">
          <summary><span><strong>社区线索 · {view.discussionNotes.length}</strong><small>已和新闻事实隔离，不会要求你把评论核验成事实。</small></span></summary>
          <ul>{view.discussionNotes.map((claim) => <li key={claim.id}>{claim.claim.replace(/^---\s*(热门评论|Top Comments)\s*---\s*/u, "")}</li>)}</ul>
        </details>
      ) : null}

      <details className="utility-section evidence-details technical-details">
        <summary><span><strong>技术溯源</strong><small>一般无需查看</small></span></summary>
        <div className="evidence-detail-body">
          <span>运行记录：{draft.runId}</span>
          <a href={draft.provenance.originalUrl} target="_blank" rel="noreferrer">打开原始记录<ExternalLink size={12} /></a>
        </div>
      </details>
    </>
  );
}
