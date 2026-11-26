import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { getAccessDetails } from "@/lib/purchases";
import { accessLine } from "@/lib/access-wording";
import { CheckoutPoller } from "@/components/checkout-poller";

export const metadata: Metadata = {
  title: "Payment Confirmation",
  robots: { index: false },
};

export default function CheckoutSuccessPage() {
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <div className="rounded-2xl border border-border bg-card px-6 py-12 text-center sm:px-10">
        <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-border/40" />}>
          <CheckoutSuccessContent />
        </Suspense>
      </div>
    </main>
  );
}

async function CheckoutSuccessContent() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/sign-in?next=/checkout/success");
  }

  // A lifetime purchase or a new subscription row (has_access() counts both). "unknown" (the check
  // failed) keeps the poller checking, as before the webhook has run.
  const details = await getAccessDetails(user.id, "lessons");
  const isEntitled = details.state === "yes";
  const subscribed = details.state === "yes" && details.kind === "subscription";

  return (
    <>
      {isEntitled ? (
        <div>
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400">
            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="mt-5 font-serif text-3xl font-semibold tracking-tight">You&apos;re in!</h1>
          <p className="mx-auto mt-3 max-w-md text-muted leading-relaxed">
            {subscribed ? (
              <>
                Thank you for subscribing to French Properly. You now have full access to B1 to C2, all future written
                lessons and curriculum updates, and the daily review. {details.state === "yes" ? `${accessLine(details).text}.` : ""}
              </>
            ) : (
              <>
                Thank you for purchasing lifetime access to French Properly. You now have full access to B1 to C2 and all
                future written lessons and curriculum updates included.
              </>
            )}
          </p>
          <div className="mt-8 flex justify-center">
            <Link
              href="/lessons/b1"
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-8 py-2.5 font-medium text-white transition hover:opacity-90"
            >
              Start learning B1
            </Link>
          </div>
        </div>
      ) : (
        <CheckoutPoller product="lessons" />
      )}
    </>
  );
}
