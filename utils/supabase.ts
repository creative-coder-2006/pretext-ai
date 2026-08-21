import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { browser } from 'wxt/browser';
import { CONFIG, hasBackend } from './config';

/**
 * Supabase client for the background service worker (PRD §4A).
 *
 * MV3 service workers have no localStorage, so sessions are persisted through
 * a chrome.storage.local adapter. Auth/session state therefore survives
 * worker restarts and is queryable from the popup and content script via
 * background messages.
 */
let client: SupabaseClient | null = null;

const chromeStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    const rec = await browser.storage.local.get(key);
    const v = rec[key];
    return typeof v === 'string' ? v : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await browser.storage.local.set({ [key]: value });
  },
  async removeItem(key: string): Promise<void> {
    await browser.storage.local.remove(key);
  },
};

export function getSupabase(): SupabaseClient {
  if (!hasBackend()) {
    throw new Error('Supabase backend is not configured in this build.');
  }
  if (!client) {
    client = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
      auth: {
        storage: chromeStorageAdapter,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}
