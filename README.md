# ✦ Pretext — The Inline AI Prompt Autocomplete Engine

Pretext is a Chrome extension that transforms vague, low-quality text into hyper-specific,
context-rich prompts **directly inside any AI text area** (ChatGPT, Claude, Gemini — or any
textarea on the web).

Type a rough idea, press **Ctrl+K** (**⌘K** on Mac), and your text morphs into an interactive
fill-in-the-blank form: the AI isolates the critical missing details as highlighted **token
pills**, each with 3 context-aware dropdown options plus a "type custom answer…" field.
Tab through, pick or type answers, hit **Enter** — and a fully engineered prompt is injected
back into the native input box.

```
[User types vague prompt]
        ↓  presses Ctrl/⌘ + K
[Text transforms into an interactive form with dropdowns]
        ↓  Tab through selections, or type custom answers
[Enter → raw text replaced with the fully optimized prompt]
```

## Tech stack (per PRD §3)

| Layer               | Technology                          | Purpose                                                          |
| ------------------- | ----------------------------------- | ---------------------------------------------------------------- |
| Extension framework | **WXT + Vite + TypeScript**         | Manifest V3, hot reloading, isolated content-script compilation  |
| Frontend UI         | **Shadow DOM + Tailwind CSS**       | Styles can never be broken by (or leak into) the host page       |
| Backend & DB        | **Supabase (PostgreSQL)**           | Sessions, profiles, analytics, token-usage tracking              |
| Authentication      | **Google OAuth2 via Supabase Auth** | One-click onboarding matching the Chrome account context         |
| AI inference        | **Groq API — `openai/gpt-oss-120b`** | ~500 tok/s reasoning model (effort=low) in strict JSON mode      |

## Repo layout

```
entrypoints/
  background.ts          MV3 service worker: auth, settings, optimize routing
  content/
    index.ts             Ctrl/⌘+K interception, session orchestration
    canvas.ts            The Pretext Inline Canvas (pills + dropdowns + keyboard)
    editable.ts          Adapter for textarea / input / contenteditable hosts
    style.css            Shadow-DOM-scoped canvas styles
  popup/                 Toolbar popup: Google sign-in, usage stats, dev mode
utils/
  prompt.ts              The Structural Parser system prompt (PRD §5)
  groq.ts                Groq client + strict JSON schema normalization (+ tests)
  supabase.ts            Supabase client w/ chrome.storage session persistence
  config.ts, types.ts    Build config and shared message/result types
supabase/
  migrations/…init.sql   profiles + usage_logs schema, RLS, auto-profile trigger
  functions/optimize/    Edge Function proxy — the only place the Groq key lives
public/icon/             Generated icons (npm run icons)
```

## Quick start (developer mode — no backend needed)

```bash
npm install
npm run build
```

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**,
   and select `.output/chrome-mv3/`.
2. Click the ✦ Pretext toolbar icon → toggle **Developer mode** → paste a free
   Groq API key from https://console.groq.com/keys → **Save key**.
3. Go to ChatGPT / Claude / Gemini (or any site), click into the chat box, type
   something vague like `write a cold email to a tech startup for a job`,
   and press **Ctrl+K** / **⌘K**.

In developer mode the background worker calls Groq directly with your personal key
(stored only in `chrome.storage.local`). The production path below routes through a
backend proxy instead, so end users never hold a key.

## Full production setup (Supabase backend, per PRD §4–5)

1. **Create a Supabase project**, then apply the schema:
   ```bash
   supabase link --project-ref <your-ref>
   supabase db push          # applies supabase/migrations/*.sql
   ```
2. **Deploy the proxy** that protects your Groq API key:
   ```bash
   supabase secrets set GROQ_API_KEY=gsk_...
   supabase functions deploy optimize
   ```
3. **Google OAuth**: in Google Cloud Console create an **OAuth 2.0 Web client**.
   - Authorized redirect URI: `https://<extension-id>.chromiumapp.org/`
     (the extension ID shown at `chrome://extensions` after loading).
   - In Supabase **Auth → Providers → Google**, enable the provider and add the
     client ID (and secret). Make sure the client ID is also listed under
     "Authorized Client IDs" so `signInWithIdToken` accepts it.
4. **Build the extension against your backend**:
   ```bash
   cp .env.example .env       # fill WXT_SUPABASE_URL, WXT_SUPABASE_ANON_KEY, WXT_GOOGLE_CLIENT_ID
   npm run build
   ```
5. Reload the unpacked extension, open the popup, and **Sign in with Google**.
   The popup then shows your tier (`free` / `premium` / `pro`) and live usage
   stats pulled from `usage_logs` under row-level security.

> **PRD note:** the PRD names `chrome.identity.getAuthToken()`. That API can only mint
> Google *access* tokens, while `supabase.auth.signInWithIdToken()` requires an OIDC
> *id_token* — so Pretext uses the sibling `chrome.identity.launchWebAuthFlow()` API.
> The architecture is otherwise exactly as specified: the Google credential is validated
> by the Supabase Auth engine, which provisions the `profiles` row via trigger, and the
> session is persisted and synced to the content script through the service worker.

## Keyboard reference

| Key             | Action                                              |
| --------------- | --------------------------------------------------- |
| `Ctrl/⌘ + K`    | Optimize the focused input's text                   |
| `Tab` / `Shift+Tab` | Next / previous token pill (skip)               |
| `↑` / `↓`       | Cycle the active pill's AI options (instant apply)  |
| `←` / `→`       | Previous / next pill                                |
| typing in row 4 | Custom answer (always available)                    |
| `Enter`         | Inject the completed prompt into the host input     |
| `Esc`           | Cancel — the original text is never touched         |

## Non-functional guarantees (PRD §6)

- **Isolated execution**: all UI renders inside a closed-over Shadow DOM root appended to
  `<body>`; nothing leaks in or out. Keyboard/pointer events are stopped at the shadow
  boundary so host-page hotkeys (e.g. ChatGPT's) never fire while the canvas is open.
- **Privacy**: Pretext never listens to or captures keystrokes. The only global listener
  checks for the exact Ctrl/⌘+K combo and reads the focused element's text *only* at
  that moment. No content is stored or sent anywhere except the optimize call itself.
- **Graceful degrade**: if the backend/Groq errors, rate-limits, or times out (15 s), the
  canvas quietly logs to `console.debug`, closes, and the user's original text remains
  exactly as typed — zero disruption.

## Scripts

| Command             | What it does                                |
| ------------------- | ------------------------------------------- |
| `npm run dev`       | WXT dev mode with hot reload                |
| `npm run build`     | Production build to `.output/chrome-mv3/`   |
| `npm run zip`       | Store-ready zip                             |
| `npm test`          | Unit tests (schema normalization)           |
| `npm run typecheck` | Strict TypeScript check                     |
| `npm run icons`     | Regenerate `public/icon/*.png`              |
