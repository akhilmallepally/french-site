// The daily-review store the app uses (docs/plans/review.md). No page uses it yet (step 5).
//
// Sync runs only when NEXT_PUBLIC_REVIEW_SYNC is "on" (separate from NEXT_PUBLIC_PROGRESS_SYNC, so
// review can be switched on on its own) and Supabase is configured, and then only for a signed-in
// learner. Otherwise it's the browser-only LocalReviewStore: no network calls, and the Supabase
// client and the review actions aren't loaded.
import { createReviewStore } from "./review-sync-store.ts";
import type { ReviewStore } from "./review-store.ts";

export type { ReviewData, ReviewStore } from "./review-store.ts";

// Written out in full so Next.js inlines them into the browser bundle.
export const reviewStore: ReviewStore = createReviewStore({
  flag: process.env.NEXT_PUBLIC_REVIEW_SYNC,
  supabaseConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
  loadWiring: () => import("./review-wiring.ts").then((m) => m.createReviewWiring()),
});
