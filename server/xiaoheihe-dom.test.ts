import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { load } from "cheerio";

class FixtureElement {
  readonly nodeType = 1;
  readonly shadowRoot = undefined;
  readonly ownerDocument: FixtureDocument;

  constructor(
    readonly raw: ReturnType<ReturnType<typeof load>>,
    ownerDocument: FixtureDocument,
  ) {
    this.ownerDocument = ownerDocument;
  }

  get parentElement() {
    const parent = this.raw.parent();
    return parent.length ? this.ownerDocument.wrap(parent.first()) : null;
  }

  get textContent() {
    return this.raw.text();
  }

  get innerText() {
    return this.raw.text();
  }

  querySelectorAll(selector: string) {
    return this.raw.find(selector).toArray().map((node) => this.ownerDocument.wrap(this.ownerDocument.$(node)));
  }

  getBoundingClientRect() {
    return { width: 600, height: this.raw.hasClass("article__edit-content--inner") ? 440 : 25 };
  }

  getAttribute(name: string) {
    return this.raw.attr(name) ?? null;
  }

  querySelector(selector: string) {
    const match = this.raw.find(selector).first();
    return match.length ? this.ownerDocument.wrap(match) : null;
  }

  get src() {
    return this.raw.attr("src") ?? "";
  }

  get currentSrc() {
    return this.src;
  }
}

class FixtureDocument {
  private cache = new WeakMap<object, FixtureElement>();

  constructor(readonly $: ReturnType<typeof load>) {}

  wrap(raw: ReturnType<ReturnType<typeof load>>) {
    const node = raw.get(0) as object;
    const cached = this.cache.get(node);
    if (cached) return cached;
    const element = new FixtureElement(raw, this);
    this.cache.set(node, element);
    return element;
  }

  querySelectorAll(selector: string) {
    return this.$(selector).toArray().map((node) => this.wrap(this.$(node)));
  }
}

const loadAdapter = async () => {
  const source = await readFile(
    path.resolve("chrome-extension/xiaoheihe-dom.js"),
    "utf8",
  );
  const context = {
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
  } as Record<string, unknown>;
  context.globalThis = context;
  vm.runInNewContext(source, context);
  return context.XiaoheiheDom as {
    findEditor: (document: FixtureDocument) => {
      title?: FixtureElement;
      body?: FixtureElement;
    };
    findImageMarkers: (document: FixtureDocument, ids: string[]) => Array<{
      id: string;
      element: FixtureElement;
    }>;
    findImageDescriptionEditor: (imageBox: FixtureElement) => FixtureElement | undefined;
    captureInsertedImageBox: (
      document: FixtureDocument,
      beforeSources: Set<string>,
      beforeBoxes: Set<FixtureElement>,
    ) => { box: FixtureElement; source: string } | undefined;
    findImageBoxBySource: (document: FixtureDocument, source: string) => FixtureElement | undefined;
    findCommunityOption: (document: FixtureDocument, text: string) => FixtureElement | undefined;
    findSelectedCommunity: (document: FixtureDocument, text: string) => FixtureElement | undefined;
    findSelectedTopic: (document: FixtureDocument, text: string) => FixtureElement | undefined;
    findTopicOption: (document: FixtureDocument, text: string) => FixtureElement | undefined;
  };
};

test("recognizes Xiaoheihe's current two-ProseMirror article editor", async () => {
  const $ = load(`
    <main>
      <div class="hb-cpt__editor-title editor-article__title">
        <div class="editor-title__placeholder">填写标题</div>
        <div class="editor-title__container">
          <div contenteditable="true" class="ProseMirror hb-editor"><p><br></p></div>
        </div>
      </div>
      <div class="article__edit-content">
        <div class="article__edit-content--placeholder">正文文案</div>
        <div class="article__edit-content--inner">
          <div contenteditable="true" class="ProseMirror hb-editor"><p><br></p></div>
        </div>
      </div>
    </main>
  `);
  const document = new FixtureDocument($);
  const adapter = await loadAdapter();
  const result = adapter.findEditor(document);

  assert.match(result.title?.parentElement?.raw.attr("class") ?? "", /editor-title__container/);
  assert.match(result.body?.parentElement?.raw.attr("class") ?? "", /article__edit-content--inner/);
  assert.notEqual(result.title, result.body);
});

test("keeps compatibility with the legacy input title editor", async () => {
  const $ = load(`
    <input placeholder="填写标题" value="">
    <div class="ProseMirror" contenteditable="true"><p><br></p></div>
  `);
  const document = new FixtureDocument($);
  const adapter = await loadAdapter();
  const result = adapter.findEditor(document);

  assert.equal(result.title?.raw.is("input"), true);
  assert.equal(result.body?.raw.hasClass("ProseMirror"), true);
});

test("recovers image positions after ProseMirror strips custom attributes", async () => {
  const $ = load(`
    <div class="article__edit-content--inner">
      <div class="ProseMirror" contenteditable="true">
        <p>前文</p>
        <p>【待上传配图：架构图｜定位码 AIIMG:placement_one】</p>
        <p>后文</p>
      </div>
    </div>
  `);
  const document = new FixtureDocument($);
  const adapter = await loadAdapter();
  const markers = adapter.findImageMarkers(document, ["placement_one"]);

  assert.equal(markers.length, 1);
  assert.equal(markers[0]?.id, "placement_one");
  assert.match(markers[0]?.element.textContent ?? "", /架构图/);
});

test("finds Xiaoheihe's native image description editor", async () => {
  const $ = load(`
    <div class="article__image-box">
      <img src="https://example.com/image.png">
      <input placeholder="请输入图片描述" value="">
    </div>
  `);
  const document = new FixtureDocument($);
  const adapter = await loadAdapter();
  const imageBox = document.querySelectorAll(".article__image-box")[0];
  const editor = adapter.findImageDescriptionEditor(imageBox);

  assert.equal(editor?.raw.is("input"), true);
  assert.equal(editor?.getAttribute("placeholder"), "请输入图片描述");
});

test("keeps an uploaded image bound to its source after boxes redraw in article order", async () => {
  const firstUpload = load(`
    <div class="article__image-box" data-id="third">
      <img src="https://img.example.com/third.png">
      <input placeholder="请输入图片描述">
    </div>
  `);
  const firstDocument = new FixtureDocument(firstUpload);
  const adapter = await loadAdapter();
  const captured = adapter.captureInsertedImageBox(firstDocument, new Set(), new Set());

  assert.equal(captured?.source, "https://img.example.com/third.png");

  // Xiaoheihe later redraws all boxes in body order. A dynamic "first new
  // source" lookup would now return the first image and attach the third
  // image's caption to it.
  const redrawn = load(`
    <div class="article__image-box" data-id="first"><img src="https://img.example.com/first.png"></div>
    <div class="article__image-box" data-id="second"><img src="https://img.example.com/second.png"></div>
    <div class="article__image-box" data-id="third"><img src="https://img.example.com/third.png"></div>
  `);
  const redrawnDocument = new FixtureDocument(redrawn);
  const resolved = adapter.findImageBoxBySource(redrawnDocument, captured?.source ?? "");

  assert.equal(resolved?.getAttribute("data-id"), "third");
});

test("keeps selected chips separate from similarly named modal options", async () => {
  const $ = load(`
    <div class="editor__topic-item"><div class="topic-item__text">盒友杂谈</div></div>
    <div class="editor-model__topic-list-item">
      <div class="topic-list-item__title">盒友杂谈</div>
      <div class="topic-list-item__desc">热度：94669771</div>
    </div>
    <div class="editor__hashtag-item"><div class="hashtag-item__text">openai</div></div>
    <div class="editor-model__hashtag-list-item">
      <div class="hashtag-list-item__title">openai</div>
    </div>
  `);
  const document = new FixtureDocument($);
  const adapter = await loadAdapter();

  assert.match(adapter.findSelectedCommunity(document, "盒友杂谈")?.raw.attr("class") ?? "", /editor__topic-item/);
  assert.match(adapter.findCommunityOption(document, "盒友杂谈")?.raw.attr("class") ?? "", /editor-model__topic-list-item/);
  assert.match(adapter.findSelectedTopic(document, "openai")?.raw.attr("class") ?? "", /editor__hashtag-item/);
  assert.match(adapter.findTopicOption(document, "openai")?.raw.attr("class") ?? "", /editor-model__hashtag-list-item/);
});
