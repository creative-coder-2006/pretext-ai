/**
 * Build-time configuration, injected by Vite from `.env` (WXT_* variables).
 *
 * When the Supabase values are present the extension runs the full PRD
 * architecture (Google auth + Supabase Edge Function proxy in front of Groq).
 * When absent, it falls back to "developer mode": the user pastes a personal
 * Groq API key in the popup and the background worker calls Groq directly.
 */
export const CONFIG = {
  supabaseUrl: import.meta.env.WXT_SUPABASE_URL ?? '',
  supabaseAnonKey: import.meta.env.WXT_SUPABASE_ANON_KEY ?? '',
  googleClientId: import.meta.env.WXT_GOOGLE_CLIENT_ID ?? '',
  // Reasoning model — requests pin reasoning_effort:'low' to stay fast (see utils/groq.ts & the edge function).
  groqModel: 'openai/gpt-oss-120b',
} as const;

/** True when a Supabase backend (auth + proxy) is configured at build time. */
export function hasBackend(): boolean {
  return Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
}

/** True when Google sign-in can be attempted. */
export function hasGoogleAuth(): boolean {
  return hasBackend() && Boolean(CONFIG.googleClientId);
}
