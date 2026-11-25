// Learner progress: the store the app uses. The types, the local store and the update rules live
// in lib/progress-core.ts (re-exported here); the synced store and the facade in lib/progress-store.ts.
//
// Sync runs only when NEXT_PUBLIC_PROGRESS_SYNC is "on" and Supabase is configured, and then only
// for a signed-in user. Otherwise progressStore is the plain LocalProgressStore, exactly as before:
// no network calls, and the Supabase client and the actions aren't even loaded.
import type { ProgressStore } from "./progress-core.ts";
import { createProgressStore } from "./progress-store.ts";

export * from "./progress-core.ts";

// Written out in full so Next.js inlines them into the browser bundle.
export const progressStore: ProgressStore = createProgressStore({
  flag: process.env.NEXT_PUBLIC_PROGRESS_SYNC,
  supabaseConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
  loadWiring: () => import("./progress-wiring.ts").then((m) => m.createWiring()),
});
