"use client";
import { useEffect, type RefObject } from "react";
import { handleEditorListBeforeInput } from "../lib/editor-lists";

export function useEditorLists(ref: RefObject<HTMLDivElement | null>, enabled = true) {
  useEffect(() => {
    const editor = ref.current;
    if (!editor || !enabled) return;
    let composing = false, changing = false;
    const before = (event: InputEvent) => {
      if (composing || changing) return;
      changing = true;
      try { handleEditorListBeforeInput(editor, event); } finally { changing = false; }
    };
    const start = () => { composing = true; };
    const end = () => { composing = false; };
    editor.addEventListener("beforeinput", before);
    editor.addEventListener("compositionstart", start);
    editor.addEventListener("compositionend", end);
    return () => {
      editor.removeEventListener("beforeinput", before);
      editor.removeEventListener("compositionstart", start);
      editor.removeEventListener("compositionend", end);
    };
  }, [ref, enabled]);
}
