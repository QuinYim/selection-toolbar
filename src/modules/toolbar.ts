import "./style.less";

import { getApi } from "@aidenlx/obsidian-icon-shortcodes";
import {
  lineClassNodeProp,
  syntaxTree,
  tokenClassNodeProp,
} from "@codemirror/language";
import { EditorState, StateField } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { SyntaxNode } from "@lezer/common/dist/tree";
import {
  App,
  BaseComponent,
  ButtonComponent,
  Component,
  Menu,
  setIcon,
} from "obsidian";

import { showTooltip, Tooltip } from "../popper";
import {
  SmallButton as SBtnDef,
  ToolBar as ToolBarDef,
} from "../typings/index";
import { getCommentAtRange, getCommentById } from "./colorRanges";
import {
  boldText,
  copyText,
  cutText,
  getSelectionOffsetRange,
  getViewFromState,
  insertComment,
  insertLink,
  italicText,
  markText,
  pasteText,
  SelectionOffsetRange,
  strikethroughText,
  NOTION_TEXT_COLOR_NAMES,
  setTextColorByName,
  NOTION_TEXT_COLOR_MAP,
  NOTION_BG_COLOR_NAMES,
  setBgColorByName,
  toggleInlineCode,
  toggleInlineMath,
  toggleBulletedList,
  toggleUnderline,
} from "./defaultCommand";

type ColorKind = "text" | "background";

type ColorChoice = {
  kind: ColorKind;
  name: string;
};

let activeColorButton: SmallButton | null = null;
let recentlyUsedColor: ColorChoice | null = null;
let activeCommentPopover: { el: HTMLElement; close: () => void } | null = null;

type ToolbarMenuItem = {
  title: string;
  icon?: string;
  onClick: () => void;
};

const closeActiveCommentPopover = () => {
  activeCommentPopover?.close();
  activeCommentPopover = null;
};

const positionFixedPopover = (
  anchorEl: HTMLElement,
  popoverEl: HTMLElement,
  align: "left" | "center" = "left",
) => {
  const anchorRect = anchorEl.getBoundingClientRect();
  const popoverRect = popoverEl.getBoundingClientRect();
  const docEl = anchorEl.ownerDocument.documentElement;
  const viewportGap = 8;
  const popoverGap = 8;

  let left =
    align === "center"
      ? anchorRect.left + anchorRect.width / 2 - popoverRect.width / 2
      : anchorRect.left - 8;
  let top = anchorRect.bottom + popoverGap;

  const overflowRight =
    left + popoverRect.width - (docEl.clientWidth - viewportGap);
  if (overflowRight > 0) left -= overflowRight;

  const overflowLeft = viewportGap - left;
  if (overflowLeft > 0) left += overflowLeft;

  const overflowBottom =
    anchorRect.bottom +
    popoverGap +
    popoverRect.height -
    (docEl.clientHeight - viewportGap);
  if (overflowBottom > 0) {
    top = anchorRect.top - popoverRect.height - popoverGap;
  }

  const overflowTop = viewportGap - top;
  if (overflowTop > 0) top += overflowTop;

  popoverEl.style.left = `${Math.round(left)}px`;
  popoverEl.style.top = `${Math.round(top)}px`;
  popoverEl.style.visibility = "visible";
};

const showToolbarMenu = (event: MouseEvent, items: ToolbarMenuItem[]) => {
  const targetEl = event.currentTarget as HTMLElement;
  if (!targetEl) return;

  closeActiveCommentPopover();
  activeColorButton?.hideColorMenu();

  const menu = new Menu();
  for (const action of items) {
    menu.addItem((item) => {
      item.setTitle(action.title);
      if (action.icon) item.setIcon(action.icon as any);
      item.onClick(action.onClick);
    });
  }

  const rect = targetEl.getBoundingClientRect();
  menu.setParentElement(targetEl).showAtPosition({
    x: rect.left - 4,
    y: rect.bottom + 6,
  });
};

const showMoreMenu = (state: EditorState, event: MouseEvent) => {
  showToolbarMenu(event, [
    { title: "Copy", icon: "copy", onClick: () => copyText(state) },
    {
      title: "Paste",
      icon: "clipboard-paste",
      onClick: () => pasteText(state),
    },
    { title: "Cut", icon: "scissors", onClick: () => cutText(state) },
  ]);
};

const getCommentIdFromNode = (node: Node | null): string | null => {
  const el =
    node instanceof Element
      ? node
      : node?.parentElement instanceof Element
      ? node.parentElement
      : null;
  const markEl = el?.closest?.(
    ".mini-toolbar-v2-comment-mark",
  ) as HTMLElement | null;
  return markEl?.dataset.miniToolbarCommentId ?? null;
};

const getCommentIdFromSelectionDom = (
  view: EditorView | null,
  range: SelectionOffsetRange,
): string | null => {
  if (!view) return null;

  const positions = [
    range.from,
    Math.max(range.from, range.to - 1),
    Math.min(view.state.doc.length, range.to),
  ];
  for (const pos of positions) {
    try {
      const dom = view.domAtPos(pos);
      const commentId =
        getCommentIdFromNode(dom.node) ??
        getCommentIdFromNode(dom.node.nextSibling) ??
        getCommentIdFromNode(dom.node.previousSibling);
      if (commentId) return commentId;
    } catch {
      // The DOM can lag behind selection changes during composition; fall back below.
    }
  }

  const selection =
    (view.root as any).getSelection?.() ??
    view.dom.ownerDocument.getSelection();
  return (
    getCommentIdFromNode(selection?.anchorNode ?? null) ??
    getCommentIdFromNode(selection?.focusNode ?? null)
  );
};

const openCommentPopover = (state: EditorState, event: MouseEvent) => {
  const buttonEl = event.currentTarget as HTMLElement;
  if (!buttonEl) return;

  const range = getSelectionOffsetRange(state);
  if (!range) return;
  const liveView = getViewFromState(state);
  const lookupState = liveView?.state ?? state;
  const existingComment =
    getCommentAtRange(lookupState, range) ??
    getCommentById(lookupState, getCommentIdFromSelectionDom(liveView, range));
  const targetRange: SelectionOffsetRange = existingComment
    ? { from: existingComment.from, to: existingComment.to }
    : range;

  closeActiveCommentPopover();
  activeColorButton?.hideColorMenu();

  const doc = buttonEl.ownerDocument;
  const popoverEl = doc.body.createDiv({
    cls: "mini-toolbar-v2-comment-popover",
    attr: {
      role: "dialog",
      "aria-label": existingComment ? "Edit comment" : "Add comment",
    },
  });
  popoverEl.style.visibility = "hidden";

  const textareaEl = popoverEl.createEl("textarea", {
    cls: "mini-toolbar-v2-comment-input",
    attr: {
      placeholder: "Add a comment...",
      rows: "3",
    },
  });
  if (existingComment) textareaEl.value = existingComment.text;
  const actionRowEl = popoverEl.createDiv({
    cls: "mini-toolbar-v2-comment-actions",
  });
  const cancelButtonEl = actionRowEl.createEl("button", {
    cls: "mini-toolbar-v2-comment-action",
    text: "Cancel",
    attr: { type: "button" },
  });
  const addButtonEl = actionRowEl.createEl("button", {
    cls: "mini-toolbar-v2-comment-action is-primary",
    text: existingComment ? "Update" : "Comment",
    attr: { type: "button" },
  });

  const close = () => {
    popoverEl.detach();
    doc.removeEventListener("mousedown", onMouseDown, true);
    doc.removeEventListener("keydown", onKeyDown, true);
    if (activeCommentPopover?.el === popoverEl) activeCommentPopover = null;
  };
  const submit = () => {
    insertComment(state, textareaEl.value, targetRange, existingComment?.id);
    close();
  };
  const onMouseDown = (evt: MouseEvent) => {
    const target = evt.target as Node | null;
    if (!target) return;
    if (popoverEl.contains(target) || buttonEl.contains(target)) return;
    close();
  };
  const onKeyDown = (evt: KeyboardEvent) => {
    if (evt.key === "Escape") {
      evt.preventDefault();
      close();
      return;
    }
    if ((evt.metaKey || evt.ctrlKey) && evt.key === "Enter") {
      evt.preventDefault();
      submit();
    }
  };

  cancelButtonEl.addEventListener("click", close);
  addButtonEl.addEventListener("click", submit);
  doc.addEventListener("mousedown", onMouseDown, true);
  doc.addEventListener("keydown", onKeyDown, true);
  activeCommentPopover = { el: popoverEl, close };

  requestAnimationFrame(() => {
    positionFixedPopover(buttonEl, popoverEl, "center");
    textareaEl.focus();
  });
};

const getCursorTooltips = (state: EditorState, app: App): Tooltip | null => {
  const sel = state.selection.ranges[0];
  if (!sel) return null;

  const { anchor, head, empty } = sel;
  let [start, end] = [anchor, head].sort();

  const createToolbar = (container: any) => {
    const toolbar = new ToolBar(container);
    const firstRow = toolbar.addRow("mini-toolbar-v2-row-primary");
    const secondRow = toolbar.addRow("mini-toolbar-v2-row-secondary");

    toolbar
      .addSmallButton(
        (btn) =>
          btn
            .setIcon("list")
            .setTooltip("Bulleted list")
            .onClick(() => toggleBulletedList(state)),
        firstRow,
      )
      .addSmallButton(
        (btn) =>
          btn
            .setTextIcon("A")
            .setClass("mini-toolbar-v2-color-trigger")
            .setTooltip("Text color")
            .setOptionsList(NOTION_TEXT_COLOR_NAMES)
            .setOnSelectOption((name) => setTextColorByName(state, name))
            .setOnSelectBgOption((name) => setBgColorByName(state, name))
            .onClick(() => {}),
        firstRow,
      )
      .addSmallButton(
        (btn) => btn.setIcon("bold").onClick(() => boldText(app)),
        firstRow,
      )
      .addSmallButton(
        (btn) => btn.setIcon("italic").onClick(() => italicText(app)),
        firstRow,
      )
      .addSmallButton(
        (btn) =>
          btn
            .setIcon("underline")
            .setTooltip("Underline")
            .onClick(() => toggleUnderline(state)),
        firstRow,
      )
      .addSmallButton(
        (btn) =>
          btn
            .setIcon("highlighter")
            .setTooltip("Highlight")
            .onClick(() => markText(app)),
        firstRow,
      )
      .addSmallButton(
        (btn) =>
          btn
            .setIcon("link")
            .setTooltip("Link")
            .onClick(() => insertLink(state)),
        secondRow,
      )
      .addSmallButton(
        (btn) =>
          btn.setIcon("strikethrough").onClick(() => strikethroughText(app)),
        secondRow,
      )
      .addSmallButton(
        (btn) =>
          btn
            .setIcon("code-2")
            .setTooltip("Code")
            .onClick(() => toggleInlineCode(state)),
        secondRow,
      )
      .addSmallButton(
        (btn) =>
          btn
            .setTextIcon("√x")
            .setTooltip("Equation")
            .onClick(() => toggleInlineMath(state)),
        secondRow,
      )
      .addSmallButton(
        (btn) =>
          btn
            .setIcon("message-square")
            .setClass("mini-toolbar-v2-comment-button")
            .setTooltip("Comment")
            .onClick((evt) => openCommentPopover(state, evt)),
        secondRow,
      )
      .addSmallButton(
        (btn) =>
          btn
            .setIcon("ellipsis")
            .setTooltip("More")
            .onClick((evt) => showMoreMenu(state, evt)),
        secondRow,
      );

    return toolbar;
  };

  return {
    start: start,
    end: empty ? undefined : end,
    create: createToolbar,
  };
};

export const cursorTooltipField = (app: App) => {
  return StateField.define<Tooltip | null>({
    create: (state: EditorState) => getCursorTooltips(state, app),

    update: (tooltips, tr) => {
      if (!tr.docChanged && !tr.selection) return tooltips;
      return getCursorTooltips(tr.state, app);
    },

    // enable showtooltips extension with tooltips info provided from statefield
    provide: (f) => showTooltip.from(f),
  });
};

export const ToolBarExtension = (app: App) => {
  return [cursorTooltipField(app)];
};

class SmallButton extends BaseComponent implements SBtnDef {
  button: ButtonComponent;
  disabled = false;
  dropdownOptions: string[] = [];
  onSelectOption: ((title: string) => void) | null = null;
  onSelectBgOption: ((title: string) => void) | null = null;
  colorMenuEl: HTMLElement | null = null;
  menuOpened = false;
  private removeDocumentHandlers: (() => void) | null = null;

  constructor(containerEl: HTMLElement) {
    super();
    this.button = new ButtonComponent(containerEl);
    this.button.buttonEl.addEventListener("mousedown", (evt) => {
      evt.preventDefault();
    });
  }

  setDisabled(disabled: boolean): this {
    this.button.setDisabled(disabled);
    this.disabled = disabled;
    return this;
  }

  /**
   * @param iconId icon name in obsidian or icon shortcode
   */
  setIcon(iconId: string): this {
    const iconSize = 14;
    this.button.setIcon(iconId);
    let iconSC, icon;
    if (
      !this.button.buttonEl.querySelector("svg") &&
      (iconSC = getApi()) &&
      (icon = iconSC.getIcon(iconId, false))
    ) {
      const sizeAttr = {
        width: iconSize,
        height: iconSize,
      };
      if (typeof icon === "string") {
        this.button.buttonEl.createDiv({ text: icon, attr: sizeAttr });
      } else {
        Object.assign(icon, sizeAttr);
        this.button.buttonEl.appendChild(icon);
      }
    }
    return this;
  }

  setTextIcon(text: string): this {
    this.button.buttonEl.empty();
    this.button.buttonEl.createSpan({
      cls: "mini-toolbar-v2-text-icon",
      text,
    });
    return this;
  }

  setIconWithText(iconId: string, text: string): this {
    this.button.buttonEl.empty();
    this.setIcon(iconId);
    this.button.buttonEl.createSpan({
      cls: "mini-toolbar-v2-button-label",
      text,
    });
    return this;
  }

  setClass(cls: string): this {
    this.button.setClass(cls);
    return this;
  }

  setDropdownText(state: EditorState): this {
    const textDiv = this.button.buttonEl.createDiv("mini-toolbar-v2-text");
    const iconDiv = this.button.buttonEl.createDiv(
      "mini-toolbar-v2-icon-with-text",
    );
    setIcon(iconDiv, "chevron-down");

    const linePos = state.doc.lineAt(state.selection.ranges[0].from)?.from;
    let syntaxNode = syntaxTree(state).resolveInner(linePos + 1);
    // @ts-ignore
    let nodeProps: string = syntaxNode.type.prop(tokenClassNodeProp);
    textDiv.setText(this.detectFormat(nodeProps, syntaxNode) || "Text");
    return this;
  }

  setDropdownIcon(iconId: string = "highlighter"): this {
    const highlightIconDiv = this.button.buttonEl.createDiv(
      "mini-toolbar-v2-highlight-icon",
    );
    const iconDiv = this.button.buttonEl.createDiv(
      "mini-toolbar-v2-icon-with-icon",
    );
    setIcon(highlightIconDiv, iconId);
    setIcon(iconDiv, "chevron-down");

    return this;
  }

  detectFormat(nodeProps: string, syntaxNode: SyntaxNode): string | undefined {
    if (!nodeProps) return "Text";
    if (nodeProps.includes("strong")) return "Bold";
    if (nodeProps.includes("em")) return "Italic";
    if (nodeProps.includes("strikethrough")) return "Strike";
    if (nodeProps.contains("hmd-codeblock")) {
      return "CodeBlock";
    }
    if (nodeProps.contains("hmd-inline-code")) {
      return "Code";
    }
    if (nodeProps.contains("formatting-header")) {
      const headingLevel = nodeProps.match(/header-\d{1,}/);
      if (headingLevel) {
        return "Heading " + headingLevel[0].slice(-1);
      }
    }
    if (
      nodeProps.contains("formatting-list") ||
      nodeProps.contains("hmd-list-indent")
    ) {
      if (syntaxNode?.parent) {
        // @ts-ignore
        const nodeProps = syntaxNode.parent?.type.prop(lineClassNodeProp);
        if (nodeProps?.contains("HyperMD-task-line")) return "To-do list";
      }
      if (nodeProps.contains("formatting-list-ol")) return "Numbered list";
      if (nodeProps.contains("formatting-list-ul")) return "Bulleted list";
    }
  }

  setTooltip(tooltip: string): this {
    this.button.setTooltip(tooltip);
    return this;
  }

  setOptionsList(optionsList: string[]): this {
    this.dropdownOptions = optionsList;
    return this;
  }

  setOnSelectOption(handler: (title: string) => void): this {
    this.onSelectOption = handler;
    return this;
  }

  setOnSelectBgOption(handler: (title: string) => void): this {
    this.onSelectBgOption = handler;
    return this;
  }

  onClick(cb: (evt: MouseEvent) => void): this {
    if (this.dropdownOptions.length > 0) {
      this.button.buttonEl.setAttribute("aria-haspopup", "menu");
      this.button.buttonEl.setAttribute("aria-expanded", "false");
      this.button.onClick((evt) => {
        evt.preventDefault();
        this.showEditMenu(evt);
      });
      return this;
    }
    this.button.onClick(cb);
    return this;
  }

  // analyzeMarkdownFormat(text: string): string {}

  showEditMenu(event: MouseEvent): void {
    if (this.menuOpened) {
      this.hideColorMenu();
      return;
    }

    const buttonEl =
      (event.currentTarget as HTMLElement) || this.button.buttonEl;
    const doc = buttonEl.ownerDocument;

    activeColorButton?.hideColorMenu();
    activeColorButton = this;

    const colorMenuEl = doc.body.createDiv({
      cls: "mini-toolbar-v2-color-popover",
      attr: {
        role: "menu",
        "aria-label": "Color options",
      },
    });
    colorMenuEl.style.visibility = "hidden";

    if (recentlyUsedColor) {
      this.createColorSection(
        colorMenuEl,
        "Recently used",
        [recentlyUsedColor],
        true,
      );
    }
    this.createColorSection(
      colorMenuEl,
      "Text color",
      this.dropdownOptions.map((name) => ({ kind: "text", name })),
    );
    this.createColorSection(
      colorMenuEl,
      "Background color",
      NOTION_BG_COLOR_NAMES.map((name) => ({ kind: "background", name })),
    );

    this.colorMenuEl = colorMenuEl;
    this.menuOpened = true;
    this.button.buttonEl.classList.add("is-active");
    this.button.buttonEl.setAttribute("aria-expanded", "true");

    requestAnimationFrame(() => {
      this.positionColorMenu(buttonEl, colorMenuEl);
    });

    this.registerDocumentHandlers(colorMenuEl, buttonEl);
  }

  hideColorMenu(): void {
    this.colorMenuEl?.detach();
    this.colorMenuEl = null;
    this.menuOpened = false;
    this.button.buttonEl.classList.remove("is-active");
    this.button.buttonEl.setAttribute("aria-expanded", "false");
    this.removeDocumentHandlers?.();
    this.removeDocumentHandlers = null;
    if (activeColorButton === this) activeColorButton = null;
  }

  private registerDocumentHandlers(menuEl: HTMLElement, buttonEl: HTMLElement) {
    const doc = buttonEl.ownerDocument;
    const onMouseDown = (evt: MouseEvent) => {
      const target = evt.target as Node | null;
      if (!target) return;
      if (menuEl.contains(target) || buttonEl.contains(target)) return;
      this.hideColorMenu();
    };
    const onKeyDown = (evt: KeyboardEvent) => {
      if (evt.key === "Escape") this.hideColorMenu();
    };

    doc.addEventListener("mousedown", onMouseDown, true);
    doc.addEventListener("keydown", onKeyDown, true);
    this.removeDocumentHandlers = () => {
      doc.removeEventListener("mousedown", onMouseDown, true);
      doc.removeEventListener("keydown", onKeyDown, true);
    };
  }

  private createColorSection(
    menuEl: HTMLElement,
    title: string,
    choices: ColorChoice[],
    recent = false,
  ) {
    menuEl.createDiv({
      cls: "mini-toolbar-v2-color-section-title",
      text: title,
    });
    const gridEl = menuEl.createDiv({
      cls: recent
        ? "mini-toolbar-v2-color-grid mini-toolbar-v2-color-grid-recent"
        : "mini-toolbar-v2-color-grid",
    });

    for (const choice of choices) {
      this.createColorSwatch(gridEl, choice);
    }
  }

  private createColorSwatch(gridEl: HTMLElement, choice: ColorChoice) {
    const label =
      choice.kind === "text"
        ? `${choice.name} text color`
        : `${choice.name} background color`;
    const swatchEl = gridEl.createEl("button", {
      cls: `mini-toolbar-v2-color-swatch is-${choice.kind}`,
      attr: {
        type: "button",
        role: "menuitem",
        title: label,
        "aria-label": label,
      },
    });

    if (choice.name === "Default") {
      swatchEl.classList.add("is-default");
    }

    if (choice.kind === "text") {
      const letterEl = swatchEl.createSpan({
        cls: "mini-toolbar-v2-color-letter",
        text: "A",
      });
      letterEl.style.color =
        choice.name === "Default"
          ? "var(--text-normal)"
          : NOTION_TEXT_COLOR_MAP[choice.name];
    } else if (choice.name !== "Default") {
      swatchEl.style.backgroundColor = `var(--mtv2-bg-${choice.name.toLowerCase()})`;
    }

    swatchEl.addEventListener("mousedown", (evt) => {
      evt.preventDefault();
    });
    swatchEl.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      recentlyUsedColor = choice;
      if (choice.kind === "text") {
        this.onSelectOption?.(choice.name);
      } else {
        this.onSelectBgOption?.(choice.name);
      }
      this.hideColorMenu();
    });
  }

  private positionColorMenu(buttonEl: HTMLElement, menuEl: HTMLElement) {
    const buttonRect = buttonEl.getBoundingClientRect();
    const menuRect = menuEl.getBoundingClientRect();
    const docEl = buttonEl.ownerDocument.documentElement;
    const viewportGap = 8;
    const menuGap = 6;

    let left = buttonRect.left - 8;
    let top = buttonRect.bottom + menuGap;

    const overflowRight =
      left + menuRect.width - (docEl.clientWidth - viewportGap);
    if (overflowRight > 0) left -= overflowRight;

    const overflowLeft = viewportGap - left;
    if (overflowLeft > 0) left += overflowLeft;

    const overflowBottom =
      buttonRect.bottom +
      menuGap +
      menuRect.height -
      (docEl.clientHeight - viewportGap);
    if (overflowBottom > 0) {
      top = buttonRect.top - menuRect.height - menuGap;
    }

    const overflowTop = viewportGap - top;
    if (overflowTop > 0) top += overflowTop;

    menuEl.style.left = `${Math.round(left)}px`;
    menuEl.style.top = `${Math.round(top)}px`;
    menuEl.style.visibility = "visible";
  }

  then(cb: (component: this) => any): this {
    cb(this);
    return this;
  }
}

export class ToolBar extends Component implements ToolBarDef {
  dom: HTMLElement;
  smallBtnContainer: HTMLElement;

  constructor(container: HTMLElement) {
    super();
    for (const child of Array.from(container.children)) {
      if (child.classList.contains("cm-mini-toolbar-v2")) child.remove();
    }
    this.dom = container.createDiv(
      { cls: "cm-obsidian-toolbar" },
      (el) => (el.style.position = "absolute"),
    );
    this.smallBtnContainer = this.dom;
  }

  addRow(cls: string): HTMLElement {
    return this.dom.createDiv({ cls: `mini-toolbar-v2-row ${cls}` });
  }

  addSmallButton(
    cb: (button: SmallButton) => any,
    containerEl: HTMLElement = this.smallBtnContainer,
  ): this {
    cb(new SmallButton(containerEl));
    return this;
  }

  unloading: boolean = false;

  hide() {
    activeColorButton?.hideColorMenu();
    closeActiveCommentPopover();
    this.unload();
    if (this.unloading) return this;
    this.unloading = true;
    this.dom.detach();
    this.unloading = false;
    return this;
  }
}
