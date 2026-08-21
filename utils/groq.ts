import { CONFIG } from './config';
import { buildClarifyMessages, buildMessages } from './prompt';
import type { ClarifyAnswer, ClarifyQuestion, ClarifyResult, OptimizeResult } from './types';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export class GroqError extends Error {
  constructor(
    public code: 'RATE_LIMITED' | 'UPSTREAM' | 'NETWORK' | 'PARSE',
    message: string,
  ) {
    super(message);
  }
}

interface GroqUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

export interface GroqCallResult {
  result: OptimizeResult;
  usage: GroqUsage;
}

/**
 * Developer-mode path: call Groq directly from the background service worker
 * with a personal API key. The production path goes through the Supabase
 * Edge Function proxy instead (PRD §5: "hits the backend proxy server,
 * protecting your Groq API keys").
 */
export async function callGroqDirect(
  apiKey: string,
  text: string,
  context?: ClarifyAnswer[],
): Promise<GroqCallResult> {
  let res: Response;
  try {
    res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: CONFIG.groqModel,
        messages: buildMessages(text, context),
        temperature: 0.6,
        max_tokens: 2048,
        reasoning_effort: 'low',
        response_format: { type: 'json_object' },
      }),
    });
  } catch (e) {
    throw new GroqError('NETWORK', `Could not reach Groq: ${String(e)}`);
  }

  if (res.status === 429) {
    throw new GroqError('RATE_LIMITED', 'Groq rate limit hit. Try again in a moment.');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GroqError('UPSTREAM', `Groq returned ${res.status}: ${body.slice(0, 300)}`);
  }

  const completion = await res.json();
  const content: unknown = completion?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new GroqError('PARSE', 'Groq response had no message content.');
  }
  return {
    result: parseOptimizeContent(content),
    usage: (completion?.usage ?? {}) as GroqUsage,
  };
}

/** Parse + validate the model's JSON into a normalized OptimizeResult. */
export function parseOptimizeContent(content: string): OptimizeResult {
  let raw: unknown;
  try {
    raw = JSON.parse(stripFences(content));
  } catch {
    throw new GroqError('PARSE', 'Model did not return valid JSON.');
  }
  const normalized = normalizeOptimizeResult(raw);
  if (!normalized) {
    throw new GroqError('PARSE', 'Model JSON did not match the Pretext schema.');
  }
  return normalized;
}

function stripFences(s: string): string {
  const trimmed = s.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

const TOKEN_RE = /\[([^\[\]\n]{1,60}?)\]/g;

/**
 * Coerce model output into a safe, consistent shape:
 * - template must be a non-empty string
 * - every [token] in the template gets an entry in variables (possibly empty,
 *   which the UI renders as "custom answer only")
 * - variables not present in the template are dropped
 * - options are coerced to up to 3 non-empty strings (PRD: 3 options + custom)
 */
export function normalizeOptimizeResult(raw: unknown): OptimizeResult | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const template =
    firstString(obj['structured_template']) ??
    firstString(obj['structuredTemplate']) ??
    firstString(obj['template']);
  if (!template || !template.trim()) return null;

  const rawVars =
    typeof obj['variables'] === 'object' && obj['variables'] !== null
      ? (obj['variables'] as Record<string, unknown>)
      : {};

  const tokens: string[] = [];
  for (const m of template.matchAll(TOKEN_RE)) {
    const name = m[1].trim();
    if (name && !tokens.includes(name)) tokens.push(name);
  }

  const variables: Record<string, string[]> = {};
  for (const token of tokens) {
    const found = rawVars[token] ?? rawVars[token.toLowerCase()] ?? rawVars[token.replace(/ /g, '_')];
    variables[token] = coerceOptions(found);
  }

  return { structuredTemplate: template.trim(), variables };
}

function firstString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function coerceOptions(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((o): o is string | number => typeof o === 'string' || typeof o === 'number')
    .map((o) => String(o).trim())
    .filter((o) => o.length > 0)
    .slice(0, 3);
}

// ---------------------------------------------------------------------------
// Clarifier: the optional "ask me a few questions first" call (Ctrl/Cmd+Shift+K)
// ---------------------------------------------------------------------------

/** Developer-mode path: ask Groq for clarifying questions before optimizing. */
export async function callGroqClarify(apiKey: string, text: string): Promise<ClarifyResult> {
  let res: Response;
  try {
    res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: CONFIG.groqModel,
        messages: buildClarifyMessages(text),
        temperature: 0.5,
        max_tokens: 1024,
        reasoning_effort: 'low',
        response_format: { type: 'json_object' },
      }),
    });
  } catch (e) {
    throw new GroqError('NETWORK', `Could not reach Groq: ${String(e)}`);
  }

  if (res.status === 429) {
    throw new GroqError('RATE_LIMITED', 'Groq rate limit hit. Try again in a moment.');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GroqError('UPSTREAM', `Groq returned ${res.status}: ${body.slice(0, 300)}`);
  }

  const completion = await res.json();
  const content: unknown = completion?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new GroqError('PARSE', 'Groq response had no message content.');
  }
  return parseClarifyContent(content);
}

/** Parse + validate the model's JSON into a normalized ClarifyResult. */
export function parseClarifyContent(content: string): ClarifyResult {
  let raw: unknown;
  try {
    raw = JSON.parse(stripFences(content));
  } catch {
    throw new GroqError('PARSE', 'Model did not return valid JSON.');
  }
  const normalized = normalizeClarifyResult(raw);
  if (!normalized) {
    throw new GroqError('PARSE', 'Model JSON did not match the clarify schema.');
  }
  return normalized;
}

/**
 * Coerce model output into a safe ClarifyResult:
 * - `questions` must be a non-empty array; at most 5 are kept
 * - each needs a non-empty `question`; `id` falls back to a positional key
 * - `suggestions` are coerced to up to 3 non-empty strings (may be empty)
 * - entries without a usable question are dropped
 */
export function normalizeClarifyResult(raw: unknown): ClarifyResult | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const arr = (raw as Record<string, unknown>)['questions'];
  if (!Array.isArray(arr)) return null;

  const questions: ClarifyQuestion[] = [];
  for (const item of arr) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Record<string, unknown>;
    const question = firstString(obj['question']) ?? firstString(obj['q']);
    if (!question || !question.trim()) continue;
    const idRaw = (firstString(obj['id']) ?? '').trim();
    questions.push({
      id: idRaw || `q${questions.length + 1}`,
      question: question.trim(),
      suggestions: coerceOptions(obj['suggestions'] ?? obj['options'] ?? obj['answers']),
    });
    if (questions.length >= 5) break;
  }
  if (questions.length === 0) return null;
  return { questions };
}
