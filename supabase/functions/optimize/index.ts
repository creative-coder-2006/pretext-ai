// Pretext backend proxy (PRD §5): validates the user's Supabase JWT, queries
// Groq with the Structural Parser system prompt, logs token usage, and
// returns the structured JSON. The Groq API key lives ONLY here, as a
// Supabase secret — it is never shipped inside the extension.
//
// Deploy:  supabase functions deploy optimize
// Secret:  supabase secrets set GROQ_API_KEY=gsk_...

import { createClient } from 'jsr:@supabase/supabase-js@2';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'openai/gpt-oss-120b'; // reasoning model; request pins reasoning_effort:'low'
const FREE_DAILY_LIMIT = 100; // optimizations per UTC day on the free tier

// NOTE: duplicated from `utils/prompt.ts` in the extension source — the Deno
// runtime cannot import from the extension tree. Keep both copies in sync.
const SYSTEM_PROMPT = `You are the Pretext Structural Parser Engine. A user has typed a vague prompt that they intend to send to an AI assistant. Your job is to rewrite it into ONE hyper-specific, ready-to-send prompt, then isolate the 2-5 most important missing decisions as inline [snake_case_variable] tokens, each with 3 strong, context-appropriate options.

CRITICAL — what "structured_template" must be:
- It is a PROMPT the user will paste straight into an AI chat to get a great result. Write it as a direct INSTRUCTION TO THE AI: imperative ("Write...", "Create...", "Explain...", "Build...", "Summarize...") or first-person request ("Help me...", "I need you to...").
- It is NOT advice, an answer, a tutorial, or a reply addressed to the user. NEVER phrase it as guidance like "To do X well, focus on..." or "You should...". You are not fulfilling the request — you are only sharpening it into a better request.
- Never include any of the actual answer or solution content. For "help me study for my Markov chains exam" you produce a better STUDY-HELP REQUEST, never the study tips themselves.

Return ONLY a JSON object with exactly these keys:
{
  "structured_template": "the rewritten prompt, with 2-5 [snake_case_variable] tokens inline",
  "variables": { "snake_case_variable": ["option 1", "option 2", "option 3"] }
}

Rules:
- Output ONLY the JSON object. No markdown fences, no commentary, no keys other than the two above.
- Every [token] that appears in structured_template MUST have a matching key in variables, and every key in variables MUST appear as a [token] in the template. No extras on either side.
- Variable names are lowercase snake_case, 1-3 words, descriptive (e.g. [target_audience], [tone], [output_format]).
- Each variable has EXACTLY 3 options. Options are short (under 10 words), concrete, mutually distinct, and must read grammatically when substituted into the template sentence.
- Keep the user's original intent but raise its specificity dramatically: pin down audience, scope, depth, format, length, or success criteria the original left vague — always as part of the REQUEST, never as a prescribed answer.
- The template must read as natural prose once all tokens are filled. Never number the tokens or wrap them in quotes.
- If the input is already fairly specific, still surface at least 2 leverage variables (such as tone, format, length, depth, or audience).
- Infer the user's actual goal from their words and serve THAT — do not force a fixed structure. For learning requests ("help me study/understand/learn X"), default to a prompt that makes the AI teach the topic thoroughly and build deep understanding, not merely plan study time, unless a plan was explicitly requested.
- Never refuse: any input text, however short, gets restructured.

Example 1.
Input: "write a cold email to a tech startup for a job"
Output:
{
  "structured_template": "Write a highly personalized, compelling cold outreach email to a tech startup targeting the [department] department. The tone should be [tone] and the core value proposition highlighted must be [value_prop]. Include a clear call to action asking for [cta].",
  "variables": {
    "department": ["Engineering", "Product Management", "Growth Marketing"],
    "tone": ["Bold & Direct", "Empathetic & Problem-Solving", "Witty & Enthusiastic"],
    "value_prop": ["Reducing cloud infrastructure spend", "Boosting active user retention rates", "Shipping clean code at 2x baseline speed"],
    "cta": ["A quick 10-minute introductory sync", "Direct feedback on their current landing page", "A brief review of a portfolio project built for them"]
  }
}

Example 2 (a learning request: the user wants to be TAUGHT, so the prompt asks the AI to teach the topic completely — not to schedule study time).
Input: "i have exam on markov chain help me study for it"
Output:
{
  "structured_template": "Act as an expert tutor and teach me Markov chains thoroughly, from the ground up, until I fully understand the material for my exam. Start with first principles and build up to [scope], explaining every concept at a [depth] level with clear intuition, worked examples, and visual descriptions. Assume my background is [background], check my understanding as you go by [check_method], and don't move on until each idea is solid.",
  "variables": {
    "scope": ["the core exam topics", "the full standard syllabus", "advanced topics and proofs"],
    "depth": ["beginner-friendly", "rigorous undergraduate", "fully proof-based"],
    "background": ["minimal probability knowledge", "basic probability", "a strong linear-algebra base"],
    "check_method": ["asking me a quick question", "giving me a practice problem", "having me explain it back"]
  }
}`;

// Clarifier prompt for the optional "ask questions first" flow (mode:'questions').
// Duplicated from `utils/prompt.ts` (CLARIFY_SYSTEM_PROMPT) — keep both in sync.
const CLARIFY_SYSTEM_PROMPT = `You are Pretext's Clarifier. The user typed a vague prompt they intend to send to an AI assistant. Before it gets rewritten, produce a few sharp questions whose answers would most improve the final prompt.

Return ONLY a JSON object with exactly this shape:
{
  "questions": [
    { "id": "snake_case_key", "question": "A short question?", "suggestions": ["option a", "option b", "option c"] }
  ]
}

Rules:
- Output ONLY the JSON object. No markdown fences, no commentary.
- Ask 3 to 5 questions, most important first. Fewer is fine for a trivial input.
- Target the highest-leverage unknowns: the real goal, audience, scope, desired format, key constraints, and — when the task could be small or large — how detailed the output should be (a build-an-app request should ask about platform, tech stack, and depth).
- Each question is ONE short sentence. Each has 2-3 concrete suggested answers: short (under 8 words), mutually distinct, realistic. The user can also type their own, so suggestions are starting points.
- "id" is lowercase snake_case, 1-3 words.
- Never ask for something already explicit in the input. Never refuse.

Example.
Input: "help me build an app"
Output:
{
  "questions": [
    { "id": "app_type", "question": "What kind of app is it?", "suggestions": ["Mobile (iOS/Android)", "Web app", "Desktop app"] },
    { "id": "core_purpose", "question": "What is its main purpose?", "suggestions": ["Track personal habits", "Sell products online", "Connect a community"] },
    { "id": "tech_stack", "question": "Any preferred tech stack?", "suggestions": ["React + Node", "Flutter", "No preference"] },
    { "id": "detail_level", "question": "How detailed should the answer be?", "suggestions": ["High-level plan", "Step-by-step build", "Full production spec"] }
  ]
}`;

// Appended to SYSTEM_PROMPT when the user answered clarifying questions.
// Duplicated from `utils/prompt.ts` (CONTEXT_ADDENDUM) — keep both in sync.
const CONTEXT_ADDENDUM = `The user has answered some clarifying questions (supplied below the input). Treat every answer as a fixed fact: bake it directly into structured_template as concrete wording, and never turn an already-answered detail back into a [token]. Use the answers to scale depth — if they point to a complex or build-style task (building an app, a detailed spec, "in-depth"), produce a longer, multi-part prompt with richer constraints and up to 5 variables; if they point to something quick or casual, keep it short with 2-3 variables. The remaining [tokens] should capture only the decisions still left open.`;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const groqKey = Deno.env.get('GROQ_API_KEY');
    if (!groqKey) return json(500, { error: 'INTERNAL', message: 'GROQ_API_KEY secret not set' });

    // 1. Validate the caller's JWT (Supabase Auth session from the extension).
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return json(401, { error: 'AUTH_REQUIRED' });

    // 2. Validate input.
    const body = (await req.json().catch(() => ({}))) as {
      text?: string;
      mode?: string;
      context?: { question: string; answer: string }[];
    };
    const text = body.text;
    if (!text || !text.trim()) return json(400, { error: 'EMPTY_TEXT' });
    if (text.length > 4000) return json(413, { error: 'TOO_LONG' });
    const isQuestions = body.mode === 'questions';
    const answered = (body.context ?? []).filter(
      (c) => c && typeof c.answer === 'string' && c.answer.trim().length > 0,
    );

    // 3. Tier check + free-tier daily cap.
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: profile } = await admin
      .from('profiles')
      .select('tier')
      .eq('id', user.id)
      .maybeSingle();
    const tier = profile?.tier ?? 'free';

    if (tier === 'free' && !isQuestions) {
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      const { count } = await admin
        .from('usage_logs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('created_at', startOfDay.toISOString());
      if ((count ?? 0) >= FREE_DAILY_LIMIT) {
        return json(429, { error: 'RATE_LIMITED' });
      }
    }

    // 4. Query Groq (openai/gpt-oss-120b reasoning model, strict JSON mode — PRD §5).
    // Either ask clarifying questions (mode:'questions') or rewrite the prompt,
    // folding any answered questions into the rewrite and scaling its depth.
    const systemPrompt = isQuestions
      ? CLARIFY_SYSTEM_PROMPT
      : answered.length > 0
        ? `${SYSTEM_PROMPT}\n\n${CONTEXT_ADDENDUM}`
        : SYSTEM_PROMPT;
    const answersBlock =
      !isQuestions && answered.length > 0
        ? '\n\nThe user already answered:\n' +
          answered.map((c) => `- ${c.question} → ${JSON.stringify(c.answer.trim())}`).join('\n')
        : '';
    const groqRes = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Input: ${JSON.stringify(text.trim())}${answersBlock}\nOutput:` },
        ],
        temperature: isQuestions ? 0.5 : 0.6,
        max_tokens: 2048,
        reasoning_effort: 'low',
        response_format: { type: 'json_object' },
      }),
    });

    if (groqRes.status === 429) return json(429, { error: 'RATE_LIMITED' });
    if (!groqRes.ok) {
      const detail = await groqRes.text().catch(() => '');
      return json(502, { error: 'UPSTREAM', message: detail.slice(0, 300) });
    }

    const completion = await groqRes.json();
    const content = completion?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return json(502, { error: 'PARSE' });

    let result: unknown;
    try {
      result = JSON.parse(content);
    } catch {
      return json(502, { error: 'PARSE' });
    }

    // 5. Log usage analytics (PRD §4B usage_logs).
    await admin.from('usage_logs').insert({
      user_id: user.id,
      model_used: GROQ_MODEL,
      prompt_tokens: completion?.usage?.prompt_tokens ?? 0,
      completion_tokens: completion?.usage?.completion_tokens ?? 0,
    });

    return json(200, { result, usage: completion?.usage ?? null });
  } catch (e) {
    return json(500, { error: 'INTERNAL', message: String(e) });
  }
});
