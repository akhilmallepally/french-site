// GET /api/founder-offer: whether the founding offer is on sale now, for the reminder banner, which
// fetches it in the browser after the page has loaded (pages stay static; nothing waits on this).
// It reads the shared price (lib/shared-pricing.ts, cached for 60 s and expired by the payments
// webhook) and decides for this request's time. CDNs may keep the answer for 60 s. No cookies, no
// user data: the same answer for everyone.
import { connection } from "next/server";
import { getSharedPricing } from "@/lib/shared-pricing";
import { getPriceOffer } from "@/lib/pricing-offer";

export type FounderOfferReply =
  | { state: "founder"; founderCents: number; yearlyCents: number; founderEndsAt: string }
  | { state: "ended"; founderEndsAt: string }
  | { state: "unavailable" };

export async function GET(): Promise<Response> {
  await connection(); // decided for this request's time, never at build
  const shared = await getSharedPricing("lessons");
  let body: FounderOfferReply = { state: "unavailable" };
  if (shared.ok) {
    const offer = getPriceOffer(shared.pricing, Date.now());
    if (offer.state === "founder") body = { state: "founder", founderCents: offer.founderCents, yearlyCents: shared.pricing.standardPriceCents, founderEndsAt: offer.founderEndsAt };
    else if (offer.state === "ended") body = { state: "ended", founderEndsAt: offer.founderEndsAt };
  }
  return Response.json(body, {
    headers: { "Cache-Control": shared.ok ? "public, max-age=0, s-maxage=60, stale-while-revalidate=300" : "no-store" },
  });
}
