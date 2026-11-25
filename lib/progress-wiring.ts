// The browser side of progress sync: the Supabase session and the server actions. Loaded by
// lib/progress.ts with a dynamic import only when sync is on, so with the flag off none of this
// reaches the page's code at run time.
import { createClient } from "@/lib/supabase/client";
import { getProgressAction, resetProgressAction, syncProgressAction } from "@/app/actions/progress";
import type { Wiring } from "./progress-store.ts";

export function createWiring(): Wiring {
  const supabase = createClient();
  return {
    auth: {
      // getSession() reads the browser's own session (no network unless the token needs a refresh).
      // It only picks where to cache: the server checks the user again on every call.
      async getUserId() {
        if (!supabase) return null;
        const { data } = await supabase.auth.getSession();
        return data.session?.user.id ?? null;
      },
      onChange(callback) {
        supabase?.auth.onAuthStateChange((_event, session) => callback(session?.user.id ?? null));
      },
    },
    actions: {
      sync: (input) => syncProgressAction(input),
      get: (expectedUserId) => getProgressAction(expectedUserId),
      reset: (input) => resetProgressAction(input),
    },
  };
}
