/**
 * Adapter over the host page's text inputs.
 *
 * Three families are supported:
 *  - <textarea>
 *  - <input type="text|search">
 *  - contenteditable elements (ChatGPT / Claude / Gemini all use rich
 *    contenteditable editors such as ProseMirror or Quill)
 *
 * Privacy guardrail (PRD §6): these helpers are only ever invoked when the
 * user explicitly presses the Cmd/Ctrl+K trigger. Pretext never observes
 * keystrokes or content otherwise.
 */

export type EditableTarget =
  | { kind: 'form'; el: HTMLTextAreaElement | HTMLInputElement }
  | { kind: 'rich'; el: HTMLElement };

/** Resolve the currently focused editable element, descending shadow roots. */
export function findEditable(start: Element | null): EditableTarget | null {
  let el: Element | null = start ?? document.activeElement;
  while (el && (el as HTMLElement).shadowRoot?.activeElement) {
    el = (el as HTMLElement).shadowRoot!.activeElement;
  }
  if (!el) return null;

  if (el instanceof HTMLTextAreaElement && !el.disabled && !el.readOnly) {
    return { kind: 'form', el };
  }
  if (
    el instanceof HTMLInputElement &&
    ['text', 'search', 'url', 'email'].includes(el.type) &&
    !el.disabled &&
    !el.readOnly
  ) {
    return { kind: 'form', el };
  }

  if (el instanceof HTMLElement) {
    const rich = el.closest<HTMLElement>(
      '[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]',
    );
    if (rich) return { kind: 'rich', el: rich };
  }
  return null;
}

/** Read the full text of the target (only on explicit user trigger). */
export function readText(target: EditableTarget): string {
  if (target.kind === 'form') return target.el.value;
  return target.el.innerText ?? target.el.textContent ?? '';
}

/**
 * Replace the target's content with `text`, in a way that frameworks
 * (React-controlled textareas, ProseMirror, Quill) actually register.
 */
export function writeText(target: EditableTarget, text: string): void {
  if (target.kind === 'form') {
    const el = target.el;
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, text);
    else el.value = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    el.focus();
    try {
      el.setSelectionRange(text.length, text.length);
    } catch {
      // input types like "email" disallow selection APIs — harmless.
    }
    return;
  }

  const el = target.el;
  el.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  selection?.removeAllRanges();
  selection?.addRange(range);

  let inserted = false;
  try {
    // Deprecated but still the most reliable way to make rich editors
    // (ProseMirror/Quill/Lexical) accept programmatic text as a user edit.
    inserted = document.execCommand('insertText', false, text);
  } catch {
    inserted = false;
  }
  if (!inserted) {
    el.textContent = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }
  selection?.collapseToEnd();
}

/** Viewport rectangle of the target, for anchoring the inline canvas. */
export function targetRect(target: EditableTarget): DOMRect {
  return target.el.getBoundingClientRect();
}

/** True if the element is still attached and visible enough to anchor to. */
export function targetAlive(target: EditableTarget): boolean {
  const el = target.el;
  if (!el.isConnected) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
