import type { ClarifyAnswer, ClarifyQuestion, ClarifyResult } from '@/utils/types';

/**
 * The Pretext Clarifier panel (optional Ctrl/Cmd+Shift+K flow).
 *
 * Shows 3-5 AI-generated questions before the prompt is built. Each question
 * offers 2-3 suggested-answer chips plus a free-text field. The answers are
 * fed back into the optimize call so the engineered prompt is scaled to the
 * user's real intent (a detailed spec for "build an app", a light touch for a
 * quick request). "Skip" bypasses straight to generation.
 *
 * Keyboard model:
 *  - Tab / Shift+Tab .... move between chips, inputs, and buttons (native)
 *  - Enter on a chip .... select it
 *  - Cmd/Ctrl + Enter ... Continue from anywhere
 *  - Escape ............. cancel (host input left untouched)
 */

export interface QuestionsHandlers {
  onSubmit: (answers: ClarifyAnswer[]) => void;
  onSkip: () => void;
  onCancel: () => void;
}

interface QItem {
  q: ClarifyQuestion;
  answer: string;
  chips: HTMLButtonElement[];
  input: HTMLInputElement;
}

export class PretextQuestions {
  private panel: HTMLDivElement;
  private items: QItem[] = [];
  private destroyed = false;

  private readonly onScrollOrResize = () => this.reposition();

  constructor(
    private container: HTMLElement,
    private getAnchorRect: () => DOMRect | null,
    result: ClarifyResult,
    private handlers: QuestionsHandlers,
  ) {
    this.panel = document.createElement('div');
    this.panel.className = 'px-panel';
    this.panel.tabIndex = -1;

    this.panel.appendChild(this.buildHeader());

    const list = document.createElement('div');
    list.className = 'px-q-list';
    for (const q of result.questions) list.appendChild(this.buildQuestion(q));
    this.panel.appendChild(list);

    this.panel.appendChild(this.buildFooter());

    this.panel.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('scroll', this.onScrollOrResize, { capture: true, passive: true });
    window.addEventListener('resize', this.onScrollOrResize, { passive: true });

    this.container.appendChild(this.panel);
    this.reposition();
    this.panel.focus();
  }

  // -- construction ---------------------------------------------------------

  private buildHeader(): HTMLDivElement {
    const header = document.createElement('div');
    header.className = 'px-header';

    const brand = document.createElement('div');
    brand.className = 'px-brand';
    brand.innerHTML =
      '<span class="px-logo">✦</span><span class="px-brand-name">Pretext</span>' +
      '<span class="px-brand-sub">Answer what helps — or Skip</span>';
    header.appendChild(brand);

    const close = document.createElement('button');
    close.className = 'px-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Cancel (Esc)');
    close.textContent = '✕';
    close.addEventListener('click', () => this.cancel());
    header.appendChild(close);

    return header;
  }

  private buildQuestion(q: ClarifyQuestion): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'px-q';

    const text = document.createElement('div');
    text.className = 'px-q-text';
    text.textContent = q.question;
    wrap.appendChild(text);

    const item: QItem = { q, answer: '', chips: [], input: document.createElement('input') };

    if (q.suggestions.length > 0) {
      const chipsRow = document.createElement('div');
      chipsRow.className = 'px-chips';
      q.suggestions.forEach((s) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'px-chip';
        chip.textContent = s;
        chip.addEventListener('click', (e) => {
          e.preventDefault();
          this.selectChip(item, s);
        });
        item.chips.push(chip);
        chipsRow.appendChild(chip);
      });
      wrap.appendChild(chipsRow);
    }

    const input = item.input;
    input.type = 'text';
    input.className = 'px-q-input';
    input.placeholder = q.suggestions.length > 0 ? 'Or type your own…' : 'Type your answer…';
    input.addEventListener('input', () => {
      item.answer = input.value;
      this.markChips(item, null);
    });
    wrap.appendChild(input);

    this.items.push(item);
    return wrap;
  }

  private buildFooter(): HTMLDivElement {
    const footer = document.createElement('div');
    footer.className = 'px-footer';

    const hints = document.createElement('div');
    hints.className = 'px-hints';
    hints.innerHTML =
      '<span><kbd>Tab</kbd> move</span>' +
      '<span><kbd>⌘/Ctrl</kbd><kbd>↵</kbd> continue</span>' +
      '<span><kbd>Esc</kbd> cancel</span>';
    footer.appendChild(hints);

    const actions = document.createElement('div');
    actions.className = 'px-actions';

    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'px-skip';
    skip.textContent = 'Skip';
    skip.addEventListener('click', () => this.skip());
    actions.appendChild(skip);

    const cont = document.createElement('button');
    cont.type = 'button';
    cont.className = 'px-insert';
    cont.innerHTML = 'Continue <kbd>↵</kbd>';
    cont.addEventListener('click', () => this.submit());
    actions.appendChild(cont);

    footer.appendChild(actions);
    return footer;
  }

  // -- answer state ---------------------------------------------------------

  private selectChip(item: QItem, value: string): void {
    item.answer = value;
    item.input.value = '';
    this.markChips(item, item.q.suggestions.indexOf(value));
  }

  private markChips(item: QItem, activeIdx: number | null): void {
    item.chips.forEach((c, i) => c.classList.toggle('px-chip-active', i === activeIdx));
  }

  private collect(): ClarifyAnswer[] {
    return this.items
      .map((it) => ({ question: it.q.question, answer: it.answer.trim() }))
      .filter((a) => a.answer.length > 0);
  }

  // -- keyboard -------------------------------------------------------------

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.cancel();
      return;
    }
    if (e.key === 'Enter') {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        this.submit();
        return;
      }
      // Let a focused chip / Skip / Continue button handle Enter natively.
      if (e.target instanceof HTMLButtonElement) return;
      // In a text field (or on the bare panel) a plain Enter shouldn't submit
      // the host page's form; swallow it.
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // -- lifecycle ------------------------------------------------------------

  reposition(): void {
    if (this.destroyed) return;
    const rect = this.getAnchorRect();
    if (!rect) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(Math.max(rect.width || 560, 560), 720, vw - 16);
    const left = Math.max(8, Math.min(rect.left, vw - width - 8));

    this.panel.style.width = `${width}px`;
    this.panel.style.left = `${left}px`;

    const panelH = this.panel.offsetHeight || 220;
    const below = rect.bottom + 8;
    if (below + panelH <= vh - 8 || rect.top < panelH + 16) {
      this.panel.style.top = `${Math.min(below, vh - panelH - 8)}px`;
    } else {
      this.panel.style.top = `${Math.max(8, rect.top - panelH - 8)}px`;
    }
    this.panel.style.bottom = 'auto';
  }

  private submit(): void {
    if (this.destroyed) return;
    const answers = this.collect();
    this.destroy();
    this.handlers.onSubmit(answers);
  }

  private skip(): void {
    if (this.destroyed) return;
    this.destroy();
    this.handlers.onSkip();
  }

  private cancel(): void {
    if (this.destroyed) return;
    this.destroy();
    this.handlers.onCancel();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    window.removeEventListener('scroll', this.onScrollOrResize, { capture: true } as EventListenerOptions);
    window.removeEventListener('resize', this.onScrollOrResize);
    this.panel.removeEventListener('keydown', this.onKeyDown);
    this.panel.remove();
  }
}
