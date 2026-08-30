import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalHashForPage,
  createHashPageController,
  pageFromHash,
} from "./navigation";

test("pageFromHash accepts supported direct routes and falls back safely", () => {
  assert.equal(pageFromHash("#drafts"), "drafts");
  assert.equal(pageFromHash("#community"), "community");
  assert.equal(pageFromHash("#editorial-system"), "editorial-system");
  assert.equal(pageFromHash("#ai-settings"), "ai-settings");
  assert.equal(pageFromHash("#today"), "today");
  assert.equal(pageFromHash("#not-a-page"), "today");
  assert.equal(pageFromHash(""), "today");
});

test("canonicalHashForPage returns the URL fragment used by navigation", () => {
  assert.equal(canonicalHashForPage("sources"), "#sources");
});

test("controller canonicalizes the first URL without adding a history entry", () => {
  const historyCalls: Array<["push" | "replace", string]> = [];
  const listeners = new Map<string, () => void>();
  const environment = {
    getHash: () => "",
    pushHash: (hash: string) => historyCalls.push(["push", hash]),
    replaceHash: (hash: string) => historyCalls.push(["replace", hash]),
    listen: (event: "hashchange" | "popstate", callback: () => void) => {
      listeners.set(event, callback);
      return () => listeners.delete(event);
    },
  };

  const controller = createHashPageController(environment, () => undefined);

  assert.equal(controller.getPage(), "today");
  assert.deepEqual(historyCalls, [["replace", "#today"]]);
  controller.dispose();
  assert.equal(listeners.size, 0);
});

test("app navigation pushes once while back and hash changes only update state", () => {
  let hash = "#workbench";
  const historyCalls: Array<["push" | "replace", string]> = [];
  const listeners = new Map<string, () => void>();
  const pages: string[] = [];
  const environment = {
    getHash: () => hash,
    pushHash: (nextHash: string) => {
      hash = nextHash;
      historyCalls.push(["push", nextHash]);
    },
    replaceHash: (nextHash: string) => {
      hash = nextHash;
      historyCalls.push(["replace", nextHash]);
    },
    listen: (event: "hashchange" | "popstate", callback: () => void) => {
      listeners.set(event, callback);
      return () => listeners.delete(event);
    },
  };

  const controller = createHashPageController(environment, (page) => pages.push(page));
  controller.navigate("drafts");
  assert.deepEqual(historyCalls, [["push", "#drafts"]]);
  assert.equal(controller.getPage(), "drafts");

  hash = "#workbench";
  listeners.get("popstate")?.();
  listeners.get("hashchange")?.();
  assert.equal(controller.getPage(), "workbench");
  assert.deepEqual(historyCalls, [["push", "#drafts"]]);
  assert.deepEqual(pages, ["drafts", "workbench"]);

  controller.dispose();
});

test("an invalid externally supplied hash is replaced, never pushed", () => {
  let hash = "#workbench";
  const historyCalls: Array<["push" | "replace", string]> = [];
  const listeners = new Map<string, () => void>();
  const environment = {
    getHash: () => hash,
    pushHash: (nextHash: string) => historyCalls.push(["push", nextHash]),
    replaceHash: (nextHash: string) => {
      hash = nextHash;
      historyCalls.push(["replace", nextHash]);
    },
    listen: (event: "hashchange" | "popstate", callback: () => void) => {
      listeners.set(event, callback);
      return () => listeners.delete(event);
    },
  };

  const controller = createHashPageController(environment, () => undefined);
  hash = "#unknown";
  listeners.get("hashchange")?.();

  assert.equal(controller.getPage(), "today");
  assert.deepEqual(historyCalls, [["replace", "#today"]]);
  controller.dispose();
});
