import { browser } from 'wxt/browser';
import { CONFIG, hasBackend, hasGoogleAuth } from '@/utils/config';
import {
  callGroqClarify,
  callGroqDirect,
  GroqError,
  parseClarifyContent,
  parseOptimizeContent,
} from '@/utils/groq';
import { getSupabase } from '@/utils/supabase';
import type {
  AuthState,
  BgError,
  BgRequest,
  BgResponse,
  ClarifyAnswer,
  ClarifyResult,
  ErrorCode,
  OptimizeResult,
  Settings,
  UsageSummary,
} from '@/utils/types';

const SETTINGS_KEY = 'pretext.settings';
const DEFAULT_SETTINGS: Settings = { devMode: false, groqApiKey: '' };

export default defineBackground(() => {
  // Callback + `return true` pattern: works with both promise-based and
  // callback-based runtimes, and keeps the worker alive until we respond.
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    handleMessage(message as BgRequest)
      .then((res) => sendResponse(res))
      .catch((e: unknown) =>
        sendResponse(fail('INTERNAL', e instanceof Error ? e.message : String(e))),
      );
    return true;
  });
});

async function handleMessage(msg: BgRequest): Promise<BgResponse<unknown>> {
  switch (msg?.type) {
    case 'optimize':
      return optimize(msg.text, msg.context);
    case 'clarify':
      return clarify(msg.text);
    case 'auth.signIn':
      return signIn();
    case 'auth.signOut':
      return signOut();
    case 'auth.state':
      return ok(await getAuthState());
    case 'usage.summary':
      return usageSummary();
    case 'settings.get':
      return ok(await getSettings());
    case 'settings.set':
      return ok(await setSettings(msg.settings));
    default:
      return fail('INTERNAL', `Unknown message type: ${String((msg as { type?: string })?.type)}`);
  }
}

function ok<T>(data: T): BgResponse<T> {
  return { ok: true, data };
}

function fail(code: ErrorCode, message: string): BgResponse<never> {
  return { ok: false, error: { code, message } satisfies BgError };
}

// ---------------------------------------------------------------------------
// Settings (chrome.storage.local)
// ---------------------------------------------------------------------------

async function getSettings(): Promise<Settings> {
  const rec = await browser.storage.local.get(SETTINGS_KEY);
  const stored = rec[SETTINGS_KEY] as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

// ---------------------------------------------------------------------------
// The core optimize call (PRD §5)
// ---------------------------------------------------------------------------

async function optimize(
  text: string,
  context?: ClarifyAnswer[],
): Promise<BgResponse<OptimizeResult>> {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return fail('EMPTY_TEXT', 'There is no text to optimize.');
  if (trimmed.length > 4000) {
    return fail('EMPTY_TEXT', 'Prompt is too long to optimize (4000 character limit).');
  }

  const settings = await getSettings();

  // Developer mode: direct Groq call with a personal key.
  if (settings.devMode && settings.groqApiKey) {
    try {
      const { result } = await callGroqDirect(settings.groqApiKey, trimmed, context);
      return ok(result);
    } catch (e) {
      return groqErrorToResponse(e);
    }
  }

  // Production mode: Supabase Edge Function proxy (protects the Groq key).
  if (!hasBackend()) {
    return fail(
      'NOT_CONFIGURED',
      'No backend configured. Open the Pretext popup and add a Groq API key (developer mode), or build with Supabase env vars.',
    );
  }

  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    return fail('AUTH_REQUIRED', 'Sign in with Google from the Pretext popup to start optimizing.');
  }

  let res: Response;
  try {
    res = await fetch(`${CONFIG.supabaseUrl}/functions/v1/optimize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        apikey: CONFIG.supabaseAnonKey,
      },
      body: JSON.stringify({ text: trimmed, context }),
    });
  } catch (e) {
    return fail('NETWORK', `Could not reach the Pretext backend: ${String(e)}`);
  }

  if (res.status === 401) return fail('AUTH_REQUIRED', 'Session expired. Sign in again.');
  if (res.status === 429) return fail('RATE_LIMITED', 'Daily free-tier limit reached.');
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return fail('UPSTREAM', `Backend error ${res.status}: ${body.slice(0, 300)}`);
  }

  try {
    const payload = await res.json();
    // The edge function returns { result: {...} }; tolerate a bare object too.
    const raw = payload?.result ?? payload;
    const result = parseOptimizeContent(typeof raw === 'string' ? raw : JSON.stringify(raw));
    return ok(result);
  } catch (e) {
    return groqErrorToResponse(e);
  }
}

function groqErrorToResponse(e: unknown): BgResponse<never> {
  if (e instanceof GroqError) return fail(e.code, e.message);
  return fail('INTERNAL', e instanceof Error ? e.message : String(e));
}

// ---------------------------------------------------------------------------
// The optional clarifier call (Ctrl/Cmd+Shift+K): ask questions before optimizing
// ---------------------------------------------------------------------------

async function clarify(text: string): Promise<BgResponse<ClarifyResult>> {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return fail('EMPTY_TEXT', 'There is no text to clarify.');
  if (trimmed.length > 4000) {
    return fail('EMPTY_TEXT', 'Prompt is too long to optimize (4000 character limit).');
  }

  const settings = await getSettings();

  // Developer mode: direct Groq call with a personal key.
  if (settings.devMode && settings.groqApiKey) {
    try {
      return ok(await callGroqClarify(settings.groqApiKey, trimmed));
    } catch (e) {
      return groqErrorToResponse(e);
    }
  }

  // Production mode: Supabase Edge Function proxy, "questions" mode.
  if (!hasBackend()) {
    return fail(
      'NOT_CONFIGURED',
      'No backend configured. Open the Pretext popup and add a Groq API key (developer mode), or build with Supabase env vars.',
    );
  }

  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    return fail('AUTH_REQUIRED', 'Sign in with Google from the Pretext popup to start optimizing.');
  }

  let res: Response;
  try {
    res = await fetch(`${CONFIG.supabaseUrl}/functions/v1/optimize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        apikey: CONFIG.supabaseAnonKey,
      },
      body: JSON.stringify({ text: trimmed, mode: 'questions' }),
    });
  } catch (e) {
    return fail('NETWORK', `Could not reach the Pretext backend: ${String(e)}`);
  }

  if (res.status === 401) return fail('AUTH_REQUIRED', 'Session expired. Sign in again.');
  if (res.status === 429) return fail('RATE_LIMITED', 'Daily free-tier limit reached.');
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return fail('UPSTREAM', `Backend error ${res.status}: ${body.slice(0, 300)}`);
  }

  try {
    const payload = await res.json();
    const raw = payload?.result ?? payload;
    return ok(parseClarifyContent(typeof raw === 'string' ? raw : JSON.stringify(raw)));
  } catch (e) {
    return groqErrorToResponse(e);
  }
}

// ---------------------------------------------------------------------------
// Auth (PRD §4A): chrome.identity + Supabase Auth
// ---------------------------------------------------------------------------
// The PRD names chrome.identity.getAuthToken(); that API only mints *access*
// tokens, while supabase.auth.signInWithIdToken() requires an OIDC *id_token*.
// We therefore use the sibling chrome.identity.launchWebAuthFlow() API to get
// an id_token, preserving the PRD architecture (Google credential validated
// by the Supabase Auth engine, which creates/retrieves the profile row).

async function signIn(): Promise<BgResponse<AuthState>> {
  if (!hasBackend()) return fail('NOT_CONFIGURED', 'Supabase is not configured in this build.');
  if (!hasGoogleAuth()) {
    return fail('NOT_CONFIGURED', 'WXT_GOOGLE_CLIENT_ID is not configured in this build.');
  }

  const supabase = getSupabase();
  const rawNonce = crypto.randomUUID();
  const hashedNonce = await sha256Hex(rawNonce);
  const redirectUri = browser.identity.getRedirectURL();

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', CONFIG.googleClientId);
  authUrl.searchParams.set('response_type', 'id_token');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('nonce', hashedNonce);
  authUrl.searchParams.set('prompt', 'select_account');

  let resultUrl: string | undefined;
  try {
    resultUrl = await browser.identity.launchWebAuthFlow({
      url: authUrl.href,
      interactive: true,
    });
  } catch (e) {
    return fail('AUTH_REQUIRED', `Google sign-in was cancelled or failed: ${String(e)}`);
  }
  if (!resultUrl) return fail('AUTH_REQUIRED', 'Google sign-in returned no result.');

  const fragment = new URL(resultUrl).hash.replace(/^#/, '');
  const idToken = new URLSearchParams(fragment).get('id_token');
  if (!idToken) return fail('AUTH_REQUIRED', 'Google did not return an id_token.');

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
    nonce: rawNonce,
  });
  if (error) return fail('AUTH_REQUIRED', `Supabase rejected the Google token: ${error.message}`);

  return ok(await getAuthState());
}

async function signOut(): Promise<BgResponse<AuthState>> {
  if (hasBackend()) {
    try {
      await getSupabase().auth.signOut();
    } catch {
      // Ignore network errors on sign-out; local session is cleared regardless.
    }
  }
  return ok(await getAuthState());
}

async function getAuthState(): Promise<AuthState> {
  const settings = await getSettings();
  const base: AuthState = {
    configured: hasBackend(),
    googleReady: hasGoogleAuth(),
    signedIn: false,
    devMode: settings.devMode,
    hasGroqKey: Boolean(settings.groqApiKey),
  };
  if (!hasBackend()) return base;

  try {
    const supabase = getSupabase();
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) return base;

    let tier: string | undefined;
    const { data: profile } = await supabase
      .from('profiles')
      .select('tier')
      .eq('id', session.user.id)
      .maybeSingle();
    if (profile && typeof profile.tier === 'string') tier = profile.tier;

    return {
      ...base,
      signedIn: true,
      email: session.user.email ?? undefined,
      tier,
    };
  } catch {
    return base;
  }
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Usage analytics for the popup (reads usage_logs under RLS)
// ---------------------------------------------------------------------------

async function usageSummary(): Promise<BgResponse<UsageSummary>> {
  if (!hasBackend()) return ok({ today: 0, total: 0, promptTokens: 0, completionTokens: 0 });

  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return ok({ today: 0, total: 0, promptTokens: 0, completionTokens: 0 });

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  try {
    const [{ count: total }, { count: today }, { data: tokenRows }] = await Promise.all([
      supabase
        .from('usage_logs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId),
      supabase
        .from('usage_logs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', startOfDay.toISOString()),
      supabase.from('usage_logs').select('prompt_tokens, completion_tokens').eq('user_id', userId),
    ]);

    let promptTokens = 0;
    let completionTokens = 0;
    for (const row of tokenRows ?? []) {
      promptTokens += Number(row.prompt_tokens) || 0;
      completionTokens += Number(row.completion_tokens) || 0;
    }
    return ok({ today: today ?? 0, total: total ?? 0, promptTokens, completionTokens });
  } catch (e) {
    return fail('NETWORK', `Could not load usage: ${e instanceof Error ? e.message : String(e)}`);
  }
}
