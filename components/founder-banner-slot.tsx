import { FounderBanner } from "@/components/founder-banner";
import { prePaintScript } from "@/lib/founder-banner";
import { getPriceOffer } from "@/lib/pricing-offer";
import { ACCESS_KEY } from "@/lib/review-access";
import { getSharedPricing } from "@/lib/shared-pricing";

/**
 * The banner's place in every page (app/layout.tsx). It reads only the shared, cached price (no
 * cookies, no request data), so pages stay prerendered; the access check for hiding it runs in the
 * browser afterwards, and only for signed-in visitors. When the founding offer isn't on sale (or
 * pricing can't be read) it renders nothing.
 */
export async function FounderBannerSlot() {
  const shared = await getSharedPricing("lessons");
  if (!shared.ok) return null;
  const offer = getPriceOffer(shared.pricing, shared.readAtMs);
  if (offer.state !== "founder") return null;
  return (
    <>
      {/* Before the banner is parsed: hide it at once if dismissed, or for a learner known to have access. */}
      <script dangerouslySetInnerHTML={{ __html: prePaintScript(offer.founderEndsAt, ACCESS_KEY) }} />
      <FounderBanner founderCents={offer.founderCents} founderEndsAt={offer.founderEndsAt} readAtMs={shared.readAtMs} />
    </>
  );
}
