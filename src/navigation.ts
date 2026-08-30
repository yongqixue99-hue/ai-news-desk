import type { AppPage } from "./types";

const APP_PAGES = new Set<AppPage>([
  "today",
  "workbench",
  "community",
  "drafts",
  "sources",
  "editorial-system",
  "schedule",
  "runs",
  "ai-settings",
]);

export const canonicalHashForPage = (page: AppPage) => `#${page}`;

export const pageFromHash = (hash: string): AppPage => {
  const candidate = hash.replace(/^#/, "") as AppPage;
  return APP_PAGES.has(candidate) ? candidate : "today";
};

export interface HashPageEnvironment {
  getHash: () => string;
  pushHash: (hash: string) => void;
  replaceHash: (hash: string) => void;
  listen: (event: "hashchange" | "popstate", callback: () => void) => () => void;
}

export interface HashPageController {
  getPage: () => AppPage;
  navigate: (page: AppPage) => void;
  dispose: () => void;
}

export const createHashPageController = (
  environment: HashPageEnvironment,
  onPageChange: (page: AppPage) => void,
): HashPageController => {
  const initialHash = environment.getHash();
  let page = pageFromHash(initialHash);
  const initialCanonicalHash = canonicalHashForPage(page);

  if (initialHash !== initialCanonicalHash) {
    environment.replaceHash(initialCanonicalHash);
  }

  const readLocation = () => {
    const currentHash = environment.getHash();
    const nextPage = pageFromHash(currentHash);
    const canonicalHash = canonicalHashForPage(nextPage);

    if (currentHash !== canonicalHash) {
      environment.replaceHash(canonicalHash);
    }
    if (nextPage === page) return;

    page = nextPage;
    onPageChange(nextPage);
  };

  const removeHashChange = environment.listen("hashchange", readLocation);
  const removePopState = environment.listen("popstate", readLocation);

  return {
    getPage: () => page,
    navigate: (nextPage) => {
      const nextHash = canonicalHashForPage(nextPage);
      if (nextHash !== environment.getHash()) {
        environment.pushHash(nextHash);
      }
      if (nextPage === page) return;

      page = nextPage;
      onPageChange(nextPage);
    },
    dispose: () => {
      removeHashChange();
      removePopState();
    },
  };
};
