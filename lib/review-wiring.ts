// The browser side of review sync: the Supabase session (the same auth wiring as progress) and the
// review server actions. Loaded by lib/review.ts with a dynamic import only when review sync is on,
// so with the flag off none of this reaches the page's code at run time.
import { getReviewAction, resetReviewAction, syncReviewAction } from "@/app/actions/review";
import { createWiring as createProgressWiring } from "./progress-wiring.ts";
import type { ReviewWiring } from "./review-sync-store.ts";

export function createReviewWiring(): ReviewWiring {
  return {
    auth: createProgressWiring().auth,
    actions: {
      sync: (input) => syncReviewAction(input),
      get: (expectedUserId) => getReviewAction(expectedUserId),
      reset: (input) => resetReviewAction(input),
    },
  };
}
