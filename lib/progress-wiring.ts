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
      // getUser() asks the auth server. A missing, expired or invalid session (a 4xx) means
      // nobody is signed in; a network or server failure throws, so nothing is deleted on a guess.
      async verifyUserId() {
        if (!supabase) return null;
        const { data, error } = await supabase.auth.getUser();
        if (!error) return data.user?.id ?? null;
        const status = (error as { status?: number }).status;
        if (error.name === "AuthSessionMissingError" || (typeof status === "number" && status >= 400 && status < 500)) return null;
        throw error;
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
