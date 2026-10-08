import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { titleTranslationFor, visibleTranslationTargets } from "../aggregation-title-display.js";
import type { AggregationEntry } from "../../server/aggregation-desk.js";
import type { AggregationTitleTranslation } from "../../server/title-translation-types.js";

export function useAggregationTitleTranslations(entries: AggregationEntry[], limit: number) {
  const [records, setRecords] = useState<AggregationTitleTranslation[]>([]), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const signature = JSON.stringify(entries.slice(0, limit).map(entry => [entry.id, entry.title, entry.url]));
  const current = useRef(signature), mounted = useRef(false), running = useRef(false); current.current = signature;
  const cacheVersion = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); let live = true;
    const version = ++cacheVersion.current;
    setMessage(""); setError("");
    if (signature === "[]") return;
    // This GET only reads saved display records. It never invokes a model.
    void api.aggregationTitleTranslations(controller.signal).then(next => {
      if (live && current.current === signature && cacheVersion.current === version) setRecords(next);
    }).catch(error => { if (live && !controller.signal.aborted && cacheVersion.current === version) setError(error instanceof Error ? error.message : "标题缓存暂不可读，可继续阅读原题"); });
    return () => { live = false; controller.abort(); };
  }, [signature]);

  const targets = visibleTranslationTargets(entries, limit, records);
  const translate = async () => {
    if (running.current || !targets.length) return;
    const requested = targets, identity = signature;
    cacheVersion.current++;
    running.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const result = await api.translateAggregationTitles(requested);
      if (!mounted.current || current.current !== identity) return;
      const valid = result.items.filter(record => requested.some(item => item.entryId === record.entryId && item.title === record.originalTitle && item.url === record.url));
      setRecords(previous => [...previous.filter(record => !valid.some(next => next.key === record.key && next.entryId === record.entryId)), ...valid]);
      setMessage(`${valid.length} 条标题已翻译`);
    } catch (error) { if (mounted.current && current.current === identity) setError(error instanceof Error ? error.message : "翻译未完成，可继续阅读原题"); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  };
  return { records, targets, busy, message, error, translate, forEntry: (entry: AggregationEntry) => titleTranslationFor(entry, records) };
}
