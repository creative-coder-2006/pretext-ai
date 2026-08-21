import type { OptimizeResult } from '@/utils/types';

/**
 * The Pretext Inline Canvas (PRD §2).
 *
 * Renders the AI-restructured prompt as flowing text where each missing
 * detail is an interactive, highlighted token pill. Focusing a pill opens an
 * instant floating dropdown with 3 AI-generated options plus a 4th
 * "Type custom answer..." input.
 *
 * Keyboard model:
 *  - Tab / Shift+Tab .... next / previous pill (skip)
 *  - Arrow Up / Down .... move through the active pill's options (instant-apply)
 *  - Arrow Left / Right . previous / next pill
 *  - Enter .............. inject the completed prompt into the host input
 *  - Escape ............. cancel (host input is left untouched)
 */

interface Segment {
  kind: 'text' | 'var';
  value: string; // text content, or the variable key
}

interface Slot {
  key: string;
  options: string[];
  value: string;
  /** 0..2 = option index, 'custom' = custom answer, null = nothing yet. */
  selected: number | 'custom' | null;
}

export interface CanvasHandlers {
  onCommit: (finalText: string) => void;
  onCancel: () => void;
}

export class PretextCanvas {
  private panel: HTMLDivElement;
  private flowEl: HTMLDivElement;
  private sideEl: HTMLDivElement;
  private dropdownEl: HTMLDivElement | null = null;
  private customInput: HTMLInputElement | null = null;

  private segments: Segment[] = [];
  private slots = new Map<string, Slot>();
  private pills: { key: string; el: HTMLButtonElement }[] = [];
  private active = -1;
  private destroyed = false;

  private readonly onScrollOrResize = () => this.reposition();

  constructor(
    private container: HTMLElement,
    private getAnchorRect: () => DOMRect | null,
    result: OptimizeResult,
    private handlers: CanvasHandlers,
  ) {
    this.parseTemplate(result);

    this.panel = document.createElement('div');
    this.panel.className = 'px-panel';
    this.panel.tabIndex = -1;

    this.panel.appendChild(this.buildHeader());

    // Two-column body: the full prompt on the left, and the active field's
    // options docked in a fixed column on the right — so the whole prompt and
    // the options are always visible at once and never overlap.
    const body = document.createElement('div');
    body.className = 'px-body';
    this.flowEl = this.buildFlow();
    this.sideEl = this.buildSide();
    body.appendChild(this.flowEl);
    body.appendChild(this.sideEl);
    this.panel.appendChild(body);

    this.panel.appendChild(this.buildFooter());

    this.panel.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('scroll', this.onScrollOrResize, { capture: true, passive: true });
    window.addEventListener('resize', this.onScrollOrResize, { passive: true });

    this.container.appendChild(this.panel);
    this.reposition();

    // Open in "preview" mode: show the full optimized prompt with the AI's
    // default choices already filled into every pill, and DO NOT auto-open a
    // dropdown. The user reads the whole prompt first, then Tabs / arrows into
    // a field to change it — which opens that field's options on demand.
    this.panel.focus();
  }

  // -- construction ---------------------------------------------------------

  private parseTemplate(result: OptimizeResult): void {
    const template = result.structuredTemplate;
    const re = /\[([^\[\]\n]{1,60}?)\]/g;
    let last = 0;
    for (const m of template.matchAll(re)) {
      const idx = m.index ?? 0;
      if (idx > last) this.segments.push({ kind: 'text', value: template.slice(last, idx) });
      const key = m[1].trim();
      this.segments.push({ kind: 'var', value: key });
      if (!this.slots.has(key)) {
        const options = (result.variables[key] ?? []).slice(0, 3);
        this.slots.set(key, {
          key,
          options,
          // Pre-fill with the AI's first suggestion so the canvas is always
          // commit-ready; the user tabs through to adjust what they care about.
          value: options[0] ?? '',
          selected: options.length > 0 ? 0 : null,
        });
      }
      last = idx + m[0].length;
    }
    if (last < template.length) this.segments.push({ kind: 'text', value: template.slice(last) });
  }

  private buildHeader(): HTMLDivElement {
    const header = document.createElement('div');
    header.className = 'px-header';

    const brand = document.createElement('div');
    brand.className = 'px-brand';
    brand.innerHTML =
      '<span class="px-logo">✦</span><span class="px-brand-name">Pretext</span>' +
      '<span class="px-brand-sub">Tab through the fields, then press Enter</span>';
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

  private buildFlow(): HTMLDivElement {
    const flow = document.createElement('div');
    flow.className = 'px-flow';

    for (const seg of this.segments) {
      if (seg.kind === 'text') {
        const span = document.createElement('span');
        span.textContent = seg.value;
        flow.appendChild(span);
      } else {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'px-pill';
        pill.dataset.key = seg.value;
        const index = this.pills.length;
        pill.addEventListener('click', (e) => {
          e.preventDefault();
          this.activatePill(index);
        });
        this.pills.push({ key: seg.value, el: pill });
        this.updatePillLabel(pill, this.slots.get(seg.value)!);
        flow.appendChild(pill);
      }
    }
    return flow;
  }

  private buildSide(): HTMLDivElement {
    const side = document.createElement('div');
    side.className = 'px-side';
    side.appendChild(this.sidePlaceholder());
    return side;
  }

  /** Placeholder shown in the options column before any field is entered. */
  private sidePlaceholder(): HTMLDivElement {
    const ph = document.createElement('div');
    ph.className = 'px-side-empty';
    ph.innerHTML =
      '<span class="px-side-empty-icon">✦</span>' +
      '<span>Press <kbd>Tab</kbd> to step into a field and pick from its options.</span>';
    return ph;
  }

  private buildFooter(): HTMLDivElement {
    const footer = document.createElement('div');
    footer.className = 'px-footer';

    const hints = document.createElement('div');
    hints.className = 'px-hints';
    hints.innerHTML =
      '<span><kbd>Tab</kbd> next</span>' +
      '<span><kbd>↑</kbd><kbd>↓</kbd> options</span>' +
      '<span><kbd>Enter</kbd> insert</span>' +
      '<span><kbd>Esc</kbd> cancel</span>';
    footer.appendChild(hints);

    const insert = document.createElement('button');
    insert.type = 'button';
    insert.className = 'px-insert';
    insert.innerHTML = 'Insert <kbd>↵</kbd>';
    insert.addEventListener('click', () => this.commit());
    footer.appendChild(insert);

    return footer;
  }

  // -- pill + dropdown state ------------------------------------------------

  private updatePillLabel(pill: HTMLButtonElement, slot: Slot): void {
    const filled = slot.value.trim().length > 0;
    pill.textContent = filled ? slot.value : slot.key.replace(/_/g, ' ');
    pill.classList.toggle('px-pill-empty', !filled);
  }

  private refreshPillsForKey(key: string): void {
    const slot = this.slots.get(key);
    if (!slot) return;
    for (const p of this.pills) {
      if (p.key === key) this.updatePillLabel(p.el, slot);
    }
  }

  private activatePill(index: number): void {
    if (this.pills.length === 0) return;
    const n = this.pills.length;
    this.active = ((index % n) + n) % n;
    this.pills.forEach((p, i) => p.el.classList.toggle('px-pill-active', i === this.active));
    const { el } = this.pills[this.active];
    el.focus({ preventScroll: true });
    this.scrollActivePillIntoView();
    this.openDropdown();
  }

  private activeSlot(): Slot | null {
    if (this.active < 0 || this.active >= this.pills.length) return null;
    return this.slots.get(this.pills[this.active].key) ?? null;
  }

  /** Render the active field's options into the docked right-hand column. */
  private openDropdown(): void {
    const slot = this.activeSlot();
    if (!slot) return;

    const dd = document.createElement('div');
    dd.className = 'px-dropdown';

    const title = document.createElement('div');
    title.className = 'px-dd-title';
    title.textContent = slot.key.replace(/_/g, ' ');
    dd.appendChild(title);

    slot.options.forEach((opt, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'px-dd-option';
      row.classList.toggle('px-dd-selected', slot.selected === i);
      row.innerHTML = `<span class="px-dd-check">${slot.selected === i ? '✓' : ''}</span><span></span>`;
      (row.lastElementChild as HTMLSpanElement).textContent = opt;
      row.addEventListener('click', (e) => {
        e.preventDefault();
        this.applyOption(i);
        this.advanceOrStay();
      });
      dd.appendChild(row);
    });

    // 4th option is always the custom answer input (PRD §2.3).
    const customRow = document.createElement('div');
    customRow.className = 'px-dd-custom';
    customRow.classList.toggle('px-dd-selected', slot.selected === 'custom');
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Type custom answer…';
    input.value = slot.selected === 'custom' ? slot.value : '';
    input.addEventListener('input', () => {
      slot.value = input.value;
      slot.selected = 'custom';
      this.refreshPillsForKey(slot.key);
      this.markSelectedRows();
    });
    customRow.appendChild(input);
    dd.appendChild(customRow);
    this.customInput = input;

    this.dropdownEl = dd;
    this.sideEl.replaceChildren(dd);

    if (slot.options.length === 0) {
      // No AI options — go straight to the custom field.
      input.focus();
    }

    // The options column can be taller than a short prompt; re-anchor the panel
    // so one placed above the input doesn't grow down over it.
    this.reposition();
  }

  /** Keep the active pill visible within the (independently scrolling) prompt. */
  private scrollActivePillIntoView(): void {
    if (this.active < 0) return;
    const pill = this.pills[this.active].el;
    const flow = this.flowEl;
    const top = pill.offsetTop;
    const bottom = top + pill.offsetHeight;
    if (top < flow.scrollTop + 8) {
      flow.scrollTop = Math.max(0, top - 8);
    } else if (bottom > flow.scrollTop + flow.clientHeight - 8) {
      flow.scrollTop = bottom - flow.clientHeight + 8;
    }
  }

  private markSelectedRows(): void {
    if (!this.dropdownEl) return;
    const slot = this.activeSlot();
    if (!slot) return;
    const rows = this.dropdownEl.querySelectorAll<HTMLButtonElement>('.px-dd-option');
    rows.forEach((row, i) => {
      row.classList.toggle('px-dd-selected', slot.selected === i);
      const check = row.querySelector('.px-dd-check');
      if (check) check.textContent = slot.selected === i ? '✓' : '';
    });
    this.dropdownEl
      .querySelector('.px-dd-custom')
      ?.classList.toggle('px-dd-selected', slot.selected === 'custom');
  }

  private applyOption(i: number): void {
    const slot = this.activeSlot();
    if (!slot || i < 0 || i >= slot.options.length) return;
    slot.value = slot.options[i];
    slot.selected = i;
    this.refreshPillsForKey(slot.key);
    this.markSelectedRows();
  }

  private advanceOrStay(): void {
    if (this.active < this.pills.length - 1) this.activatePill(this.active + 1);
    else this.pills[this.active]?.el.focus({ preventScroll: true });
  }

  // -- keyboard -------------------------------------------------------------

  private onKeyDown = (e: KeyboardEvent): void => {
    const inCustom = this.customInput !== null && e.target === this.customInput;

    switch (e.key) {
      case 'Escape': {
        e.preventDefault();
        e.stopPropagation();
        if (inCustom) {
          // First Esc backs out of the custom field; second cancels.
          this.pills[this.active]?.el.focus({ preventScroll: true });
        } else {
          this.cancel();
        }
        return;
      }
      case 'Enter': {
        e.preventDefault();
        e.stopPropagation();
        if (inCustom) {
          // Confirm the custom answer, then move on (PRD: "types custom answers").
          this.advanceOrStay();
        } else {
          this.commit();
        }
        return;
      }
      case 'Tab': {
        e.preventDefault();
        e.stopPropagation();
        if (this.pills.length === 0) return;
        // From the initial preview state (no pill active yet), the first Tab
        // enters the first field rather than skipping past it.
        if (this.active < 0) this.activatePill(0);
        else this.activatePill(this.active + (e.shiftKey ? -1 : 1));
        return;
      }
      case 'ArrowDown': {
        e.preventDefault();
        e.stopPropagation();
        if (this.active < 0) this.activatePill(0);
        else this.moveOption(1);
        return;
      }
      case 'ArrowUp': {
        e.preventDefault();
        e.stopPropagation();
        if (this.active < 0) this.activatePill(0);
        else this.moveOption(-1);
        return;
      }
      case 'ArrowRight':
      case 'ArrowLeft': {
        if (inCustom) return; // let the caret move inside the input
        e.preventDefault();
        e.stopPropagation();
        if (this.pills.length === 0) return;
        if (this.active < 0) this.activatePill(0);
        else this.activatePill(this.active + (e.key === 'ArrowRight' ? 1 : -1));
        return;
      }
      default:
        return;
    }
  };

  /** Move the highlighted option; rows 0..n-1 are options, row n is custom. */
  private moveOption(delta: number): void {
    const slot = this.activeSlot();
    if (!slot) return;
    const rows = slot.options.length + 1; // + custom row
    const inCustom = this.customInput !== null && document.activeElement !== null &&
      this.dropdownEl?.contains(this.customInput) === true &&
      this.customInput === (this.panel.getRootNode() as Document | ShadowRoot).activeElement;

    let current: number;
    if (inCustom) current = rows - 1;
    else if (slot.selected === 'custom') current = rows - 1;
    else if (typeof slot.selected === 'number') current = slot.selected;
    else current = -1;

    let next = current + delta;
    if (next < 0) next = rows - 1;
    if (next > rows - 1) next = 0;

    if (next === rows - 1) {
      // Land on the custom input row.
      slot.selected = 'custom';
      this.markSelectedRows();
      this.customInput?.focus();
    } else {
      this.pills[this.active]?.el.focus({ preventScroll: true });
      this.applyOption(next);
    }
  }

  // -- lifecycle ------------------------------------------------------------

  reposition(): void {
    if (this.destroyed) return;
    const rect = this.getAnchorRect();
    if (!rect) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Wide enough to hold the prompt column plus the docked options column.
    const width = Math.min(Math.max(rect.width || 560, 680), 880, vw - 16);
    const left = Math.max(8, Math.min(rect.left, vw - width - 8));

    this.panel.style.width = `${width}px`;
    this.panel.style.left = `${left}px`;

    const panelH = this.panel.offsetHeight || 200;
    const below = rect.bottom + 8;
    if (below + panelH <= vh - 8 || rect.top < panelH + 16) {
      this.panel.style.top = `${Math.min(below, vh - panelH - 8)}px`;
      this.panel.style.bottom = 'auto';
    } else {
      this.panel.style.top = `${Math.max(8, rect.top - panelH - 8)}px`;
      this.panel.style.bottom = 'auto';
    }
  }

  buildFinalText(): string {
    let out = '';
    for (const seg of this.segments) {
      if (seg.kind === 'text') {
        out += seg.value;
      } else {
        const slot = this.slots.get(seg.value);
        const v = slot?.value.trim() ?? '';
        out += v.length > 0 ? v : `[${seg.value}]`;
      }
    }
    return out.trim();
  }

  private commit(): void {
    if (this.destroyed) return;
    const text = this.buildFinalText();
    this.destroy();
    this.handlers.onCommit(text);
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
