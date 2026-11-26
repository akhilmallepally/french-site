import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth";
import { getAccessDetails, hasActiveEntitlement } from "@/lib/purchases";
import { getSharedOffer, getSharedPricing } from "@/lib/shared-pricing";
import { FounderBuy, FounderPrice, OfferSwitch } from "@/components/founder-offer";
import { AccessUnknown } from "@/components/access-unknown";
import { PricingUnavailable } from "@/components/price-offer";
import { getPriceOffer, type PriceOffer } from "@/lib/pricing-offer";
import { accessLine } from "@/lib/access-wording";

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
          <SharedSwitch
            founder={<>A1 and A2 are free for everyone, forever. Unlock intermediate to mastery levels (B1 to C2) with a single one-time payment.</>}
            yearly={<>A1 and A2 are free for everyone, forever. Unlock intermediate to mastery levels (B1 to C2) with yearly access.</>}
            soon={<>A1 and A2 are free for everyone, forever. A new plan for B1 to C2 is coming soon.</>}
          />
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
        <LifetimePlanCard />
      </div>

      {/* Trust & FAQ section */}
      <section className="mt-16 rounded-2xl border border-border bg-card p-8 sm:p-10">
        <h2 className="font-serif text-2xl font-semibold tracking-tight">Frequently Asked Questions</h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <SharedSwitch
            founder={
              <div>
                <h3 className="font-semibold text-foreground">Is it really a one-time payment?</h3>
                <p className="mt-1 text-sm text-muted">
                  Yes, for the founding offer. Pay once before it ends on 31 December 2026 (23:59 Bangkok time), or
                  while founder spots remain, and access is yours for life, with no recurring charges. Everyone who
                  already has lifetime access keeps it.
                </p>
              </div>
            }
            yearly={
              <div>
                <h3 className="font-semibold text-foreground">How does yearly access work?</h3>
                <p className="mt-1 text-sm text-muted">
                  It renews automatically each year until you cancel. Cancel any time: your access runs to the end of the
                  paid year. Everyone who already has lifetime access keeps it.
                </p>
              </div>
            }
            soon={
              <div>
                <h3 className="font-semibold text-foreground">Can I still buy lifetime access?</h3>
                <p className="mt-1 text-sm text-muted">
                  The founding offer has ended, and a new plan is coming soon. Everyone who already has lifetime access
                  keeps it.
                </p>
              </div>
            }
          />
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

/**
 * Copy that follows the offer (Prompt 80): one of three server-rendered children, chosen for the time
 * the shared price was read and then on the browser's clock, so an open page switches at the
 * deadline. From the shared cache, so it's in the static shell when warm; the founder copy stands in
 * while it streams. With pricing unreadable, the browser's clock picks founder or "coming soon".
 */
function SharedSwitch(props: { founder: ReactNode; yearly: ReactNode; soon: ReactNode }) {
  return (
    <Suspense fallback={props.founder}>
      <SharedSwitchSlot {...props} />
    </Suspense>
  );
}

async function SharedSwitchSlot({ founder, yearly, soon }: { founder: ReactNode; yearly: ReactNode; soon: ReactNode }) {
  const shared = await getSharedPricing("lessons");
  const offer: PriceOffer = shared.ok ? getPriceOffer(shared.pricing, shared.readAtMs) : { state: "unavailable" };
  // An unreadable price has no read time: 0 renders the founder copy first, then the browser's clock decides.
  return <OfferSwitch offer={offer} nowMs={shared.ok ? shared.readAtMs : 0} founder={founder} yearly={yearly} soon={soon} />;
}

/** The price's place while it loads (only when the shared price wasn't in the prerender). Same size as the price. */
function PricePlaceholder() {
  return (
    <div aria-hidden="true">
      <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex items-center gap-3">
          <span className="block h-10 w-14 animate-pulse rounded-md bg-border/60" />
          <span className="block h-7 w-11 animate-pulse rounded-md bg-border/60" />
        </span>
        <span className="text-sm text-muted">one-time · lifetime access</span>
      </div>
      <div className="mt-2 h-5 w-64 max-w-full animate-pulse rounded-md bg-border/60" />
      <div className="mt-1 h-5 w-48 max-w-full animate-pulse rounded-md bg-border/60" />
      <div className="mt-3 h-10 w-56 max-w-full animate-pulse rounded-md bg-border/60" />
    </div>
  );
}

/** The visitor's button while it loads. */
function ActionPlaceholder() {
  return <div aria-hidden="true" className="h-11 w-full animate-pulse rounded-full bg-border/60" />;
}

/**
 * The price everyone sees, from the shared cache (lib/shared-pricing.ts): in the static shell when
 * warm. It's decided for the time the price was read; the browser checks again on its own clock and
 * counts down, switching to the ended state at the deadline.
 */
async function LifetimePrice() {
  const shared = await getSharedPricing("lessons");
  if (!shared.ok) return null;
  const offer = getPriceOffer(shared.pricing, shared.readAtMs);
  if (offer.state === "unavailable") return null;
  return <FounderPrice offer={offer} nowMs={shared.readAtMs} ribbon />;
}

/**
 * The per-visitor part: a sign-in link, the buy button, or the learner's access line ("You have
 * lifetime access!", or a subscriber's renewal or end date, or a payment problem). Signed-out
 * visitors make no auth or entitlement call (getCurrentUser answers from the missing cookie). When
 * the access check fails, "Couldn't check your access" with Retry: never the buy button.
 */
async function LifetimeAction() {
  const user = await getCurrentUser();
  await connection(); // the offer below is decided for this request's time
  const nowMs = Date.now();
  const offer = await getSharedOffer("lessons", nowMs);
  const access = user ? await hasActiveEntitlement(user.id, "lessons") : "no";
  if (access === "unknown") return <AccessUnknown compact />;
  const details = user && access === "yes" ? await getAccessDetails(user.id, "lessons") : null;
  const line = details?.state === "yes" ? accessLine(details) : null;
  return access === "yes" ? (
    <div className="rounded-xl border border-accent/20 bg-accent/5 p-4 text-center" data-testid="access-line">
      {line?.href ? (
        <Link href={line.href} className="text-sm font-medium text-red-700 underline underline-offset-2 dark:text-red-400">
          {line.text}
        </Link>
      ) : (
        <p className="text-sm font-medium text-accent">{line?.text ?? "You have full access."}</p>
      )}
      <Link
        href="/lessons/b1"
        className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-full bg-accent px-6 py-2 text-sm font-medium text-white transition hover:opacity-90"
      >
        Continue Learning
      </Link>
    </div>
  ) : offer.state === "unavailable" ? (
    <PricingUnavailable id="pricing-unavailable" />
  ) : (
    <FounderBuy offer={offer} nowMs={nowMs} signedIn={!!user} />
  );
}

/**
 * The lifetime card. Its frame is static. The price (with the ribbon) comes from the shared cache, so
 * it's in the prerendered page with the free card; only the visitor's button streams, in a slot whose
 * height is reserved. If pricing can't be read, the price is left out and the button is disabled
 * (checkout refuses too), and that state is never cached.
 */
function LifetimePlanCard() {

  return (
    <section className="relative flex flex-col justify-between rounded-2xl border-2 border-accent bg-card p-8 shadow-sm">

      <div>
        <SharedSwitch
          founder={<PlanHeading title="Lifetime Access" badge="One-Time Payment" />}
          yearly={<PlanHeading title="Yearly Access" badge="Renews Yearly" />}
          soon={<PlanHeading title="Yearly Access" badge="Coming Soon" />}
        />
        <p className="mt-2 text-sm text-muted">
          Everything from intermediate conversation to literary mastery.
        </p>
        <Suspense fallback={<PricePlaceholder />}>
          <LifetimePrice />
        </Suspense>

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
            <SharedSwitch
              founder={<>One-time payment during the founding offer</>}
              yearly={<>Renews yearly; cancel any time</>}
              soon={<>A new yearly plan is coming soon</>}
            />
          </li>
          <li className="flex items-center gap-3">
            <svg className="h-4 w-4 shrink-0 text-accent" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            Daily review: a few minutes a day to keep the words you&apos;ve learned
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

      {/* Tall enough for the access line or the access-unknown box, so whichever answer streams in, nothing moves. */}
      <div className="mt-8 flex min-h-[6.75rem] flex-col justify-end">
        <Suspense fallback={<ActionPlaceholder />}>
          <LifetimeAction />
        </Suspense>
      </div>
    </section>
  );
}

/** The paid card's title and badge: lifetime before the switch, yearly after it. */
function PlanHeading({ title, badge }: { title: string; badge: string }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="font-serif text-2xl font-semibold">{title}</h2>
      <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">{badge}</span>
    </div>
  );
}
