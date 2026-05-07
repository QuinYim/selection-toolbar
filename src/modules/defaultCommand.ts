import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { App, editorInfoField } from "obsidian";

import {
  addCommentEffect,
  revealCommentById,
  setBgColorEffect,
  setTextColorEffect,
  setUnderlineEffect,
} from "./colorRanges";

export interface SelectionOffsetRange {
  from: number;
  to: number;
}

export const cutText = (state: EditorState) => {
  const editor = getEditorFromState(state);
  if (!editor) return;
  const originText = editor.getSelection();
  window.navigator.clipboard.writeText(editor.getSelection());
  editor.replaceSelection("", originText);
};

export const copyText = (state: EditorState) => {
  const editor = getEditorFromState(state);
  if (!editor) return;
  window.navigator.clipboard.writeText(editor?.getSelection());
};

export const pasteText = async (state: EditorState) => {
  const editor = getEditorFromState(state);
  if (!editor) return;
  const text = await window.navigator.clipboard.readText();
  if (!text) return;
  editor.replaceSelection(text, "mini-toolbar-v2-paste");
};

export const boldText = (app: App) => {
  app.commands.executeCommandById("editor:toggle-bold", app);
};

export const strikethroughText = (app: App) => {
  app.commands.executeCommandById("editor:toggle-strikethrough", app);
};

export const markText = (app: App) => {
  app.commands.executeCommandById("editor:toggle-highlight", app);
};

export const italicText = (app: App) => {
  app.commands.executeCommandById("editor:toggle-italics", app);
};

export const getEditorFromState = (state: EditorState) => {
  const { editor } = state.field(editorInfoField);
  return editor;
};

export const getSelectionOffsetRange = (
  state: EditorState,
): SelectionOffsetRange | null => {
  const editor = getEditorFromState(state);
  if (!editor) return null;
  const fromPos = editor.getCursor("from");
  const toPos = editor.getCursor("to");
  const from = editor.posToOffset(fromPos);
  const to = editor.posToOffset(toPos);
  if (from >= to) return null;
  return { from, to };
};

const setSelectionByOffset = (
  state: EditorState,
  from: number,
  to = from,
): void => {
  const editor = getEditorFromState(state);
  if (!editor) return;
  editor.setSelection(editor.offsetToPos(from), editor.offsetToPos(to));
};

const getSelectionTextAndOffsets = (state: EditorState) => {
  const editor = getEditorFromState(state);
  if (!editor) return null;
  const fromPos = editor.getCursor("from");
  const toPos = editor.getCursor("to");
  const from = editor.posToOffset(fromPos);
  const to = editor.posToOffset(toPos);
  const text = editor.getRange(fromPos, toPos);
  if (from >= to || !text) return null;
  return { editor, from, to, fromPos, toPos, text };
};

const toggleSelectionWrapper = (
  state: EditorState,
  prefix: string,
  suffix = prefix,
) => {
  const selection = getSelectionTextAndOffsets(state);
  if (!selection) return;

  const { editor, from, to, fromPos, toPos, text } = selection;
  const doc = editor.getValue();
  const wrapped =
    from >= prefix.length &&
    doc.slice(from - prefix.length, from) === prefix &&
    doc.slice(to, to + suffix.length) === suffix;

  if (wrapped) {
    editor.replaceRange(
      "",
      editor.offsetToPos(to),
      editor.offsetToPos(to + suffix.length),
      "mini-toolbar-v2",
    );
    editor.replaceRange(
      "",
      editor.offsetToPos(from - prefix.length),
      editor.offsetToPos(from),
      "mini-toolbar-v2",
    );
    setSelectionByOffset(state, from - prefix.length, to - prefix.length);
    return;
  }

  editor.replaceRange(
    `${prefix}${text}${suffix}`,
    fromPos,
    toPos,
    "mini-toolbar-v2",
  );
  setSelectionByOffset(state, from + prefix.length, to + prefix.length);
};

export const insertLink = (state: EditorState) => {
  const selection = getSelectionTextAndOffsets(state);
  if (!selection) return;

  const { editor, from, fromPos, toPos, text } = selection;
  const existingLink = text.match(/^\[([^\]]*)\]\(([^)]*)\)$/);
  if (existingLink) {
    const replacement = existingLink[1] || existingLink[2];
    editor.replaceRange(replacement, fromPos, toPos, "mini-toolbar-v2");
    setSelectionByOffset(state, from, from + replacement.length);
    return;
  }

  const replacement = `[${text}]()`;
  editor.replaceRange(replacement, fromPos, toPos, "mini-toolbar-v2");
  const urlOffset = from + text.length + 3;
  setSelectionByOffset(state, urlOffset);
};

export const toggleInlineCode = (state: EditorState) => {
  toggleSelectionWrapper(state, "`");
};

export const toggleInlineMath = (state: EditorState) => {
  const selection = getSelectionTextAndOffsets(state);
  if (!selection) return;
  if (selection.text.includes("\n")) {
    toggleSelectionWrapper(state, "$$\n", "\n$$");
    return;
  }
  toggleSelectionWrapper(state, "$");
};

export type TextLineStyle = "text" | "heading1" | "heading2" | "heading3";

const styleLine = (line: string, style: TextLineStyle): string => {
  const indent = line.match(/^\s*/)?.[0] ?? "";
  const body = line
    .slice(indent.length)
    .replace(/^(#{1,6}\s+|>\s+|[-*+]\s+|\d+\.\s+)/, "");
  if (!body.trim()) return line;

  const prefix =
    style === "heading1"
      ? "# "
      : style === "heading2"
      ? "## "
      : style === "heading3"
      ? "### "
      : "";
  return `${indent}${prefix}${body}`;
};

export const applyTextLineStyle = (
  state: EditorState,
  style: TextLineStyle,
) => {
  const editor = getEditorFromState(state);
  if (!editor) return;

  const from = editor.getCursor("from");
  const to = editor.getCursor("to");
  const startLine = Math.min(from.line, to.line);
  const endLine = Math.max(from.line, to.line);

  for (let lineNo = endLine; lineNo >= startLine; lineNo--) {
    const line = editor.getLine(lineNo);
    const next = styleLine(line, style);
    if (next === line) continue;
    editor.replaceRange(
      next,
      { line: lineNo, ch: 0 },
      { line: lineNo, ch: line.length },
      "mini-toolbar-v2",
    );
  }
};

const toBulletedLine = (line: string, remove: boolean): string => {
  const indent = line.match(/^\s*/)?.[0] ?? "";
  const body = line.slice(indent.length);
  if (!body.trim()) return line;

  if (remove) {
    return `${indent}${body.replace(/^[-*+]\s+/, "")}`;
  }

  return `${indent}- ${body.replace(/^([-*+]\s+|\d+[.)]\s+)/, "")}`;
};

export const toggleBulletedList = (state: EditorState) => {
  const editor = getEditorFromState(state);
  if (!editor) return;

  const from = editor.getCursor("from");
  const to = editor.getCursor("to");
  const startLine = Math.min(from.line, to.line);
  const endLine = Math.max(from.line, to.line);
  const lines: string[] = [];

  for (let lineNo = startLine; lineNo <= endLine; lineNo++) {
    lines.push(editor.getLine(lineNo));
  }

  const contentLines = lines.filter((line) => line.trim());
  const shouldRemove =
    contentLines.length > 0 &&
    contentLines.every((line) => /^\s*[-*+]\s+/.test(line));

  for (let lineNo = endLine; lineNo >= startLine; lineNo--) {
    const line = editor.getLine(lineNo);
    const next = toBulletedLine(line, shouldRemove);
    if (next === line) continue;
    editor.replaceRange(
      next,
      { line: lineNo, ch: 0 },
      { line: lineNo, ch: line.length },
      "mini-toolbar-v2-list",
    );
  }
};

export const insertComment = (
  state: EditorState,
  rawComment: string,
  range?: SelectionOffsetRange | null,
  commentId?: string | null,
) => {
  const comment = rawComment.trim().replace(/%%/g, "% %");
  if (!comment) return;

  const target = range ?? getSelectionOffsetRange(state);
  if (!target) return;

  const view = getViewFromState(state);
  if (!view) return;

  const id =
    commentId ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  view.dispatch({
    effects: addCommentEffect.of({
      from: target.from,
      to: target.to,
      text: comment,
      id,
      author: "Quin Yim",
    }),
    selection: { anchor: target.from, head: target.to },
  });

  requestAnimationFrame(() => {
    if (!revealCommentById(view, id)) {
      requestAnimationFrame(() => revealCommentById(view, id));
    }
  });
};

export const getViewFromState = (state: EditorState): EditorView | null => {
  try {
    // editorInfoField gives us the MarkdownView; from there we can grab the
    // underlying CM6 EditorView via the internal `cm`/`cmEditor` property.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mdView = state.field(editorInfoField) as any;
    const editor = mdView?.editor as any;
    const cm: EditorView | undefined =
      editor?.cm ?? editor?.cmEditor ?? editor?.cm6;
    if (cm && typeof (cm as any).dispatch === "function") return cm;
    return null;
  } catch {
    return null;
  }
};

// === Text color helpers ===
// Notion-like text color palette (approximate hex values)
export const NOTION_TEXT_COLOR_MAP: Record<string, string> = {
  Gray: "#9B9A97",
  Brown: "#64473A",
  Orange: "#D9730D",
  Yellow: "#DFAB01",
  Green: "#0F7B6C",
  Blue: "#0B6E99",
  Purple: "#6940A5",
  Pink: "#AD1A72",
  Red: "#E03E3E",
};
export const NOTION_TEXT_COLOR_NAMES: string[] = [
  "Default",
  ...Object.keys(NOTION_TEXT_COLOR_MAP),
];

// Notion-like highlight background palette (approximate)
export const NOTION_BG_COLOR_MAP: Record<string, string> = {
  Gray: "#EAEAEA",
  Brown: "#EEE0DA",
  Orange: "#FAEBDD",
  Yellow: "#FBF3DB",
  Green: "#DDEDEA",
  Blue: "#DDEBF1",
  Purple: "#EAE4F2",
  Pink: "#F4DFEB",
  Red: "#FBE4E4",
};
export const NOTION_BG_COLOR_NAMES: string[] = [
  "Default",
  ...Object.keys(NOTION_BG_COLOR_MAP),
];

// Apply or remove text color via CM6 decorations and colorRanges state.
// This no longer mutates the underlying markdown with HTML; it only updates
// persistent ranges stored in data.json.
export const setTextColor = (state: EditorState, colorCss: string | null) => {
  const view = getViewFromState(state);
  if (!view) return;

  // Always read the *current* selection from the live EditorView to avoid
  // mismatches with the captured CM6 state used to create the toolbar.
  const sel = view.state.selection.main;
  if (sel.empty) return;

  const from = sel.from;
  const to = sel.to;

  view.dispatch({
    effects: setTextColorEffect.of({ from, to, color: colorCss }),
  });
};

export const setTextColorByName = (state: EditorState, name: string) => {
  if (name === "Default") return setTextColor(state, null);
  const hex = NOTION_TEXT_COLOR_MAP[name];
  if (hex) setTextColor(state, hex);
};

// Apply or remove background highlight via CM6 decorations and colorRanges.
export const setBgColor = (state: EditorState, colorCss: string | null) => {
  const view = getViewFromState(state);
  if (!view) return;

  const sel = view.state.selection.main;
  if (sel.empty) return;

  const from = sel.from;
  const to = sel.to;

  view.dispatch({
    effects: setBgColorEffect.of({ from, to, color: colorCss }),
  });
};

export const setBgColorByName = (state: EditorState, name: string) => {
  if (name === "Default") return setBgColor(state, null);
  const varName = `var(--mtv2-bg-${name.toLowerCase()})`;
  setBgColor(state, varName);
};

// Toggle underline decoration over the current selection.
export const toggleUnderline = (state: EditorState, enable?: boolean) => {
  const view = getViewFromState(state);
  if (!view) return;

  const sel = view.state.selection.main;
  if (sel.empty) return;

  const from = sel.from;
  const to = sel.to;

  view.dispatch({
    effects: setUnderlineEffect.of({ from, to, enable }),
  });
};
