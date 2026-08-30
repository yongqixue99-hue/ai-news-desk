import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
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

export interface RichArticleEditorHandle {
  insertImage: (placement: DraftImagePlacement) => void;
  focus: () => void;
}

interface RichArticleEditorProps {
  title: string;
  content: string;
  preview: boolean;
  theme: DraftLayoutTheme;
  onChange: (html: string) => void;
  onUploadFile: (file: File) => Promise<DraftImagePlacement>;
  onImportUrl: (url: string, caption?: string) => Promise<DraftImagePlacement>;
}

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
    { title, content, preview, theme, onChange, onUploadFile, onImportUrl },
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

    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          heading: { levels: [2, 3] },
          link: { openOnClick: false, autolink: true, linkOnPaste: true },
        }),
        NewsImage.configure({ allowBase64: false, inline: false }),
        Placeholder.configure({ placeholder: "从这里开始自由编辑正文……" }),
      ],
      content,
      editorProps: {
        attributes: {
          class: "continuous-prose",
          "aria-label": "连续文章编辑器",
        },
      },
      onUpdate: ({ editor: current }) => {
        if (updatesEnabled.current) onChange(current.getHTML());
      },
    });

    useEffect(() => {
      const frame = window.requestAnimationFrame(() => {
        updatesEnabled.current = true;
      });
      return () => window.cancelAnimationFrame(frame);
    }, []);

    useEffect(() => {
      if (!editor || editor.isDestroyed) return;
      editor.setEditable(!preview);
    }, [editor, preview]);

    useEffect(() => {
      if (!editor || editor.isDestroyed || editor.getHTML() === content) return;
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
              value={editor.isActive("heading", { level: 2 }) ? "h2" : editor.isActive("heading", { level: 3 }) ? "h3" : "p"}
              onChange={(event) => {
                if (event.target.value === "h2") editor.chain().focus().toggleHeading({ level: 2 }).run();
                else if (event.target.value === "h3") editor.chain().focus().toggleHeading({ level: 3 }).run();
                else editor.chain().focus().setParagraph().run();
              }}
            >
              <option value="p">正文</option>
              <option value="h2">二级标题</option>
              <option value="h3">三级标题</option>
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
          {!preview ? <span className="editor-drop-hint">连续编辑 · 支持粘贴、拖放和光标插图</span> : null}
        </div>
      </div>
    );
  },
);
