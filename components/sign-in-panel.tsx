import Link from "next/link";
import { safeNext } from "@/lib/safe-next";
import { deadlineDate, formatPrice, type PriceOffer } from "@/lib/pricing-offer";

/** Shown instead of a gated lesson to signed-out visitors. Contains nothing from the lesson. */
export function SignInPanel({ next, offer }: { next: string; offer?: PriceOffer; nowMs?: number }) {
  const href = `/sign-in?next=${encodeURIComponent(safeNext(next))}`;
  // The price for this request's time, from the same rules as the pricing card; none when it's
  // unavailable, and the "new plan coming soon" line once the founding offer has ended.
  const live = offer?.state === "founder";
  const price = live ? `${formatPrice(offer.chargeCents)} founding price until ${deadlineDate(offer.founderEndsAt)}, ` : "";
  return (
    <section className="mt-8 rounded-2xl border border-border bg-card px-6 py-10 text-center sm:px-10">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">Google sign-in required</p>
      <h2 className="mt-3 font-serif text-2xl font-semibold sm:text-3xl">
        Sign in with Google to read this lesson
      </h2>
      {offer?.state === "ended" ? (
        <p className="mx-auto mt-3 max-w-md text-muted">
          A1 and A2 are completely free. The founding offer for B1–C2 has ended, and a new plan is coming soon. Signing in
          with Google brings you straight back here.
        </p>
      ) : (
        <p className="mx-auto mt-3 max-w-md text-muted">
          A1 and A2 are completely free. Signing in with Google lets you unlock B1–C2 with a one-time payment ({price}all future
          written lessons and curriculum updates included), and you&apos;ll come straight back here.
        </p>
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
