import { sourceCoverage, type DiscoveryLayer } from '../../server/source-coverage.js';
import type { SourceConfig } from '../types';

export function SourceCoverage({sources,onChoose}:{sources:SourceConfig[];onChoose:(layer:DiscoveryLayer)=>void}) {
  const layers=sourceCoverage(sources);
  const configured=layers.filter(layer=>layer.automatic>0).length;
  return <details className="source-coverage">
    <summary>来源覆盖 <span>{configured} 类已加入默认采集 · 展开查看缺口</span></summary>
    <p>用途分类帮助发现选题，不改变来源可信度。每日来源随现有采集计划运行；案例按需补充，内容需求每周人工观察。</p>
    <div className="coverage-list">{layers.map(layer=><div className="coverage-row" key={layer.id}>
      <div><strong>{layer.label}</strong><span>{layer.purpose}</span></div>
      <div><span>{layer.automatic?`默认采集 ${layer.automatic} 个` : layer.configured?'可配置，未默认采集':'尚未自动接入'}</span><small>{layer.automatic?`${layer.healthy} 正常 · ${layer.unchecked} 未检查 · ${layer.attention} 需关注`:layer.cadence}</small></div>
      <details><summary>使用边界</summary><p>{layer.gap}</p></details>
      {layer.configured?<button type="button" className="text-button" onClick={()=>onChoose(layer.id)}>查看来源</button>:<span className="coverage-manual">手动补充</span>}
    </div>)}</div>
  </details>;
}
