// review_cards through a Supabase client signed in as the user (RLS applies). Shared by
// app/actions/review.ts (the cookie session) and scripts/check-review-db.ts (a test account), so
// the check runs the same queries the action does. No file reads, no Next.js imports.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReviewDb, ReviewRow } from "./review-sync.ts";

const PAGE = 1000; // PostgREST returns at most 1,000 rows per request by default
const COLUMNS = "card_id, box, due_at, last_reviewed_at, review_count, lapse_count";

export function reviewDb(supabase: SupabaseClient, userId: string): ReviewDb {
  return {
    async apply(items) {
      const { data, error } = await supabase.rpc("apply_review", { p_items: items });
      if (error) throw error;
      return data;
    },
    async read(cardIds) {
      if (!cardIds.length) return [];
      const { data, error } = await supabase.from("review_cards").select(COLUMNS).eq("user_id", userId).in("card_id", cardIds);
      if (error) throw error;
      return (data ?? []) as ReviewRow[];
    },
    async readAll() {
      const out: ReviewRow[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase.from("review_cards").select(COLUMNS).eq("user_id", userId).order("card_id").range(from, from + PAGE - 1);
        if (error) throw error;
        out.push(...((data ?? []) as ReviewRow[]));
        if (!data || data.length < PAGE) return out;
      }
    },
    async deleteAll() {
      const { error } = await supabase.from("review_cards").delete().eq("user_id", userId);
      if (error) throw error;
    },
  };
}
