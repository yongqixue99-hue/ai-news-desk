import { useCallback, useEffect, useRef, useState } from "react";
import type { AppPage } from "../types";
import {
  canonicalHashForPage,
  createHashPageController,
  pageFromHash,
  type HashPageController,
  type HashPageEnvironment,
} from "../navigation";

const browserEnvironment: HashPageEnvironment = {
  getHash: () => window.location.hash,
  pushHash: (hash) => window.history.pushState(null, "", hash),
  replaceHash: (hash) => window.history.replaceState(null, "", hash),
  listen: (event, callback) => {
    window.addEventListener(event, callback);
    return () => window.removeEventListener(event, callback);
  },
};

export const useHashPageNavigation = () => {
  const [page, setPage] = useState<AppPage>(() => pageFromHash(window.location.hash));
  const controllerRef = useRef<HashPageController | null>(null);

  useEffect(() => {
    const controller = createHashPageController(browserEnvironment, setPage);
    controllerRef.current = controller;
    setPage(controller.getPage());

    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  const navigate = useCallback((nextPage: AppPage) => {
    const controller = controllerRef.current;
    if (controller) {
      controller.navigate(nextPage);
      return;
    }

    const nextHash = canonicalHashForPage(nextPage);
    if (window.location.hash !== nextHash) {
      window.history.pushState(null, "", nextHash);
    }
    setPage(nextPage);
  }, []);

  return { page, navigate };
};

