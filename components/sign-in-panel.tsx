import Link from "next/link";
import { safeNext } from "@/lib/safe-next";
import { deadlineDate, formatPrice, TAX_ADDED_AT_CHECKOUT, yearlyOf, type PriceOffer } from "@/lib/pricing-offer";
import { OfferSwitch } from "@/components/founder-offer";

/** Shown instead of a gated lesson to signed-out visitors. Contains nothing from the lesson. */
export function SignInPanel({ next, offer, nowMs }: { next: string; offer?: PriceOffer; nowMs?: number }) {
  const href = `/sign-in?next=${encodeURIComponent(safeNext(next))}`;
  // The price for this request's time, from the same rules as the pricing card; none when it's
  // unavailable. After the switch (on the page's clock too) the yearly price, or "coming soon".
  const live = offer?.state === "founder";
  const price = live ? `${formatPrice(offer.chargeCents)} founding price until ${deadlineDate(offer.founderEndsAt)}, ` : "";
  const yearly = offer ? yearlyOf(offer) : null;
  const founderCopy = (
    <p className="mx-auto mt-3 max-w-md text-muted">
      A1 and A2 are completely free. Signing in with Google lets you unlock B1–C2 with a one-time payment ({price}all future
      written lessons and curriculum updates included), and you&apos;ll come straight back here.
    </p>
  );
  const soonCopy = (
    <p className="mx-auto mt-3 max-w-md text-muted">
      A1 and A2 are completely free. The founding offer for B1–C2 has ended, and a new plan is coming soon. Signing in
      with Google brings you straight back here.
    </p>
  );
  const yearlyCopy = yearly ? (
    <p className="mx-auto mt-3 max-w-md text-muted">
      A1 and A2 are completely free. Signing in with Google lets you unlock B1–C2 with yearly access (
      {formatPrice(yearly.chargeCents)} a year{TAX_ADDED_AT_CHECKOUT ? ", plus tax where applicable" : ""}; it renews automatically until you cancel), and
      you&apos;ll come straight back here.
    </p>
  ) : (
    soonCopy
  );
  return (
    <section className="mt-8 rounded-2xl border border-border bg-card px-6 py-10 text-center sm:px-10">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">Google sign-in required</p>
      <h2 className="mt-3 font-serif text-2xl font-semibold sm:text-3xl">
        Sign in with Google to read this lesson
      </h2>
      {offer && nowMs !== undefined ? (
        <OfferSwitch offer={offer} nowMs={nowMs} founder={founderCopy} yearly={yearlyCopy} soon={soonCopy} unavailable={founderCopy} />
      ) : (
        founderCopy
      )}
      <Link
        href={href}
        prefetch={false}
        className="mt-6 inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-6 py-2.5 font-medium text-white transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Sign in to continue
      </Link>
    </section>
  );
}
