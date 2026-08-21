import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// Pretext — Manifest V3 extension built with WXT + Vite + TypeScript (PRD §3).
export default defineConfig({
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'Pretext — AI Prompt Autocomplete',
    short_name: 'Pretext',
    description:
      'Turn vague prompts into hyper-specific ones, inline. Press Ctrl+K (⌘K on Mac) in any AI chat box to get an interactive fill-in-the-blank prompt builder.',
    permissions: ['storage', 'identity'],
    host_permissions: [
      'https://*.supabase.co/*',
      'https://api.groq.com/*',
    ],
  },
});
