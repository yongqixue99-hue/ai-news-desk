import { useState } from 'react';
import { Check, ExternalLink } from 'lucide-react';
import type { TopicRadarRow } from '../../server/topic-radar.js';
import type { StoryView } from '../types';

interface Props {
  rows: TopicRadarRow[];
  busy: boolean;
  onOpen: (story: StoryView) => void;
  onQueue: (story: StoryView, selected: boolean) => void;
  onRetain: (id: string) => Promise<void>;
}
export function TopicRadar({rows,busy,onOpen,onQueue,onRetain}: Props) {
  const [saving,setSaving] = useState('');
  return <div className="topic-radar" aria-label="每日选题表">
    <div className="radar-table-head" aria-hidden="true"><span>事件与读者价值</span><span>材料状态</span><span>下一步</span></div>
    {rows.map((row,index) => <article key={row.id} className="radar-row" data-story-id={row.story?.id}>
      <div className="radar-main">
        <div className="radar-meta"><span>{String(index+1).padStart(2,'0')}</span><span>{row.sources.slice(0,2).map(source=>source.name).join(' · ')}{row.sources.length>2?` 等 ${row.sources.length} 条来源`:''}</span><time dateTime={row.publishedAt}>{row.dateLabel} {new Date(row.publishedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</time></div>
        <h3>{row.story?<button type="button" aria-label={`查看 ${row.title}`} onClick={()=>onOpen(row.story!)}>{row.title}</button>:<a href={row.sources[0]?.url} target="_blank" rel="noreferrer">{row.title}</a>}</h3>
        <p className="radar-reason">{row.reason}</p>
        <details className="radar-evidence"><summary>摘要与来源</summary><p>{row.summary || '来源未提供摘要，请打开原文核对。'}</p><ul>{row.sources.map(source=><li key={`${source.name}:${source.url}`}><a href={source.url} target="_blank" rel="noreferrer">{source.name}<ExternalLink size={12}/></a></li>)}</ul><small>{row.story?'材料状态沿用原有证据规则。':'聚合摘要只作选题线索，留作选题后核验原文。'} 多处收录不等于独立证实。</small></details>
      </div>
      <div className="radar-status"><span className={row.status==='ready'?'radar-ready':''}>{row.status==='ready'?'可进入成稿':'待核对线索'}</span><small>{row.heat}</small></div>
      <div className="radar-actions">{row.story?<button type="button" className="text-button" onClick={()=>onOpen(row.story!)}>阅读核对</button>:null}
        <button type="button" className="text-button" disabled={busy || Boolean(saving) || row.selected} onClick={()=>{
          if(row.story) onQueue(row.story,true);
          else if(row.aggregationId) {setSaving(row.id);void onRetain(row.aggregationId).finally(()=>setSaving(''));}
        }}>{row.selected?<><Check size={13}/>已保留</>:saving===row.id?'保存中…':'留作选题'}</button>
      </div>
    </article>)}
  </div>;
}
