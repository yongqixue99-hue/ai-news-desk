import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { CompletionAvailability } from "../../server/editorial-controls.js";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { sourceTableExtensions } from "../tiptap-source-table";
import {
  AlignCenter,
  Bold,
  ImageUp,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  LoaderCircle,
  MessageSquareText,
  Quote,
  Redo2,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import type { DraftImagePlacement, DraftLayoutTheme } from "../types";
import {
  beginInlineCompletion,
  createInlineCompletionState,
  invalidateInlineCompletion,
  resolveInlineCompletion,
} from "../inline-completion-state";
import {
  inlineCompletionIdleDelay,
  inlineCompletionRetryDelay,
} from "../inline-completion-policy";
import {
  clearInlineCompletion,
  currentInlineCompletion,
  InlineCompletionExtension,
  showInlineCompletion,
} from "../tiptap-inline-completion";

export interface RichArticleEditorHandle {
  insertImage: (placement: DraftImagePlacement) => void;
  focus: () => void;
}

interface RichArticleEditorProps {
  completion?: CompletionAvailability;
  completionEnabled?: boolean;
  onToggleCompletion?: (enabled: boolean) => Promise<void>;
  draftId?: string;
  title: string;
  content: string;
  preview: boolean;
  theme: DraftLayoutTheme;
  onChange: (html: string) => void;
  onUploadFile: (file: File) => Promise<DraftImagePlacement>;
  onImportUrl: (url: string, caption?: string) => Promise<DraftImagePlacement>;
  onRequestCompletion?: (
    input: { before: string; after: string },
    signal: AbortSignal,
    onPreview?: (preview: Pick<InlineCompletionResponse, "text" | "providerName" | "model">) => void,
  ) => Promise<InlineCompletionResponse>;
}

interface InlineCompletionResponse {
  available: boolean;
  text?: string;
  reason?: string;
  providerName?: string;
  model?: string;
}

type CompletionUi =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "streaming"; preview: string; providerName?: string }
  | { status: "visible"; paragraphs: number; providerName?: string }
  | { status: "unavailable"; message: string };

const NewsImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      mediaId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-media-id"),
        renderHTML: (attributes) => attributes.mediaId ? { "data-media-id": attributes.mediaId } : {},
      },
      caption: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-caption"),
        renderHTML: (attributes) => attributes.caption ? { "data-caption": attributes.caption } : {},
      },
      attribution: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-attribution"),
        renderHTML: (attributes) => attributes.attribution
          ? { "data-attribution": attributes.attribution }
          : {},
      },
      align: {
        default: "center",
        parseHTML: (element) => element.getAttribute("data-align") || "center",
        renderHTML: (attributes) => ({ "data-align": attributes.align || "center" }),
      },
    };
  },
});

const sourceFor = (placement: DraftImagePlacement) =>
  placement.image.publicPath || placement.image.url;

const visibleAttributionFor = (placement: DraftImagePlacement) => {
  const details = [placement.image.attribution || "来源待补充"];
  if (placement.image.rights === "licensed") {
    details.push(`许可：${placement.image.licenseId || placement.image.licenseUrl || "待补充"}`);
    details.push(`修改：${placement.image.modificationNote || "待补充"}`);
  }
  return details.join("；");
};

export const RichArticleEditor = forwardRef<RichArticleEditorHandle, RichArticleEditorProps>(
  function RichArticleEditor(
    { draftId, title, content, preview, theme, onChange, onUploadFile, onImportUrl, onRequestCompletion, completion, completionEnabled = true, onToggleCompletion },
    ref,
  ) {
    const fileInput = useRef<HTMLInputElement>(null);
    const replaceFileInput = useRef<HTMLInputElement>(null);
    const updatesEnabled = useRef(false);
    const [imageMenuOpen, setImageMenuOpen] = useState(false);
    const [imageUrl, setImageUrl] = useState("");
    const [imageCaption, setImageCaption] = useState("");
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState("");
    const [completionUi, setCompletionUi] = useState<CompletionUi>({ status: "idle" });
    const completionState = useRef(createInlineCompletionState());
    const completionTimer = useRef<number | undefined>(undefined);
    const completionAbort = useRef<AbortController | undefined>(undefined);
    const completionRequest = useRef(onRequestCompletion);
    const completionCache = useRef(new Map<string, InlineCompletionResponse>());
    const completionDraftId = useRef(draftId);
    const completionDisabledReason = useRef<string | undefined>(undefined);
    const completionRetryAt = useRef(0);
    const completionProviderName = useRef<string | undefined>(undefined);
    const completionCanRun = useRef(true);
    const dismissedContext = useRef<string | undefined>(undefined);
    const liveEditor = useRef<Editor | null>(null);
    completionCanRun.current = !preview && completionEnabled && completion?.ready !== false;
    completionRequest.current = onRequestCompletion;
    completionDraftId.current = draftId;

    const clearCompletionRuntime = (currentEditor?: Editor, updateUi = true) => {
      if (completionTimer.current !== undefined) window.clearTimeout(completionTimer.current);
      completionTimer.current = undefined;
      completionAbort.current?.abort();
      completionAbort.current = undefined;
      completionState.current = invalidateInlineCompletion(completionState.current);
      completionProviderName.current = undefined;
      if (currentEditor && !currentEditor.isDestroyed) clearInlineCompletion(currentEditor);
      if (updateUi) setCompletionUi({ status: "idle" });
    };

    const completionContextFor = (currentEditor: Editor) => {
      const { selection, doc } = currentEditor.state;
      if (!selection.empty) return undefined;
      const parentName = selection.$from.parent.type.name;
      if (parentName !== "paragraph" || selection.$from.node(-1)?.type.name === "blockquote") return undefined;
      if (selection.$from.parentOffset !== selection.$from.parent.content.size) return undefined;
      const before = doc.textBetween(0, selection.from, "\n", "\n").slice(-1_600);
      if (before.trim().length < 4) return undefined;
      const after = doc.textBetween(selection.from, doc.content.size, "\n", "\n").slice(0, 500);
      return {
        position: selection.from,
        before,
        after,
        key: `${completionDraftId.current ?? "draft"}:${selection.from}:${before}:${after}`,
      };
    };

    const syncForwardStableCompletion = (currentEditor: Editor) => {
      const ghost = currentInlineCompletion(currentEditor);
      const context = completionContextFor(currentEditor);
      if (!ghost || !context || ghost.position !== context.position || !ghost.text.trim()) return false;
      completionState.current = {
        status: "visible",
        token: completionState.current.token,
        contextKey: context.key,
        text: ghost.text,
      };
      setCompletionUi({
        status: "visible",
        paragraphs: ghost.text.split(/\r?\n\s*\r?\n+/u).length,
        providerName: completionProviderName.current,
      });
      return true;
    };

    const scheduleCompletion = (currentEditor: Editor, manual = false) => {
      if (!completionCanRun.current) { clearCompletionRuntime(currentEditor); return; }
      if (syncForwardStableCompletion(currentEditor)) return;
      clearCompletionRuntime(currentEditor);
      const requestCompletion = completionRequest.current;
      if (
        !requestCompletion
        || !currentEditor.isFocused
        || currentEditor.view.composing
        || completionDisabledReason.current
        || Date.now() < completionRetryAt.current
      ) return;
      const scheduledContext = completionContextFor(currentEditor);
      if (!scheduledContext || (!manual && dismissedContext.current === scheduledContext.key)) return;
      if (manual) { dismissedContext.current = undefined; completionCache.current.delete(scheduledContext.key); }
      completionTimer.current = window.setTimeout(() => {
        completionTimer.current = undefined;
        const latestContext = completionContextFor(currentEditor);
        if (!completionCanRun.current || currentEditor.isDestroyed || currentEditor.view.composing || !latestContext || latestContext.key !== scheduledContext.key || !currentEditor.isFocused) return;
        const started = beginInlineCompletion(completionState.current, latestContext.key);
        completionState.current = started.state;
        const cached = completionCache.current.get(latestContext.key);
        if (cached && !cached.available) { setCompletionUi({ status: "unavailable", message: cached.reason || "当前没有合适的续写" }); return; }
        if (cached?.available && cached.text) {
          const resolved = resolveInlineCompletion(completionState.current, {
            token: started.token,
            contextKey: latestContext.key,
            text: cached.text,
          });
          completionState.current = resolved;
          if (resolved.status === "visible" && resolved.text) {
            completionProviderName.current = cached.providerName;
            showInlineCompletion(currentEditor, { position: latestContext.position, text: resolved.text });
            setCompletionUi({
              status: "visible",
              paragraphs: resolved.text.split(/\r?\n\s*\r?\n+/u).length,
              providerName: cached.providerName,
            });
          }
          return;
        }
        const controller = new AbortController();
        completionAbort.current = controller;
        setCompletionUi({ status: "loading" });
        void requestCompletion(
          { before: latestContext.before, after: latestContext.after },
          controller.signal,
          (previewResult) => {
            if (controller.signal.aborted || currentEditor.isDestroyed || !previewResult.text?.trim()) return;
            const currentContext = completionContextFor(currentEditor);
            if (currentContext?.key !== latestContext.key || currentContext.position !== latestContext.position) return;
            if (completionState.current.token !== started.token) return;
            setCompletionUi({
              status: "streaming",
              preview: previewResult.text.trim(),
              providerName: previewResult.providerName,
            });
          },
        ).then((result) => {
          if (controller.signal.aborted || currentEditor.isDestroyed) return;
          completionRetryAt.current = 0;
          const currentContext = completionContextFor(currentEditor);
          const resolved = resolveInlineCompletion(completionState.current, {
            token: started.token,
            contextKey: latestContext.key,
            text: result.available ? result.text : undefined,
          });
          completionState.current = resolved;
          if (result.available && result.text || !result.available) {
            completionCache.current.delete(latestContext.key);
            completionCache.current.set(latestContext.key, result);
            while (completionCache.current.size > 24) {
              const oldest = completionCache.current.keys().next().value;
              if (typeof oldest !== "string") break;
              completionCache.current.delete(oldest);
            }
          }
          if (
            resolved.status === "visible"
            && resolved.text
            && currentContext?.key === latestContext.key
            && currentContext.position === latestContext.position
          ) {
            completionProviderName.current = result.providerName;
            showInlineCompletion(currentEditor, {
              position: latestContext.position,
              text: resolved.text,
            });
            setCompletionUi({
              status: "visible",
              paragraphs: resolved.text.split(/\r?\n\s*\r?\n+/u).length,
              providerName: result.providerName,
            });
            return;
          }
          if (!result.available && result.reason) {
            if (/AI 设置.*(?:配置|选择).*(?:API Key|补全模型)/u.test(result.reason)) completionDisabledReason.current = result.reason;
            setCompletionUi({ status: "unavailable", message: result.reason });
          } else {
            setCompletionUi({ status: "idle" });
          }
        }).catch((error: unknown) => {
          if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) return;
          completionState.current = invalidateInlineCompletion(completionState.current);
          const retryDelay = inlineCompletionRetryDelay(error);
          completionRetryAt.current = Date.now() + retryDelay;
          setCompletionUi({
            status: "unavailable",
            message: `补全暂不可用，${Math.ceil(retryDelay / 1_000)} 秒后继续输入可重试`,
          });
        }).finally(() => {
          if (completionAbort.current === controller) completionAbort.current = undefined;
        });
      }, manual ? 0 : inlineCompletionIdleDelay(scheduledContext.before));
    };

    const editor = useEditor({
      extensions: [
        ...sourceTableExtensions,
        StarterKit.configure({
          heading: { levels: [2, 3] },
          link: { openOnClick: false, autolink: true, linkOnPaste: true },
        }),
        NewsImage.configure({ allowBase64: false, inline: false }),
        Placeholder.configure({ placeholder: "从这里开始自由编辑正文……" }),
        InlineCompletionExtension.configure({
          onAccept: (_acceptedText, remainingText) => {
            if (remainingText) {
              completionState.current = {
                ...completionState.current,
                status: "visible",
                text: remainingText,
              };
              setCompletionUi({
                status: "visible",
                paragraphs: remainingText.split(/\r?\n\s*\r?\n+/u).length,
                providerName: completionProviderName.current,
              });
              return;
            }
            if (completionTimer.current !== undefined) window.clearTimeout(completionTimer.current);
            completionTimer.current = undefined;
            completionAbort.current?.abort();
            completionAbort.current = undefined;
            completionState.current = invalidateInlineCompletion(completionState.current);
            setCompletionUi({ status: "idle" });
          },
          onDismiss: () => {
            dismissedContext.current = completionState.current.contextKey;
            completionState.current = invalidateInlineCompletion(completionState.current);
            setCompletionUi({ status: "idle" });
          },
        }),
      ],
      content,
      editorProps: {
        handleDOMEvents: {
          compositionstart: () => {
            if (liveEditor.current) clearCompletionRuntime(liveEditor.current);
            return false;
          },
          compositionend: () => { window.setTimeout(() => { const current = liveEditor.current; if (current && !current.isDestroyed) scheduleCompletion(current); }, 0); return false; },
        },
        attributes: {
          class: "continuous-prose",
          "aria-label": "连续文章编辑器",
        },
      },
      onUpdate: ({ editor: current }) => {
        if (updatesEnabled.current) onChange(current.getHTML());
        scheduleCompletion(current);
      },
      onSelectionUpdate: ({ editor: current }) => scheduleCompletion(current),
      onFocus: ({ editor: current }) => scheduleCompletion(current),
      onBlur: ({ editor: current }) => clearCompletionRuntime(current),
    });
    liveEditor.current = editor;

    useEffect(() => {
      completionDisabledReason.current = undefined;
      completionRetryAt.current = 0;
      completionCache.current.clear();
      if (editor && !editor.isDestroyed) clearCompletionRuntime(editor);
      dismissedContext.current = undefined;
    }, [draftId, editor, completionEnabled, completion?.ready, completion?.providerName, completion?.model]);

    useEffect(() => () => {
      if (completionTimer.current !== undefined) window.clearTimeout(completionTimer.current);
      completionAbort.current?.abort();
      completionState.current = invalidateInlineCompletion(completionState.current);
    }, []);

    useEffect(() => {
      const frame = window.requestAnimationFrame(() => {
        updatesEnabled.current = true;
      });
      return () => window.cancelAnimationFrame(frame);
    }, []);

    useEffect(() => {
      if (!editor || editor.isDestroyed) return;
      editor.setEditable(!preview);
      if (preview) clearCompletionRuntime(editor);
    }, [editor, preview]);

    useEffect(() => {
      if (!editor || editor.isDestroyed || editor.getHTML() === content) return;
      clearCompletionRuntime(editor);
      editor.commands.setContent(content, { emitUpdate: false });
    }, [content, editor]);

    const insertPlacement = (placement: DraftImagePlacement) => {
      if (!editor) return;
      const caption = placement.caption || placement.image.caption || "配图";
      const attribution = visibleAttributionFor(placement);
      const imageAttributes = {
        src: sourceFor(placement),
        alt: caption,
        title: caption,
        mediaId: placement.id,
        caption,
        attribution,
      };
      const inserted = editor.chain().focus().setImage(imageAttributes).run();
      if (inserted) {
        const afterImage = editor.state.selection.to;
        editor.chain().focus().setTextSelection(afterImage).insertContent([
          {
            type: "paragraph",
            content: [{ type: "text", text: `图：${caption}（来源：${attribution}）` }],
          },
          { type: "paragraph" },
        ]).run();
      }
      setImageMenuOpen(false);
    };

    useImperativeHandle(ref, () => ({
      insertImage: insertPlacement,
      focus: () => editor?.chain().focus().run(),
    }));

    const uploadFile = async (file: File) => {
      if (!file.type.startsWith("image/")) return;
      setUploadError("");
      setUploading(true);
      try {
        insertPlacement(await onUploadFile(file));
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : String(error));
      } finally {
        setUploading(false);
        if (fileInput.current) fileInput.current.value = "";
      }
    };

    const importUrl = async () => {
      const nextUrl = imageUrl.trim();
      if (!nextUrl) return;
      setUploadError("");
      setUploading(true);
      try {
        insertPlacement(await onImportUrl(nextUrl, imageCaption.trim() || undefined));
        setImageUrl("");
        setImageCaption("");
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : String(error));
      } finally {
        setUploading(false);
      }
    };

    const replaceSelectedImage = async (file: File) => {
      if (!editor || !file.type.startsWith("image/")) return;
      setUploadError("");
      setUploading(true);
      try {
        const placement = await onUploadFile(file);
        const caption = placement.caption || placement.image.caption || "配图";
        editor.chain().focus().updateAttributes("image", {
          src: sourceFor(placement),
          alt: caption,
          title: caption,
          mediaId: placement.id,
          caption,
          attribution: visibleAttributionFor(placement),
        }).run();
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : String(error));
      } finally {
        setUploading(false);
        if (replaceFileInput.current) replaceFileInput.current.value = "";
      }
    };

    const editSelectedCaption = () => {
      if (!editor) return;
      const attributes = editor.getAttributes("image");
      const caption = window.prompt("图片说明", attributes.caption || attributes.alt || "");
      if (caption === null || !caption.trim()) return;
      const nextCaption = caption.trim();
      const selectionPosition = editor.state.selection.from;
      const imageNode = editor.state.doc.nodeAt(selectionPosition);
      const nextPosition = selectionPosition + (imageNode?.nodeSize ?? 1);
      const nextNode = editor.state.doc.nodeAt(nextPosition);
      const attribution = attributes.attribution || "来源待补充";
      editor.chain().focus().updateAttributes("image", {
        caption: nextCaption,
        alt: nextCaption,
        title: nextCaption,
      }).run();
      if (nextNode?.type.name === "paragraph" && nextNode.textContent.startsWith("图：")) {
        editor.commands.command(({ state, tr }) => {
          const replacement = state.schema.nodes.paragraph.create(
            null,
            state.schema.text(`图：${nextCaption}（来源：${attribution}）`),
          );
          tr.replaceWith(nextPosition, nextPosition + nextNode.nodeSize, replacement);
          return true;
        });
      }
    };

    const cycleSelectedImageAlignment = () => {
      if (!editor) return;
      const current = editor.getAttributes("image").align || "center";
      const next = current === "center" ? "left" : current === "left" ? "right" : "center";
      editor.chain().focus().updateAttributes("image", { align: next }).run();
    };

    const addLink = () => {
      if (!editor) return;
      const previous = editor.getAttributes("link").href as string | undefined;
      const href = window.prompt("输入链接地址；留空可移除链接", previous || "https://");
      if (href === null) return;
      if (!href.trim()) editor.chain().focus().extendMarkRange("link").unsetLink().run();
      else editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
    };

    const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
      if (preview) return;
      const image = [...event.clipboardData.files].find((file) => file.type.startsWith("image/"));
      if (!image) return;
      event.preventDefault();
      void uploadFile(image);
    };

    const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
      if (preview) return;
      const image = [...event.dataTransfer.files].find((file) => file.type.startsWith("image/"));
      if (!image || !editor) return;
      event.preventDefault();
      const position = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
      if (position !== undefined) editor.commands.setTextSelection(position);
      void uploadFile(image);
    };

    if (!editor) return <div className="rich-editor-loading">正在加载编辑器……</div>;

    return (
      <div className={`rich-article-editor layout-${theme} ${preview ? "is-preview" : "is-editing"}`}>
        {!preview ? (
          <div className="rich-toolbar" aria-label="富文本编辑工具栏">
            <button title="撤销" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}><Undo2 size={16} /></button>
            <button title="重做" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}><Redo2 size={16} /></button>
            <span className="toolbar-divider" />
            <select
              aria-label="段落格式"
              value={editor.isActive("codeBlock") ? "code" : editor.isActive("heading", { level: 2 }) ? "h2" : editor.isActive("heading", { level: 3 }) ? "h3" : "p"}
              onChange={(event) => {
                if (event.target.value === "h2") editor.chain().focus().toggleHeading({ level: 2 }).run();
                else if (event.target.value === "h3") editor.chain().focus().toggleHeading({ level: 3 }).run();
                else if (event.target.value === "code") editor.chain().focus().setCodeBlock().run();
                else editor.chain().focus().setParagraph().run();
              }}
            >
              <option value="p">正文</option>
              <option value="h2">二级标题</option>
              <option value="h3">三级标题</option>
              <option value="code">代码块</option>
            </select>
            <button className={editor.isActive("bold") ? "active" : ""} title="加粗" onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={16} /></button>
            <button className={editor.isActive("italic") ? "active" : ""} title="斜体" onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={16} /></button>
            <button className={editor.isActive("blockquote") ? "active" : ""} title="引用" onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={16} /></button>
            <button className={editor.isActive("bulletList") ? "active" : ""} title="无序列表" onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={16} /></button>
            <button className={editor.isActive("orderedList") ? "active" : ""} title="有序列表" onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={16} /></button>
            <button className={editor.isActive("link") ? "active" : ""} title="添加链接" onClick={addLink}><Link2 size={16} /></button>
            <span className="toolbar-divider" />
            <div className="image-menu-wrap">
              <button
                className={imageMenuOpen ? "active" : ""}
                title="在光标处插入图片"
                aria-expanded={imageMenuOpen}
                onClick={() => setImageMenuOpen((open) => !open)}
              >
                {uploading ? <LoaderCircle className="spin" size={16} /> : <ImagePlus size={16} />}
              </button>
              {imageMenuOpen ? (
                <div className="image-insert-menu">
                  <div className="image-menu-head"><strong>插入到当前光标</strong><button aria-label="关闭图片面板" onClick={() => setImageMenuOpen(false)}><X size={15} /></button></div>
                  <button className="upload-image-button" onClick={() => fileInput.current?.click()} disabled={uploading}>
                    <Upload size={16} />选择本地图片
                  </button>
                  <span className="image-menu-hint">也可以直接粘贴截图，或把图片拖进正文。</span>
                  <div className="image-url-fields">
                    <input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="图片 URL" />
                    <input value={imageCaption} onChange={(event) => setImageCaption(event.target.value)} placeholder="图片说明（可选）" />
                    <button onClick={importUrl} disabled={!imageUrl.trim() || uploading}>下载并插入</button>
                  </div>
                  {uploadError ? <p className="image-upload-error">{uploadError}</p> : null}
                </div>
              ) : null}
            </div>
            <button
              title="删除选中图片"
              onClick={() => editor.chain().focus().deleteSelection().run()}
              disabled={!editor.isActive("image")}
            >
              <Trash2 size={16} />
            </button>
            <input
              ref={fileInput}
              hidden
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={(event) => event.target.files?.[0] && void uploadFile(event.target.files[0])}
            />
            {onRequestCompletion ? <div className="completion-control">
              {onToggleCompletion ? <button type="button" className="completion-toggle" aria-label="Tab 续写开关" aria-pressed={completionEnabled} title={completion?.reason || "开启或关闭自动补全"} onClick={() => void onToggleCompletion(!completionEnabled)}>Tab 续写 · {completionEnabled ? "开" : "关"}</button> : null}
              <button type="button" className="completion-manual" disabled={!completionCanRun.current} title="在当前段末请求一次续写" onMouseDown={(event) => event.preventDefault()} onClick={() => { editor.commands.focus(); scheduleCompletion(editor, true); }}>续写一次</button>
            </div> : null}
          </div>
        ) : null}
        <div className="rich-editor-canvas" onPaste={handlePaste} onDrop={handleDrop} onDragOver={(event) => !preview && event.preventDefault()}>
          {!preview ? (
            <BubbleMenu
              editor={editor}
              shouldShow={({ editor: current }) => current.isActive("image")}
              options={{ placement: "bottom", offset: 10 }}
              className="image-context-menu"
            >
              <button onClick={() => replaceFileInput.current?.click()} disabled={uploading}><ImageUp size={15} />替换</button>
              <button onClick={editSelectedCaption}><MessageSquareText size={15} />图注</button>
              <button onClick={cycleSelectedImageAlignment}><AlignCenter size={15} />对齐</button>
              <button onClick={() => editor.chain().focus().deleteSelection().run()}><Trash2 size={15} />删除</button>
              <input
                ref={replaceFileInput}
                hidden
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={(event) => event.target.files?.[0] && void replaceSelectedImage(event.target.files[0])}
              />
            </BubbleMenu>
          ) : null}
          {preview ? <h1 className="preview-article-title">{title}</h1> : null}
          <EditorContent editor={editor} />
          {!preview && onRequestCompletion ? (
            <div className={`inline-completion-status is-${completionUi.status}`} role="status" aria-live="polite">
              {!completionEnabled ? "Tab 续写已关闭" : completion?.ready === false ? completion.reason : <>
              {completionUi.status === "loading" ? <><LoaderCircle className="spin" size={12} />正在补全</> : null}
              {completionUi.status === "streaming" ? <><LoaderCircle className="spin" size={12} />正在生成 <span className="inline-completion-stream-preview">{completionUi.preview}</span>{completionUi.providerName ? ` · ${completionUi.providerName}` : ""}</> : null}
              {completionUi.status === "visible" ? <><kbd>Tab</kbd> {completionUi.paragraphs > 1 ? "接受下一段" : "接受"}{completionUi.paragraphs > 1 ? <><span>·</span><kbd>Ctrl+Enter</kbd> 接受全部</> : null}{completionUi.providerName ? ` · ${completionUi.providerName}` : ""} <span>·</span> <kbd>Esc</kbd> 取消</> : null}
              {completionUi.status === "unavailable" ? completionUi.message : null}
              {completionUi.status === "idle" ? <>停顿后预测下一句或下一段，按 <kbd>Tab</kbd> 接受</> : null}
              </>}
            </div>
          ) : null}
          {!preview ? <span className="editor-drop-hint">连续编辑 · 支持粘贴、拖放和光标插图</span> : null}
        </div>
      </div>
    );
  },
);
