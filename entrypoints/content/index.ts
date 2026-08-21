import './style.css';
import { browser } from 'wxt/browser';
import type { BgResponse, ClarifyAnswer, ClarifyResult, OptimizeResult } from '@/utils/types';
import { PretextCanvas } from './canvas';
import { PretextQuestions } from './questions';
import {
  findEditable,
  readText,
  targetAlive,
  targetRect,
  writeText,
  type EditableTarget,
} from './editable';

const OPTIMIZE_TIMEOUT_MS = 15_000;

export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    let ui: Awaited<ReturnType<typeof createShadowRootUi<HTMLElement>>> | null = null;
    let uiContainer: HTMLElement | null = null;
    let uiPending: Promise<HTMLElement> | null = null;

    /** Active session: either the loading shimmer or the open canvas. */
    let session: {
      target: EditableTarget;
      canvas: PretextCanvas | null;
      questions: PretextQuestions | null;
      loadingEl: HTMLElement | null;
      cancelled: boolean;
    } | null = null;

    const isMac = navigator.platform.toUpperCase().includes('MAC');

    function ensureUi(): Promise<HTMLElement> {
      if (uiContainer) return Promise.resolve(uiContainer);
      // Cache the in-flight build so concurrent callers (two fast Ctrl+K
      // presses, or a toast firing alongside a session) share a single shadow
      // root instead of each mounting their own overlay.
      if (!uiPending) {
        uiPending = (async () => {
          ui = await createShadowRootUi(ctx, {
            name: 'pretext-ui',
            position: 'overlay',
            anchor: 'body',
            zIndex: 2147483647,
            // Keep keystrokes and clicks inside the canvas from leaking to the
            // host page (ChatGPT and friends have global key/click handlers that
            // would steal focus back). Events still work inside the shadow tree;
            // WXT stops them at the shadow boundary.
            isolateEvents: [
              'keydown',
              'keyup',
              'keypress',
              'input',
              'pointerdown',
              'mousedown',
              'mouseup',
              'click',
            ],
            onMount(container) {
              container.classList.add('px-root');
              return container;
            },
          });
          ui.mount();
          uiContainer = ui.uiContainer;
          return uiContainer;
        })().catch((e: unknown) => {
          // Never cache a failed mount, or every later Ctrl+K replays the same
          // rejection — reset so the next trigger can retry.
          uiPending = null;
          throw e;
        });
      }
      return uiPending;
    }

    function endSession(restoreFocus: boolean): void {
      if (!session) return;
      session.cancelled = true;
      session.canvas?.destroy();
      session.questions?.destroy();
      session.loadingEl?.remove();
      const target = session.target;
      session = null;
      if (restoreFocus && targetAlive(target)) target.el.focus();
    }

    // ------------------------------------------------------------------
    // The Interception (PRD §2.1): manual Cmd/Ctrl+K only — Pretext never
    // listens to or captures any other keystrokes (PRD §6 privacy guardrail).
    // ------------------------------------------------------------------
    const onKeyDown = (e: KeyboardEvent): void => {
      const modifier = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      const isK = e.key === 'k' || e.key === 'K';
      // Cmd/Ctrl+K = ask a few questions first (Skip in the panel goes straight
      // through); Cmd/Ctrl+Shift+K = skip the questions and jump to the canvas.
      const askCombo = isK && modifier && !e.shiftKey && !e.altKey;
      const quickCombo = isK && modifier && e.shiftKey && !e.altKey;

      if (session) {
        // While a session is open the canvas/questions panel owns the keyboard.
        // Swallow either trigger combo and Escape in case focus drifted to the page.
        if (askCombo || quickCombo) {
          e.preventDefault();
          e.stopPropagation();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          endSession(true);
        }
        return;
      }

      if (!askCombo && !quickCombo) return;

      const target = findEditable(document.activeElement);
      if (!target) return; // Not our context — let the page keep its shortcut.

      e.preventDefault();
      e.stopImmediatePropagation();

      const text = readText(target).trim();
      if (!text) {
        void showToast('Type a rough prompt first, then press ' + (isMac ? '⌘K' : 'Ctrl+K'));
        return;
      }
      if (askCombo) void startClarifySession(target, text);
      else void startSession(target, text);
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    ctx.onInvalidated(() => {
      window.removeEventListener('keydown', onKeyDown, { capture: true } as EventListenerOptions);
    });

    // Clicking anywhere on the host page while the canvas is open cancels it.
    const onPointerDown = (e: Event): void => {
      if (!session) return;
      if (ui && e.composedPath().includes(ui.shadowHost)) return;
      endSession(false);
    };
    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    ctx.onInvalidated(() => {
      document.removeEventListener('pointerdown', onPointerDown, { capture: true } as EventListenerOptions);
    });

    // ------------------------------------------------------------------
    // Session: loading shimmer -> (optional questions) -> canvas -> inject
    // ------------------------------------------------------------------

    /** Claim the session synchronously, before any await, so a second trigger
     * fired while a call is still in flight is rejected by the `if (session)`
     * guard in onKeyDown instead of starting a parallel one. */
    function claimSession(target: EditableTarget): NonNullable<typeof session> {
      const current: NonNullable<typeof session> = {
        target,
        canvas: null,
        questions: null,
        loadingEl: null,
        cancelled: false,
      };
      session = current;
      return current;
    }

    function showLoading(
      container: HTMLElement,
      target: EditableTarget,
      label: string,
    ): HTMLElement {
      const loadingEl = document.createElement('div');
      loadingEl.className = 'px-loading';
      loadingEl.innerHTML =
        '<span class="px-logo">✦</span><span></span>' +
        '<span class="px-dots"><i></i><i></i><i></i></span>';
      (loadingEl.children[1] as HTMLElement).textContent = label;
      container.appendChild(loadingEl);
      positionLoading(loadingEl, target);
      return loadingEl;
    }

    function withTimeout<T>(p: Promise<T>): Promise<T> {
      return Promise.race([
        p,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), OPTIMIZE_TIMEOUT_MS),
        ),
      ]);
    }

    /** Quick path: Cmd/Ctrl+K straight to the canvas. */
    async function startSession(target: EditableTarget, text: string): Promise<void> {
      const current = claimSession(target);
      const container = await ensureUi();
      if (session !== current || current.cancelled) return;
      await runOptimize(current, container, target, text);
    }

    /** Clarify path: Cmd/Ctrl+Shift+K asks a few questions first. */
    async function startClarifySession(target: EditableTarget, text: string): Promise<void> {
      const current = claimSession(target);
      const container = await ensureUi();
      if (session !== current || current.cancelled) return;

      current.loadingEl = showLoading(container, target, 'Pretext is thinking of a few questions');

      let response: BgResponse<ClarifyResult>;
      try {
        response = await withTimeout(
          browser.runtime.sendMessage({ type: 'clarify', text }) as Promise<BgResponse<ClarifyResult>>,
        );
      } catch (err) {
        console.debug('[pretext] clarify failed:', err);
        if (session === current && !current.cancelled) {
          endSession(true);
          void showToast('Pretext couldn’t reach the engine — your text is untouched.');
        }
        return;
      }

      if (session !== current || current.cancelled || current.target !== target) return;
      current.loadingEl?.remove();
      current.loadingEl = null;

      if (!response || response.ok !== true) {
        const error = response && 'error' in response ? response.error : undefined;
        console.debug('[pretext] clarify error:', error);
        endSession(true);
        void showToast(errorToast(error?.code, isMac));
        return;
      }

      // No usable questions — behave like the quick path.
      if (response.data.questions.length === 0) {
        await runOptimize(current, container, target, text);
        return;
      }

      current.questions = new PretextQuestions(
        container,
        () => (targetAlive(target) ? targetRect(target) : null),
        response.data,
        {
          onSubmit(answers) {
            current.questions = null;
            void runOptimize(current, container, target, text, answers);
          },
          onSkip() {
            current.questions = null;
            void runOptimize(current, container, target, text);
          },
          onCancel() {
            session = null;
            if (targetAlive(target)) target.el.focus();
          },
        },
      );
    }

    /** Shared tail: loading -> optimize -> interactive canvas -> inject. */
    async function runOptimize(
      current: NonNullable<typeof session>,
      container: HTMLElement,
      target: EditableTarget,
      text: string,
      context?: ClarifyAnswer[],
    ): Promise<void> {
      current.loadingEl = showLoading(container, target, 'Pretext is structuring your prompt');

      let response: BgResponse<OptimizeResult>;
      try {
        response = await withTimeout(
          browser.runtime.sendMessage({ type: 'optimize', text, context }) as Promise<
            BgResponse<OptimizeResult>
          >,
        );
      } catch (err) {
        // Graceful degrade (PRD §6): quietly log, restore the user's flow.
        console.debug('[pretext] optimize failed:', err);
        if (session === current && !current.cancelled) {
          endSession(true);
          void showToast('Pretext couldn’t reach the engine — your text is untouched.');
        }
        return;
      }

      if (session !== current || current.cancelled || current.target !== target) return;
      current.loadingEl?.remove();
      current.loadingEl = null;

      if (!response || response.ok !== true) {
        const error = response && 'error' in response ? response.error : undefined;
        console.debug('[pretext] optimize error:', error);
        endSession(true);
        void showToast(errorToast(error?.code, isMac));
        return;
      }

      // The Transformation (PRD §2.2): show the inline canvas.
      current.canvas = new PretextCanvas(
        container,
        () => (targetAlive(target) ? targetRect(target) : null),
        response.data,
        {
          onCommit(finalText) {
            session = null;
            // The Completion (PRD §2.4): inject the engineered prompt back
            // into the native input box.
            writeText(target, finalText);
          },
          onCancel() {
            session = null;
            if (targetAlive(target)) target.el.focus();
          },
        },
      );
    }

    function positionLoading(el: HTMLElement, target: EditableTarget): void {
      const rect = targetRect(target);
      const top = Math.min(rect.bottom + 8, window.innerHeight - 56);
      el.style.top = `${Math.max(8, top)}px`;
      el.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 320))}px`;
    }

    async function showToast(message: string): Promise<void> {
      const container = await ensureUi();
      const toast = document.createElement('div');
      toast.className = 'px-toast';
      toast.textContent = message;
      container.appendChild(toast);
      requestAnimationFrame(() => toast.classList.add('px-toast-show'));
      setTimeout(() => {
        toast.classList.remove('px-toast-show');
        setTimeout(() => toast.remove(), 250);
      }, 2_800);
    }
  },
});

function errorToast(code: string | undefined, isMac: boolean): string {
  switch (code) {
    case 'AUTH_REQUIRED':
      return 'Sign in to Pretext: click the ✦ icon in your toolbar.';
    case 'NOT_CONFIGURED':
      return 'Pretext needs setup: open the toolbar popup and add a Groq API key.';
    case 'RATE_LIMITED':
      return 'Pretext rate limit reached — try again shortly.';
    case 'EMPTY_TEXT':
      return 'Type a rough prompt first, then press ' + (isMac ? '⌘K' : 'Ctrl+K');
    default:
      return 'Pretext couldn’t optimize — your text is untouched.';
  }
}
