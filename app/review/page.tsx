import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { FounderPrice } from "@/components/founder-offer";
import { ReviewSession } from "@/components/review-session";
import { getCurrentUser } from "@/lib/auth";
import { hasActiveEntitlement } from "@/lib/purchases";
import { getSharedOffer } from "@/lib/shared-pricing";
import { AccessUnknown } from "@/components/access-unknown";
import { OfferSwitch } from "@/components/founder-offer";

// Personal, so never indexed (and not in the sitemap).
export const metadata: Metadata = {
  title: "Daily review",
  description: "A few minutes a day with the words from the lessons you've practised. Part of lifetime access.",
  robots: { index: false, follow: true },
};

const cardBox = "flex min-h-[24rem] flex-col rounded-2xl border border-border bg-card p-6 sm:p-8";

/**
 * The heading is static; the session streams in once access is known (Prompt 76: the daily review is
 * part of lifetime access). Without access the session component never loads, so no deck is built
 * and no card text is fetched; cards already in the browser stay, hidden, for after a purchase.
 */
export default function ReviewPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-12 sm:px-6">
      <h1 className="font-serif text-4xl font-semibold tracking-tight">Daily review</h1>
      <Suspense fallback={<ReviewPlaceholder />}>
        <ReviewGate />
      </Suspense>
    </main>
  );
}

/** Same size as the session's first view, so nothing moves when it streams in. */
function ReviewPlaceholder() {
  return (
    <div className="mt-6" aria-hidden="true">
      <p className="min-h-6">{" "}</p>
      <div className={`mt-4 ${cardBox} items-center justify-center`}>
        <p className="text-muted">Loading your cards…</p>
      </div>
    </div>
  );
}

/** Signed-out visitors make no access call (getCurrentUser answers from the missing cookie). */
async function ReviewGate() {
  const user = await getCurrentUser();
  const access = user ? await hasActiveEntitlement(user.id, "lessons") : "no";
  if (access === "yes") return <ReviewSession />;
  // The check failed: neither the session nor the buy prompt.
  if (access === "unknown") return <AccessUnknown className="mt-6" />;
  await connection();
  const nowMs = Date.now();
  return <ReviewLocked offer={await getSharedOffer("lessons", nowMs)} nowMs={nowMs} signedIn={!!user} />;
}

function ReviewLocked({ offer, nowMs, signedIn }: { offer: Awaited<ReturnType<typeof getSharedOffer>>; nowMs: number; signedIn: boolean }) {
  return (
    <div className="mt-6">
      <p className="min-h-6">{" "}</p>
      <section aria-labelledby="review-locked" className={`mt-4 ${cardBox} items-center justify-center text-center`} data-testid="review-locked">
        <h2 id="review-locked" className="font-serif text-2xl font-semibold">
          Daily review is part of lifetime access
        </h2>
        <p className="mx-auto mt-3 max-w-md text-muted">
          <OfferSwitch
            offer={offer}
            nowMs={nowMs}
            founder={<>Daily review is part of lifetime access: a few minutes a day to keep the words you&apos;ve learned.</>}
            yearly={<>Daily review is part of yearly access: a few minutes a day to keep the words you&apos;ve learned.</>}
            soon={<>Daily review is part of paid access: a few minutes a day to keep the words you&apos;ve learned.</>}
          />
        </p>
        {offer.state !== "unavailable" && <FounderPrice offer={offer} nowMs={nowMs} centered />}
        <Link
          href="/pricing"
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-6 font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          See pricing
        </Link>
        {!signedIn && (
          <p className="mt-4 text-sm text-muted">
            Already have access?{" "}
            <Link href="/sign-in?next=/review" className="font-medium text-accent underline-offset-2 hover:underline">
              Sign in
            </Link>
          </p>
        )}
      </section>
    </div>
  );
}
