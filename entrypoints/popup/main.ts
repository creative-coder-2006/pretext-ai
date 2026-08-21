import './style.css';
import { browser } from 'wxt/browser';
import type { AuthState, BgRequest, BgResponse, Settings, UsageSummary } from '@/utils/types';

const app = document.getElementById('app')!;
const isMac = navigator.platform.toUpperCase().includes('MAC');
const shortcut = isMac ? '⌘K' : 'Ctrl+K';

async function send<T>(req: BgRequest): Promise<BgResponse<T>> {
  try {
    return (await browser.runtime.sendMessage(req)) as BgResponse<T>;
  } catch (e) {
    return { ok: false, error: { code: 'INTERNAL', message: String(e) } };
  }
}

async function load(): Promise<void> {
  const [stateRes, settingsRes] = await Promise.all([
    send<AuthState>({ type: 'auth.state' }),
    send<Settings>({ type: 'settings.get' }),
  ]);

  const state: AuthState = stateRes.ok
    ? stateRes.data
    : {
        configured: false,
        googleReady: false,
        signedIn: false,
        devMode: false,
        hasGroqKey: false,
      };
  const settings: Settings = settingsRes.ok ? settingsRes.data : { devMode: false, groqApiKey: '' };

  let usage: UsageSummary | null = null;
  if (state.signedIn) {
    const usageRes = await send<UsageSummary>({ type: 'usage.summary' });
    if (usageRes.ok) usage = usageRes.data;
  }

  render(state, settings, usage);
}

function render(state: AuthState, settings: Settings, usage: UsageSummary | null): void {
  app.innerHTML = `
    <header class="px-5 pt-5 pb-4 bg-gradient-to-br from-violet-600/30 via-indigo-600/15 to-transparent border-b border-white/5">
      <div class="flex items-center gap-2">
        <span class="text-violet-300 text-lg leading-none">✦</span>
        <h1 class="text-[17px] font-bold tracking-tight bg-gradient-to-r from-violet-300 to-indigo-300 bg-clip-text text-transparent">Pretext</h1>
      </div>
      <p class="mt-1 text-[12px] text-zinc-400">The inline AI prompt autocomplete engine</p>
    </header>

    <section class="px-5 py-4 border-b border-white/5">
      <div class="flex items-center justify-between rounded-xl bg-white/[0.04] border border-white/10 px-4 py-3">
        <div>
          <p class="text-[12.5px] font-medium text-zinc-200">Optimize any prompt, inline</p>
          <p class="mt-0.5 text-[11.5px] text-zinc-500">Click into an AI chat box, type a rough idea…</p>
        </div>
        <kbd class="text-zinc-300">${shortcut}</kbd>
      </div>
    </section>

    <section id="auth-section" class="px-5 py-4 border-b border-white/5"></section>

    <section class="px-5 py-4 border-b border-white/5">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-[12.5px] font-medium text-zinc-200">Developer mode</p>
          <p class="mt-0.5 text-[11px] text-zinc-500 leading-snug">Call Groq directly with your own API key.<br/>Key never leaves this device.</p>
        </div>
        <input id="devmode-toggle" type="checkbox" class="toggle" ${settings.devMode ? 'checked' : ''} />
      </div>
      <div id="devmode-fields" class="${settings.devMode ? '' : 'hidden'} mt-3 space-y-2">
        <input id="groq-key" type="password" placeholder="gsk_… Groq API key"
          value="${escapeAttr(settings.groqApiKey)}"
          class="w-full rounded-lg bg-white/[0.05] border border-white/10 px-3 py-2 text-[12.5px] text-zinc-100 placeholder-zinc-600 outline-none focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/20" />
        <button id="save-key" class="w-full rounded-lg bg-violet-600 hover:bg-violet-500 px-3 py-2 text-[12.5px] font-semibold text-white transition-colors">Save key</button>
        <p id="save-status" class="hidden text-[11px] text-emerald-400">Saved ✓</p>
      </div>
    </section>

    <footer class="px-5 py-3 flex items-center justify-between">
      <span class="text-[10.5px] text-zinc-600">v0.1.0 · gpt-oss-120b on Groq</span>
      <span class="text-[10.5px] text-zinc-600">Made for ChatGPT · Claude · Gemini</span>
    </footer>
  `;

  renderAuth(state, usage);

  const toggle = document.getElementById('devmode-toggle') as HTMLInputElement;
  const fields = document.getElementById('devmode-fields')!;
  toggle.addEventListener('change', async () => {
    fields.classList.toggle('hidden', !toggle.checked);
    await send({ type: 'settings.set', settings: { devMode: toggle.checked } });
  });

  document.getElementById('save-key')!.addEventListener('click', async () => {
    const key = (document.getElementById('groq-key') as HTMLInputElement).value.trim();
    await send({ type: 'settings.set', settings: { groqApiKey: key } });
    const status = document.getElementById('save-status')!;
    status.classList.remove('hidden');
    setTimeout(() => status.classList.add('hidden'), 1800);
  });
}

function renderAuth(state: AuthState, usage: UsageSummary | null): void {
  const section = document.getElementById('auth-section')!;

  if (!state.configured) {
    section.innerHTML = `
      <p class="text-[12.5px] font-medium text-zinc-200">Account</p>
      <p class="mt-1 text-[11.5px] text-zinc-500 leading-snug">
        This build has no Supabase backend configured, so Google sign-in is off.
        Use <span class="text-zinc-300">developer mode</span> below, or set the
        <code class="text-violet-300">WXT_SUPABASE_*</code> env vars and rebuild.
      </p>`;
    return;
  }

  if (!state.signedIn) {
    section.innerHTML = `
      <p class="text-[12.5px] font-medium text-zinc-200 mb-2.5">Account</p>
      <button id="signin" class="w-full flex items-center justify-center gap-2.5 rounded-lg bg-white text-zinc-900 hover:bg-zinc-200 px-3 py-2.5 text-[13px] font-semibold transition-colors">
        ${googleLogoSvg()} Sign in with Google
      </button>
      <p id="signin-error" class="hidden mt-2 text-[11px] text-rose-400"></p>`;
    document.getElementById('signin')!.addEventListener('click', async () => {
      const btn = document.getElementById('signin') as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = 'Opening Google…';
      const res = await send<AuthState>({ type: 'auth.signIn' });
      if (res.ok) {
        await load();
      } else {
        const err = document.getElementById('signin-error')!;
        err.textContent = res.error.message;
        err.classList.remove('hidden');
        btn.disabled = false;
        btn.innerHTML = `${googleLogoSvg()} Sign in with Google`;
      }
    });
    return;
  }

  const tier = (state.tier ?? 'free').toUpperCase();
  section.innerHTML = `
    <div class="flex items-center justify-between">
      <div class="min-w-0">
        <p class="text-[12.5px] font-medium text-zinc-200 truncate">${escapeHtml(state.email ?? 'Signed in')}</p>
        <span class="inline-block mt-1 rounded-full bg-violet-500/15 border border-violet-400/30 px-2 py-0.5 text-[10px] font-bold tracking-wider text-violet-300">${tier}</span>
      </div>
      <button id="signout" class="text-[11.5px] text-zinc-500 hover:text-zinc-300 transition-colors">Sign out</button>
    </div>
    ${
      usage
        ? `<div class="mt-3 grid grid-cols-3 gap-2 text-center">
            <div class="rounded-lg bg-white/[0.04] border border-white/10 py-2">
              <p class="text-[15px] font-bold text-zinc-100">${usage.today}</p>
              <p class="text-[10px] text-zinc-500">today</p>
            </div>
            <div class="rounded-lg bg-white/[0.04] border border-white/10 py-2">
              <p class="text-[15px] font-bold text-zinc-100">${usage.total}</p>
              <p class="text-[10px] text-zinc-500">all time</p>
            </div>
            <div class="rounded-lg bg-white/[0.04] border border-white/10 py-2">
              <p class="text-[15px] font-bold text-zinc-100">${formatTokens(usage.promptTokens + usage.completionTokens)}</p>
              <p class="text-[10px] text-zinc-500">tokens</p>
            </div>
          </div>`
        : ''
    }`;
  document.getElementById('signout')!.addEventListener('click', async () => {
    await send({ type: 'auth.signOut' });
    await load();
  });
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function googleLogoSvg(): string {
  return `<svg width="15" height="15" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.7-.4-4z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.7l6.2 5.2C36.9 40.4 44 35 44 24c0-1.3-.1-2.7-.4-4z"/></svg>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

void load();
