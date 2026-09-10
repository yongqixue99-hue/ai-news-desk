import { useEffect, useRef } from "react";

/** Browser Back closes a reader before leaving Today. No article data in history. */
export function useReaderHistory(onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const token = crypto.randomUUID();
    const url = window.location.href;
    const frame = window.requestAnimationFrame(() => window.history.pushState({ ...window.history.state, newsdeskReader: token }, "", url));
    const pop = () => { if (window.history.state?.newsdeskReader !== token) close.current(); };
    window.addEventListener("popstate", pop);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("popstate", pop);
      if (window.history.state?.newsdeskReader === token && window.location.href === url) window.history.back();
    };
  }, []);
}
