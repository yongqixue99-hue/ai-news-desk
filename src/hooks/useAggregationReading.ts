import { useLayoutEffect, useRef, useState } from 'react';

interface ReadingState {
  platform: string; query: string; mode: string; nativeChannel: string; limit: number; expanded: string[];
}
interface Snapshot { at: number; state: ReadingState; y: number; anchor?: {id: string; top: number} }
const key = 'newsdesk:aggregation-reading:v1';
const initial: ReadingState = {platform:'all',query:'',mode:'recommended',nativeChannel:'auto',limit:40,expanded:[]};
let memory: Snapshot | undefined;

function restore(): Snapshot | undefined {
  try {
    const saved = memory || JSON.parse(sessionStorage.getItem(key) || 'null');
    if (!saved || Date.now()-saved.at > 30*60_000 || !Number.isFinite(saved.at) || !Number.isFinite(saved.y)) return;
    const s = saved.state;
    if (!s || ![s.platform,s.query,s.mode,s.nativeChannel].every(v=>typeof v === 'string') || !Number.isInteger(s.limit) || !Array.isArray(s.expanded)) return;
    return {...saved, state:{...s,query:s.query.slice(0,200),limit:Math.min(2000,Math.max(40,s.limit)),expanded:s.expanded.filter((v:unknown)=>typeof v === 'string').slice(0,100)},
      anchor:saved.anchor && typeof saved.anchor.id === 'string' && Number.isFinite(saved.anchor.top) ? saved.anchor : undefined};
  } catch { return memory; }
}

/** Keep navigation preferences, not news snapshots; every visit still reads current server data. */
export function useAggregationReading(ready: boolean) {
  const [saved] = useState(restore);
  const [state,setState] = useState<ReadingState>(()=>saved?.state || initial);
  const current = useRef(state); current.current = state;
  const restored = useRef(false);
  const position = useRef<Pick<Snapshot,'y'|'anchor'>>({y:saved?.y || 0,anchor:saved?.anchor});

  useLayoutEffect(()=>{
    const rememberPosition = () => {
      if (!restored.current) return;
      const row = [...document.querySelectorAll<HTMLElement>('[data-aggregation-id]')].find(el=>el.getBoundingClientRect().bottom > 72);
      position.current = {y:window.scrollY, anchor:row ? {id:row.dataset.aggregationId!,top:row.getBoundingClientRect().top} : undefined};
    };
    const save = () => {
      memory = {at:Date.now(),state:current.current,...position.current};
      try { sessionStorage.setItem(key,JSON.stringify(memory)); } catch { /* navigation still works in memory */ }
    };
    const hide = () => { if (document.visibilityState === 'hidden') save(); };
    window.addEventListener('scroll',rememberPosition,{passive:true});
    window.addEventListener('pagehide',save);
    document.addEventListener('visibilitychange',hide);
    return ()=>{
      save();
      window.removeEventListener('scroll',rememberPosition);
      window.removeEventListener('pagehide',save);
      document.removeEventListener('visibilitychange',hide);
    };
  },[]);

  useLayoutEffect(()=>{
    if (!ready || restored.current) return;
    const frame = requestAnimationFrame(()=>{
      const row = saved?.anchor ? document.querySelector<HTMLElement>(`[data-aggregation-id="${CSS.escape(saved.anchor.id)}"]`) : null;
      if (saved) window.scrollTo({top:row ? window.scrollY + row.getBoundingClientRect().top - saved.anchor!.top : saved.y,behavior:'instant'});
      restored.current = true;
    });
    return ()=>cancelAnimationFrame(frame);
  },[ready,saved]);

  return [state,setState] as const;
}
