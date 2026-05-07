import {
  ChangeDesc,
  EditorState,
  Extension,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { editorInfoField, editorViewField } from "obsidian";

export interface ColorRange {
  from: number;
  to: number;
  color: string; // CSS color value (hex, var(), etc.)
}

export interface Range {
  from: number;
  to: number;
}

export interface CommentRange extends Range {
  id: string;
  text: string;
  author: string;
  createdAt: number;
}

export interface FileColorData {
  text: ColorRange[];
  bg: ColorRange[];
  underline?: Range[];
  comments?: CommentRange[];
}

export interface ColorStorage {
  load(path: string): FileColorData | null | undefined;
  save(path: string, data: FileColorData): void;
}

export const setTextColorEffect = StateEffect.define<{
  from: number;
  to: number;
  color: string | null;
}>();

export const setBgColorEffect = StateEffect.define<{
  from: number;
  to: number;
  color: string | null;
}>();

export const setUnderlineEffect = StateEffect.define<{
  from: number;
  to: number;
  // If provided, set underline to this boolean. If omitted, toggle.
  enable?: boolean;
}>();

export const addCommentEffect = StateEffect.define<{
  from: number;
  to: number;
  text: string;
  id?: string;
  author?: string;
  createdAt?: number;
}>();

export const removeCommentEffect = StateEffect.define<string>();

interface ColorState {
  text: ColorRange[];
  bg: ColorRange[];
  underline: Range[];
  comments: CommentRange[];
  decorations: DecorationSet;
  filePath: string | null;
  isMain: boolean;
  needsReload: boolean;
}

let activeColorField: StateField<ColorState> | null = null;

const EMPTY_FILE_DATA: FileColorData = {
  text: [],
  bg: [],
  underline: [],
  comments: [],
};

const cloneColorRanges = (ranges: ColorRange[]): ColorRange[] =>
  ranges.map((r) => ({ ...r }));
const cloneRanges = (ranges: Range[]): Range[] => ranges.map((r) => ({ ...r }));
const cloneComments = (comments: CommentRange[]): CommentRange[] =>
  comments.map((r) => ({ ...r }));

const clampColorRangesToDoc = (
  ranges: ColorRange[],
  len: number,
): ColorRange[] => {
  if (!ranges.length) return ranges;
  const out: ColorRange[] = [];
  for (const r of ranges) {
    const from = Math.max(0, Math.min(len, r.from));
    const to = Math.max(0, Math.min(len, r.to));
    if (from < to) out.push({ from, to, color: r.color });
  }
  return out;
};
const clampRangesToDoc = (ranges: Range[], len: number): Range[] => {
  if (!ranges.length) return ranges;
  const out: Range[] = [];
  for (const r of ranges) {
    const from = Math.max(0, Math.min(len, r.from));
    const to = Math.max(0, Math.min(len, r.to));
    if (from < to) out.push({ from, to });
  }
  return out;
};

const clampCommentsToDoc = (
  comments: CommentRange[],
  len: number,
): CommentRange[] => {
  if (!comments.length) return comments;
  const out: CommentRange[] = [];
  for (const r of comments) {
    const from = Math.max(0, Math.min(len, r.from));
    const to = Math.max(0, Math.min(len, r.to));
    if (from < to && r.text.trim()) out.push({ ...r, from, to });
  }
  return out;
};

const isMainEditorView = (state: EditorState): boolean => {
  try {
    const view = state.field(editorViewField) as unknown as
      | EditorView
      | undefined;
    if (!view) return true;
    const el = view.dom as HTMLElement | null;
    return !el?.closest?.(".cm-table-widget");
  } catch {
    return true;
  }
};

const mapColorRanges = (
  ranges: ColorRange[],
  changes: ChangeDesc,
): ColorRange[] => {
  if (!ranges.length) return ranges;
  const result: ColorRange[] = [];
  for (const r of ranges) {
    // Left-inclusive, right-exclusive mapping so typing at the end doesn't extend the style.
    const from = changes.mapPos(r.from, 1);
    const to = changes.mapPos(r.to, -1);
    if (from >= to) continue;
    result.push({ from, to, color: r.color });
  }
  return result;
};

const mapRanges = (ranges: Range[], changes: ChangeDesc): Range[] => {
  if (!ranges.length) return ranges;
  const result: Range[] = [];
  for (const r of ranges) {
    // Left-inclusive, right-exclusive mapping so typing at the end doesn't extend the style.
    const from = changes.mapPos(r.from, 1);
    const to = changes.mapPos(r.to, -1);
    if (from >= to) continue;
    result.push({ from, to });
  }
  return result;
};

const mapComments = (
  comments: CommentRange[],
  changes: ChangeDesc,
): CommentRange[] => {
  if (!comments.length) return comments;
  const result: CommentRange[] = [];
  for (const r of comments) {
    const from = changes.mapPos(r.from, 1);
    const to = changes.mapPos(r.to, -1);
    if (from >= to) continue;
    result.push({ ...r, from, to });
  }
  return result;
};

const applyColorChange = (
  ranges: ColorRange[],
  change: { from: number; to: number; color: string | null },
): ColorRange[] => {
  const { from, to, color } = change;
  if (from >= to) return ranges;

  const next: ColorRange[] = [];
  for (const r of ranges) {
    if (r.to <= from || r.from >= to) {
      // No overlap
      next.push(r);
      continue;
    }
    // Left remainder
    if (r.from < from) {
      next.push({ from: r.from, to: from, color: r.color });
    }
    // Right remainder
    if (r.to > to) {
      next.push({ from: to, to: r.to, color: r.color });
    }
  }

  if (color != null) {
    next.push({ from, to, color });
  }

  // Sort and merge adjacent same-color ranges
  next.sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: ColorRange[] = [];
  for (const r of next) {
    const last = merged[merged.length - 1];
    if (last && last.color === r.color && last.to >= r.from) {
      last.to = Math.max(last.to, r.to);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
};

const subtractRange = (ranges: Range[], from: number, to: number): Range[] => {
  const next: Range[] = [];
  for (const r of ranges) {
    if (r.to <= from || r.from >= to) {
      next.push(r);
      continue;
    }
    if (r.from < from) next.push({ from: r.from, to: from });
    if (r.to > to) next.push({ from: to, to: r.to });
  }
  return next;
};

const selectionMinusRanges = (
  ranges: Range[],
  from: number,
  to: number,
): Range[] => {
  const overlapped = ranges
    .filter((r) => r.to > from && r.from < to)
    .sort((a, b) => a.from - b.from);
  const result: Range[] = [];
  let cursor = from;
  for (const r of overlapped) {
    const s = Math.max(r.from, from);
    const e = Math.min(r.to, to);
    if (s > cursor) {
      result.push({ from: cursor, to: s });
    }
    cursor = Math.max(cursor, e);
  }
  if (cursor < to) result.push({ from: cursor, to });
  return result;
};

const mergeAdjacent = (ranges: Range[]): Range[] => {
  if (!ranges.length) return ranges;
  const sorted = [...ranges].sort((a, b) => a.from - b.from || a.to - b.to);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && last.to >= r.from) {
      last.to = Math.max(last.to, r.to);
    } else {
      out.push({ ...r });
    }
  }
  return out;
};

const applyUnderlineChange = (
  ranges: Range[],
  change: { from: number; to: number; enable?: boolean },
): Range[] => {
  const { from, to, enable } = change;
  if (from >= to) return ranges;

  if (enable === true) {
    // Set underline ON for [from, to]
    const next = subtractRange(ranges, from, to);
    return mergeAdjacent([...next, { from, to }]);
  }
  if (enable === false) {
    // Set underline OFF for [from, to]
    return subtractRange(ranges, from, to);
  }
  // Toggle underline within [from, to]
  const removed = subtractRange(ranges, from, to);
  const addSegments = selectionMinusRanges(ranges, from, to);
  return mergeAdjacent([...removed, ...addSegments]);
};

const formatRelativeTime = (createdAt: number): string => {
  const elapsed = Math.max(0, Date.now() - createdAt);
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
};

const commentCardTimers = new WeakMap<HTMLElement, number>();

const clampNumber = (min: number, value: number, max: number): number => {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
};

const hideCommentCard = (cardEl: HTMLElement) => {
  const timer = commentCardTimers.get(cardEl);
  if (timer) window.clearTimeout(timer);
  commentCardTimers.delete(cardEl);
  cardEl.classList.remove("is-visible");
};

const scheduleCommentCardHide = (cardEl: HTMLElement) => {
  const timer = commentCardTimers.get(cardEl);
  if (timer) window.clearTimeout(timer);
  commentCardTimers.set(
    cardEl,
    window.setTimeout(() => hideCommentCard(cardEl), 3000),
  );
};

const positionCommentCard = (
  anchorEl: HTMLElement,
  cardEl: HTMLElement,
  view: EditorView,
): void => {
  const gap = 12;
  const anchorRect = anchorEl.getBoundingClientRect();
  const docEl = view.dom.ownerDocument.documentElement;
  const viewportWidth = docEl.clientWidth;
  const viewportHeight = docEl.clientHeight;
  const cardWidth = Math.min(300, viewportWidth - gap * 2);
  const cardHeight = Math.max(72, cardEl.offsetHeight || 100);
  const preferredLeft = anchorRect.left - Math.min(36, cardWidth / 3);
  const belowTop = anchorRect.bottom + 8;
  const aboveTop = anchorRect.top - cardHeight - 8;
  const preferredTop =
    belowTop + cardHeight <= viewportHeight - gap ? belowTop : aboveTop;
  const left = clampNumber(gap, preferredLeft, viewportWidth - cardWidth - gap);
  const top = clampNumber(gap, preferredTop, viewportHeight - cardHeight - gap);

  cardEl.style.width = `${Math.round(cardWidth)}px`;
  cardEl.style.left = `${Math.round(left)}px`;
  cardEl.style.top = `${Math.round(top)}px`;
};

const showCommentCard = (
  anchorEl: HTMLElement,
  cardEl: HTMLElement,
  view: EditorView,
) => {
  positionCommentCard(anchorEl, cardEl, view);
  cardEl.classList.add("is-visible");
  scheduleCommentCardHide(cardEl);
};

const findCommentAnchor = (
  view: EditorView,
  commentId: string,
): HTMLElement | null => {
  for (const anchorEl of Array.from(
    view.dom.querySelectorAll<HTMLElement>(".mini-toolbar-v2-comment-anchor"),
  )) {
    if (anchorEl.dataset.commentId === commentId) return anchorEl;
  }
  return null;
};

export const getCommentAtRange = (
  state: EditorState,
  range: Range | null | undefined,
): CommentRange | null => {
  if (!activeColorField || !range) return null;
  const value = state.field(activeColorField, false);
  if (!value) return null;

  const overlapping = value.comments
    .filter((comment) => comment.from < range.to && comment.to > range.from)
    .sort((a, b) => {
      const aContains = a.from <= range.from && a.to >= range.to ? 0 : 1;
      const bContains = b.from <= range.from && b.to >= range.to ? 0 : 1;
      return aContains - bContains || a.from - b.from;
    });

  return overlapping[0] ?? null;
};

export const getCommentById = (
  state: EditorState,
  commentId: string | null | undefined,
): CommentRange | null => {
  if (!activeColorField || !commentId) return null;
  const value = state.field(activeColorField, false);
  if (!value) return null;
  return value.comments.find((comment) => comment.id === commentId) ?? null;
};

export const revealCommentById = (
  view: EditorView,
  commentId: string,
): boolean => {
  const anchorEl = findCommentAnchor(view, commentId);
  const cardEl = anchorEl?.querySelector<HTMLElement>(
    ".mini-toolbar-v2-comment-card",
  );
  if (!anchorEl || !cardEl) return false;

  showCommentCard(anchorEl, cardEl, view);
  return true;
};

class CommentWidget extends WidgetType {
  constructor(private readonly comment: CommentRange) {
    super();
  }

  eq(other: WidgetType): boolean {
    if (!(other instanceof CommentWidget)) return false;
    return (
      other.comment.id === this.comment.id &&
      other.comment.text === this.comment.text &&
      other.comment.author === this.comment.author &&
      other.comment.createdAt === this.comment.createdAt
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const doc = view.dom.ownerDocument || document;
    const anchorEl = doc.createElement("span");
    anchorEl.className = "mini-toolbar-v2-comment-anchor";
    anchorEl.setAttribute("aria-label", "Comment");
    anchorEl.dataset.commentId = this.comment.id;

    const cardEl = doc.createElement("span");
    cardEl.className = "mini-toolbar-v2-comment-card";
    cardEl.dataset.commentId = this.comment.id;

    const headerEl = doc.createElement("span");
    headerEl.className = "mini-toolbar-v2-comment-card-header";

    const avatarEl = doc.createElement("span");
    avatarEl.className = "mini-toolbar-v2-comment-avatar";
    avatarEl.textContent = "Q";

    const authorEl = doc.createElement("span");
    authorEl.className = "mini-toolbar-v2-comment-author";
    authorEl.textContent = this.comment.author;

    const timeEl = doc.createElement("span");
    timeEl.className = "mini-toolbar-v2-comment-time";
    timeEl.textContent = formatRelativeTime(this.comment.createdAt);

    const closeButtonEl = doc.createElement("button");
    closeButtonEl.className = "mini-toolbar-v2-comment-delete";
    closeButtonEl.type = "button";
    closeButtonEl.setAttribute("aria-label", "Delete comment");
    closeButtonEl.textContent = "×";
    closeButtonEl.addEventListener("mousedown", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
    });
    closeButtonEl.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      view.dispatch({ effects: removeCommentEffect.of(this.comment.id) });
    });

    headerEl.appendChild(avatarEl);
    headerEl.appendChild(authorEl);
    headerEl.appendChild(timeEl);
    headerEl.appendChild(closeButtonEl);

    const bodyEl = doc.createElement("span");
    bodyEl.className = "mini-toolbar-v2-comment-body";
    bodyEl.textContent = this.comment.text;

    cardEl.appendChild(headerEl);
    cardEl.appendChild(bodyEl);
    anchorEl.appendChild(cardEl);

    cardEl.addEventListener("mouseenter", () => {
      const timer = commentCardTimers.get(cardEl);
      if (timer) window.clearTimeout(timer);
      commentCardTimers.delete(cardEl);
    });
    cardEl.addEventListener("mouseleave", () =>
      scheduleCommentCardHide(cardEl),
    );

    const reposition = () => positionCommentCard(anchorEl, cardEl, view);
    const win = doc.defaultView ?? window;
    view.scrollDOM.addEventListener("scroll", reposition, { passive: true });
    win.addEventListener("resize", reposition);
    (anchorEl as any)._miniToolbarCleanup = () => {
      view.scrollDOM.removeEventListener("scroll", reposition);
      win.removeEventListener("resize", reposition);
      hideCommentCard(cardEl);
    };

    if (Date.now() - this.comment.createdAt < 3000) {
      requestAnimationFrame(() => showCommentCard(anchorEl, cardEl, view));
    } else {
      requestAnimationFrame(() => positionCommentCard(anchorEl, cardEl, view));
    }

    return anchorEl;
  }

  ignoreEvent(): boolean {
    return false;
  }

  destroy(dom: HTMLElement): void {
    (dom as any)._miniToolbarCleanup?.();
  }
}

const buildDecorations = (
  state: EditorState,
  text: ColorRange[],
  bg: ColorRange[],
  underline: Range[],
  comments: CommentRange[],
): DecorationSet => {
  const ranges: any[] = [];

  for (const r of text) {
    ranges.push(
      Decoration.mark({
        attributes: { style: `color: ${r.color};` },
      }).range(r.from, r.to),
    );
  }

  for (const r of bg) {
    ranges.push(
      Decoration.mark({
        attributes: {
          // Only set background-color here. We intentionally do NOT override the
          // text color so that text-color decorations can always win, no matter
          // which decoration ends up being the inner/outer span.
          style: `background-color: ${r.color};`,
        },
      }).range(r.from, r.to),
    );
  }

  for (const r of underline) {
    ranges.push(
      Decoration.mark({
        attributes: {
          style:
            "text-decoration: underline; text-decoration-skip-ink: auto; text-underline-offset: 2px;",
        },
      }).range(r.from, r.to),
    );
  }

  for (const r of comments) {
    ranges.push(
      Decoration.mark({
        class: "mini-toolbar-v2-comment-mark",
        attributes: {
          "data-mini-toolbar-comment-id": r.id,
          title: "Comment",
        },
      }).range(r.from, r.to),
    );
    ranges.push(
      Decoration.widget({
        widget: new CommentWidget(r),
        side: 1,
      }).range(r.to),
    );
  }

  if (!ranges.length) return Decoration.none;
  return Decoration.set(ranges, true);
};

export const createColorExtension = (storage: ColorStorage): Extension => {
  const colorField = StateField.define<ColorState>({
    create(state) {
      let path: string | null = null;
      try {
        // editorInfoField stores a MarkdownView-like object for this editor.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mdView = state.field(editorInfoField) as any;
        const file = mdView?.file;
        if (file && typeof file.path === "string") path = file.path;
      } catch {
        path = null;
      }

      const isMain = isMainEditorView(state);

      // In embedded editors (e.g., Live Preview table cells), don't mirror full-file
      // ranges into the fragment doc; it doesn't share coordinates. Keep decorations off.
      if (!isMain) {
        return {
          text: [],
          bg: [],
          underline: [],
          comments: [],
          decorations: Decoration.none,
          filePath: path,
          isMain,
          needsReload: !!path,
        };
      }

      const stored = (path && storage.load(path)) || EMPTY_FILE_DATA;
      // Clamp any persisted ranges to this doc's length. This protects
      // embedded editors (e.g., table cell editors) whose doc is only a fragment
      // of the full file.
      const docLen = state.doc.length;
      const text = clampColorRangesToDoc(
        cloneColorRanges(stored.text ?? []),
        docLen,
      );
      const bg = clampColorRangesToDoc(
        cloneColorRanges(stored.bg ?? []),
        docLen,
      );
      const underline = clampRangesToDoc(
        cloneRanges(stored.underline ?? []),
        docLen,
      );
      const comments = clampCommentsToDoc(
        cloneComments(stored.comments ?? []),
        docLen,
      );
      const decorations = buildDecorations(
        state,
        text,
        bg,
        underline,
        comments,
      );
      return {
        text,
        bg,
        underline,
        comments,
        decorations,
        filePath: path,
        isMain,
        needsReload: false,
      };
    },
    update(value, tr) {
      let { text, bg, underline, comments, filePath, isMain, needsReload } =
        value;
      let path: string | null = filePath;
      let pathChanged = false;
      let dirty = false;

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mdView = tr.state.field(editorInfoField) as any;
        const file = mdView?.file;
        if (file && typeof file.path === "string") path = file.path;
        else path = null;
      } catch {
        path = null;
      }

      const isMainView = isMainEditorView(tr.state);
      const docLen = tr.state.doc.length;

      if (path !== filePath) {
        // Persist previous file's data before switching contexts when we were on the main view.
        if (filePath && isMain) {
          storage.save(filePath, { text, bg, underline, comments });
        }

        if (path && isMainView) {
          const stored = storage.load(path) || EMPTY_FILE_DATA;
          text = clampColorRangesToDoc(
            cloneColorRanges(stored.text ?? []),
            docLen,
          );
          bg = clampColorRangesToDoc(cloneColorRanges(stored.bg ?? []), docLen);
          underline = clampRangesToDoc(
            cloneRanges(stored.underline ?? []),
            docLen,
          );
          comments = clampCommentsToDoc(
            cloneComments(stored.comments ?? []),
            docLen,
          );
          needsReload = false;
        } else {
          text = [];
          bg = [];
          underline = [];
          comments = [];
          needsReload = !!path;
        }
        pathChanged = true;
      }

      // If we couldn't load earlier (e.g., waiting for main editor view), try again once we're on the main view.
      if (!pathChanged && needsReload && path && isMainView) {
        const stored = storage.load(path) || EMPTY_FILE_DATA;
        text = clampColorRangesToDoc(
          cloneColorRanges(stored.text ?? []),
          docLen,
        );
        bg = clampColorRangesToDoc(cloneColorRanges(stored.bg ?? []), docLen);
        underline = clampRangesToDoc(
          cloneRanges(stored.underline ?? []),
          docLen,
        );
        comments = clampCommentsToDoc(
          cloneComments(stored.comments ?? []),
          docLen,
        );
        needsReload = false;
      }

      if (!pathChanged && isMainView && tr.docChanged) {
        text = mapColorRanges(text, tr.changes);
        bg = mapColorRanges(bg, tr.changes);
        underline = mapRanges(underline, tr.changes);
        comments = mapComments(comments, tr.changes);
        dirty = true;
      }

      if (isMainView) {
        for (const e of tr.effects) {
          if (e.is(setTextColorEffect)) {
            text = applyColorChange(text, e.value);
            dirty = true;
          } else if (e.is(setBgColorEffect)) {
            bg = applyColorChange(bg, e.value);
            dirty = true;
          } else if (e.is(setUnderlineEffect)) {
            underline = applyUnderlineChange(underline, e.value);
            dirty = true;
          } else if (e.is(addCommentEffect)) {
            const commentText = e.value.text.trim();
            if (commentText && e.value.from < e.value.to) {
              const index = e.value.id
                ? comments.findIndex((comment) => comment.id === e.value.id)
                : comments.findIndex(
                    (comment) =>
                      comment.from < e.value.to && comment.to > e.value.from,
                  );
              if (index >= 0) {
                comments = comments.map((comment, i) =>
                  i === index
                    ? {
                        ...comment,
                        from: e.value.from,
                        to: e.value.to,
                        text: commentText,
                        author: e.value.author ?? comment.author,
                      }
                    : comment,
                );
              } else {
                comments = [
                  ...comments,
                  {
                    from: e.value.from,
                    to: e.value.to,
                    id:
                      e.value.id ??
                      `${Date.now().toString(36)}-${Math.random()
                        .toString(36)
                        .slice(2, 8)}`,
                    text: commentText,
                    author: e.value.author ?? "Quin Yim",
                    createdAt: e.value.createdAt ?? Date.now(),
                  },
                ];
              }
              dirty = true;
            }
          } else if (e.is(removeCommentEffect)) {
            const nextComments = comments.filter((r) => r.id !== e.value);
            if (nextComments.length !== comments.length) {
              comments = nextComments;
              dirty = true;
            }
          }
        }
      }

      // Ensure ranges stay within current doc length before building decorations
      const clampedText = clampColorRangesToDoc(text, docLen);
      const clampedBg = clampColorRangesToDoc(bg, docLen);
      const clampedUnderline = clampRangesToDoc(underline, docLen);
      const clampedComments = clampCommentsToDoc(comments, docLen);
      text = clampedText;
      bg = clampedBg;
      underline = clampedUnderline;
      comments = clampedComments;

      const decorations = isMainView
        ? buildDecorations(tr.state, text, bg, underline, comments)
        : Decoration.none;

      if (path && isMainView && dirty) {
        storage.save(path, { text, bg, underline, comments });
      }

      return {
        text,
        bg,
        underline,
        comments,
        decorations,
        filePath: path,
        isMain: isMainView,
        needsReload,
      };
    },
    provide: (field) =>
      EditorView.decorations.from(field, (val: ColorState) => val.decorations),
  });

  activeColorField = colorField;

  const commentClickHandler = EditorView.domEventHandlers({
    click(event, view) {
      const targetNode = event.target as Node | null;
      const targetEl =
        targetNode instanceof Element ? targetNode : targetNode?.parentElement;
      const markEl = targetEl?.closest?.(
        ".mini-toolbar-v2-comment-mark",
      ) as HTMLElement | null;
      const commentId = markEl?.dataset.miniToolbarCommentId;
      if (!commentId) return false;

      return revealCommentById(view, commentId);
    },
  });

  return [colorField, commentClickHandler];
};
