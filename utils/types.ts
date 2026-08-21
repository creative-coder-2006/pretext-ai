/** Result of the Groq "Structural Parser Engine" call (PRD §5). */
export interface OptimizeResult {
  /** Rewritten prompt with `[variable]` tokens embedded inline. */
  structuredTemplate: string;
  /** variable name -> exactly 3 AI-generated, context-aware options. */
  variables: Record<string, string[]>;
}

/** One clarifying question Pretext can ask before it rewrites the prompt. */
export interface ClarifyQuestion {
  /** Stable lowercase_snake_case key. */
  id: string;
  /** The question shown to the user. */
  question: string;
  /** 2-3 AI-suggested answers (chips); the user may also type a custom one. */
  suggestions: string[];
}

/** Result of the Groq "Clarifier" call: the questions to ask up front. */
export interface ClarifyResult {
  questions: ClarifyQuestion[];
}

/** A question + the user's answer, fed back into optimize as extra context. */
export interface ClarifyAnswer {
  question: string;
  answer: string;
}

export type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'RATE_LIMITED'
  | 'NETWORK'
  | 'UPSTREAM'
  | 'PARSE'
  | 'EMPTY_TEXT'
  | 'NOT_CONFIGURED'
  | 'INTERNAL';

export interface BgError {
  code: ErrorCode;
  message: string;
}

export type BgResponse<T> = { ok: true; data: T } | { ok: false; error: BgError };

export interface AuthState {
  /** Whether a Supabase backend is configured in this build. */
  configured: boolean;
  /** Whether Google sign-in is configured (client id present). */
  googleReady: boolean;
  signedIn: boolean;
  email?: string;
  tier?: 'free' | 'premium' | 'pro' | string;
  devMode: boolean;
  hasGroqKey: boolean;
}

export interface UsageSummary {
  today: number;
  total: number;
  promptTokens: number;
  completionTokens: number;
}

export interface Settings {
  /** Call Groq directly from the background worker with a personal key. */
  devMode: boolean;
  /** Personal Groq API key (stored only in chrome.storage.local). */
  groqApiKey: string;
}

/** Messages content/popup -> background. */
export type BgRequest =
  | { type: 'optimize'; text: string; context?: ClarifyAnswer[] }
  | { type: 'clarify'; text: string }
  | { type: 'auth.signIn' }
  | { type: 'auth.signOut' }
  | { type: 'auth.state' }
  | { type: 'usage.summary' }
  | { type: 'settings.get' }
  | { type: 'settings.set'; settings: Partial<Settings> };
