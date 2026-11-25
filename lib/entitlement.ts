// Whether a user has access: at least one ACTIVE purchase of the product. Refunded and disputed
// purchases don't count (their status is "refunded" or "disputed", set by the payments webhook), and
// two active purchases (a duplicate charge, before its refund) still mean access. Pure apart from the
// client passed in, so lib/pricing-offer.test.ts can test it with a fake.

type Result = PromiseLike<{ data: { id: unknown }[] | null; error: unknown }>;

/** The part of a Supabase client the check needs. */
export type EntitlementClient = {
  from(table: "purchases"): {
    select(columns: "id"): {
      eq(column: "user_id", value: string): { eq(column: "product", value: string): { eq(column: "status", value: "active"): { limit(n: 1): Result } } };
    };
  };
};

/** True when at least one active purchase exists. Fails closed (false) on any error. */
export async function hasActivePurchase(client: EntitlementClient, userId: string, product: string): Promise<boolean> {
  try {
    // limit(1), not maybeSingle(): maybeSingle() errors on two rows, which made a learner with a
    // duplicate charge look unpaid.
    const { data, error } = await client.from("purchases").select("id").eq("user_id", userId).eq("product", product).eq("status", "active").limit(1);
    return !error && Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}
