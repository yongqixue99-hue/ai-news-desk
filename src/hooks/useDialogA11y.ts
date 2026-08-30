import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(",");

export const getNextFocusIndex = (
  itemCount: number,
  currentIndex: number,
  direction: 1 | -1,
) => {
  if (itemCount <= 0) return -1;
  if (currentIndex < 0) return direction === 1 ? 0 : itemCount - 1;
  return (currentIndex + direction + itemCount) % itemCount;
};

const getFocusableElements = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    const style = window.getComputedStyle(element);
    return !element.hasAttribute("hidden") && style.visibility !== "hidden" && style.display !== "none";
  });

interface UseDialogA11yOptions {
  open: boolean;
  onClose?: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  closeOnEscape?: boolean;
}

/**
 * Provides focus entry, Tab wrapping, Escape handling and focus restoration.
 * Attach the returned ref to the element with role="dialog" and tabIndex={-1}.
 */
export const useDialogA11y = <T extends HTMLElement = HTMLDivElement>({
  open,
  onClose,
  initialFocusRef,
  closeOnEscape = true,
}: UseDialogA11yOptions) => {
  const dialogRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const initialFocus = initialFocusRef?.current ?? getFocusableElements(dialog)[0] ?? dialog;
      initialFocus.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && closeOnEscape && onCloseRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusableElements = getFocusableElements(dialog);
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const currentIndex = focusableElements.indexOf(document.activeElement as HTMLElement);
      const nextIndex = getNextFocusIndex(
        focusableElements.length,
        currentIndex,
        event.shiftKey ? -1 : 1,
      );
      event.preventDefault();
      focusableElements[nextIndex]?.focus();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [closeOnEscape, initialFocusRef, open]);

  return dialogRef;
};
