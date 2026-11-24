import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { getActivePricing, hasActiveEntitlement } from "@/lib/purchases";
import { CheckoutButton } from "@/components/checkout-button";

export const metadata: Metadata = {
  title: "Pricing",
  description: "One-time payment for lifetime access to French Properly. A1 and A2 are free forever.",
};

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <header className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">Transparent Pricing</p>
        <h1 className="mt-3 font-serif text-4xl font-semibold tracking-tight sm:text-5xl">
          Learn French properly, at your own pace.
        </h1>
        <p className="mt-4 text-lg text-muted">
          A1 and A2 are free for everyone, forever. Unlock intermediate to mastery levels (B1 to C2) with a single
          one-time payment.
        </p>
      </header>

      {/* Pricing comparison cards */}
      <div className="mt-12 grid gap-8 md:grid-cols-2">
        {/* Free Plan */}
        <section className="flex flex-col justify-between rounded-2xl border border-border bg-card p-8">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-2xl font-semibold">Introductory</h2>
              <span className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted">
                Free Forever
              </span>
            </div>
            <p className="mt-2 text-sm text-muted">
              Master French fundamentals from greetings to routine conversation.
            </p>
            <div className="mt-6 flex items-baseline gap-1">
              <span className="font-serif text-4xl font-semibold">$0</span>
              <span className="text-sm text-muted">no account needed</span>
            </div>

            <ul className="mt-8 space-y-3 text-sm text-muted">
              <li className="flex items-center gap-3">
                <svg className="h-4 w-4 shrink-0 text-accent" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                Complete A1 & A2 levels (80+ lessons)
              </li>
              <li className="flex items-center gap-3">
                <svg className="h-4 w-4 shrink-0 text-accent" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                Every vocab table and pronunciation guide
              </li>
              <li className="flex items-center gap-3">
                <svg className="h-4 w-4 shrink-0 text-accent" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                Interactive exercises with instant feedback
              </li>
              <li className="flex items-center gap-3">
                <svg className="h-4 w-4 shrink-0 text-accent" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                Prerendered and fast, no sign-in required
              </li>
            </ul>
          </div>

          <div className="mt-8">
            <Link
              href="/lessons/a1"
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-border bg-background px-6 py-2.5 font-medium transition hover:border-accent/40"
            >
              Start Free Lessons
            </Link>
          </div>
        </section>

        {/* Lifetime Plan */}
        <Suspense fallback={<LifetimePlanSkeleton />}>
          <LifetimePlanCard />
        </Suspense>
      </div>

      {/* Trust & FAQ section */}
      <section className="mt-16 rounded-2xl border border-border bg-card p-8 sm:p-10">
        <h2 className="font-serif text-2xl font-semibold tracking-tight">Frequently Asked Questions</h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <h3 className="font-semibold text-foreground">Is it really a one-time payment?</h3>
            <p className="mt-1 text-sm text-muted">
              Yes. There are no recurring charges, no subscriptions, and no hidden fees. Pay once and access is yours
              for life.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-foreground">What is your refund policy?</h3>
            <p className="mt-1 text-sm text-muted">
              Because all introductory lessons across A1 and A2 are free to try without payment, all sales for B1–C2
              lifetime access are final once unlocked, except for duplicate charges or where required by law. Read our{" "}
              <Link href="/refund" className="underline underline-offset-2 hover:text-accent">
                Refund Policy
              </Link>
              .
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Why are A1 and A2 free?</h3>
            <p className="mt-1 text-sm text-muted">
              We believe anyone should be able to try learning French without entering payment information or creating
              an account. You can complete all 80+ introductory lessons completely free.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Who handles payment processing?</h3>
            <p className="mt-1 text-sm text-muted">
              Payments are securely processed through our Merchant of Record, handling all international taxes,
              currency conversions, and receipts. We never see or store your payment card details.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function LifetimePlanSkeleton() {
  return (
    <section
      aria-busy="true"
      className="relative flex flex-col justify-between rounded-2xl border-2 border-accent bg-card p-8 shadow-sm"
    >
      <div>
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-2xl font-semibold">Lifetime Access</h2>
          <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
            One-Time Payment
          </span>
        </div>
        <p className="mt-2 text-sm text-muted">
          Everything from intermediate conversation to literary mastery.
        </p>
        {/* Neutral placeholders sized like the discount layout: no prices or offer until the card loads. */}
        <div aria-hidden="true">
          <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="flex items-center gap-3">
              <span className="block h-10 w-14 animate-pulse rounded-md bg-border/60" />
              <span className="block h-7 w-11 animate-pulse rounded-md bg-border/60" />
            </span>
            <span className="block h-5.5 w-20 animate-pulse rounded-full bg-border/60" />
            <span className="text-sm text-muted">one-time · lifetime access</span>
          </div>
          <div className="mt-2 h-5 w-64 max-w-full animate-pulse rounded-md bg-border/60" />
        </div>

        <ul className="mt-8 space-y-3 text-sm text-muted">
          <li className="flex items-center gap-3">
            <svg className="h-4 w-4 shrink-0 text-accent" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            Full access to B1, B2, C1, and C2 levels (240+ lessons)
          </li>
          <li className="flex items-center gap-3">
            <svg className="h-4 w-4 shrink-0 text-accent" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            All future written lessons and curriculum updates included
          </li>
          <li className="flex items-center gap-3">
            <svg className="h-4 w-4 shrink-0 text-accent" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            One-time payment. Never a recurring subscription
          </li>
          <li className="flex items-center gap-3">
            <svg className="h-4 w-4 shrink-0 text-accent" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            Try all A1 & A2 lessons free before unlocking
          </li>
        </ul>
      </div>

      <div className="mt-8">
        <div className="h-11 w-full animate-pulse rounded-full bg-border/60" />
      </div>
    </section>
  );
}

async function LifetimePlanCard() {
  const user = await getCurrentUser();
  const pricing = await getActivePricing("lessons");
  const isEntitled = user ? await hasActiveEntitlement(user.id, "lessons") : false;

  // If the pricing_settings read fails, getActivePricing returns hard-coded fallback prices and
  // checkout would charge those, which may not be the real price. So the card hides the price and
  // disables buying. If only get_founder_spots_left() fails, spotsLeft is 0, so the card and checkout
  // both use the standard price and the founder offer isn't shown.
  const priceKnown = pricing.available;
  const isFounder = priceKnown && pricing.spotsLeft > 0;
  const founderPrice = `$${pricing.founderPriceCents / 100}`;
  const standardPrice = `$${pricing.standardPriceCents / 100}`;
  // The discount (strikethrough, badge, founder line) shows only while founder spots remain and the
  // founder price is actually lower. The ribbon and the buy button keep using isFounder as before.
  const savePercent = Math.round((1 - pricing.founderPriceCents / pricing.standardPriceCents) * 100);
  const showDiscount = isFounder && pricing.founderPriceCents < pricing.standardPriceCents && savePercent >= 1;

  return (
    <section className="relative flex flex-col justify-between rounded-2xl border-2 border-accent bg-card p-8 shadow-sm">
      {isFounder && (
        <div className="absolute -top-3.5 right-6 rounded-full bg-accent px-3 py-0.5 text-xs font-semibold uppercase tracking-wider text-white">
          Founding Offer
        </div>
      )}

      <div>
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-2xl font-semibold">Lifetime Access</h2>
          <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
            One-Time Payment
          </span>
        </div>
        <p className="mt-2 text-sm text-muted">
          Everything from intermediate conversation to literary mastery.
        </p>
        {!priceKnown ? null : showDiscount ? (
          <>
            <div className="mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-2">
              <span className="sr-only">
                Regular price {standardPrice}, now {founderPrice}.
              </span>
              <span aria-hidden="true" className="flex items-baseline gap-3">
                <span className="font-serif text-4xl font-semibold">{founderPrice}</span>
                <s className="font-serif text-2xl text-muted">{standardPrice}</s>
              </span>
              <span className="self-center rounded-full border border-accent bg-card px-2.5 py-0.5 text-xs font-semibold text-accent">
                Save {savePercent}%
              </span>
              <span className="text-sm text-muted">one-time · lifetime access</span>
            </div>
            <p className="mt-2 text-sm text-muted">
              Founder price for the first {pricing.founderCap} learners, then {standardPrice}.
            </p>
          </>
        ) : (
          <div className="mt-6 flex items-baseline gap-2">
            <span className="font-serif text-4xl font-semibold">
              {isFounder ? founderPrice : standardPrice}
            </span>
            <span className="text-sm text-muted">one-time · lifetime access</span>
          </div>
        )}

        <ul className="mt-8 space-y-3 text-sm text-muted">
          <li className="flex items-center gap-3">
            <svg className="h-4 w-4 shrink-0 text-accent" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            Full access to B1, B2, C1, and C2 levels (240+ lessons)
          </li>
          <li className="flex items-center gap-3">
            <svg className="h-4 w-4 shrink-0 text-accent" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            All future written lessons and curriculum updates included
          </li>
          <li className="flex items-center gap-3">
            <svg className="h-4 w-4 shrink-0 text-accent" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            One-time payment. Never a recurring subscription
          </li>
          <li className="flex items-center gap-3">
            <svg className="h-4 w-4 shrink-0 text-accent" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            Try all A1 & A2 lessons free before unlocking
          </li>
        </ul>
      </div>

      <div className="mt-8">
        {isEntitled ? (
          <div className="rounded-xl border border-accent/20 bg-accent/5 p-4 text-center">
            <p className="text-sm font-medium text-accent">You have lifetime access!</p>
            <Link
              href="/lessons/b1"
              className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-full bg-accent px-6 py-2 text-sm font-medium text-white transition hover:opacity-90"
            >
              Continue Learning
            </Link>
          </div>
        ) : !priceKnown ? (
          <div>
            <button
              type="button"
              disabled
              aria-describedby="pricing-unavailable"
              className="inline-flex min-h-11 w-full cursor-not-allowed items-center justify-center rounded-full bg-accent px-6 py-2.5 font-medium text-white opacity-60"
            >
              Get Lifetime Access
            </button>
            <p id="pricing-unavailable" className="mt-3 text-center text-sm text-muted">
              Pricing is temporarily unavailable. Please try again in a minute.
            </p>
          </div>
        ) : user ? (
          <CheckoutButton
            product="lessons"
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-accent px-6 py-2.5 font-medium text-white transition hover:opacity-90"
            label={isFounder ? `Get Founder Access for ${founderPrice}` : `Get Lifetime Access for ${standardPrice}`}
          />
        ) : (
          <Link
            href="/sign-in?next=/pricing"
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-accent px-6 py-2.5 font-medium text-white transition hover:opacity-90"
          >
            Sign in with Google to unlock
          </Link>
        )}
      </div>
    </section>
  );
}
