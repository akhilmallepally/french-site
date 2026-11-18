"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { checkEntitlementStatusAction } from "@/app/actions/checkout";
import type { ProductKey } from "@/lib/payments/types";

interface CheckoutPollerProps {
  product?: ProductKey;
}

export function CheckoutPoller({ product = "lessons" }: CheckoutPollerProps) {
  const router = useRouter();
  const [attempts, setAttempts] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (confirmed || timedOut) return;

    const interval = setInterval(async () => {
      setAttempts((prev) => {
        const next = prev + 1;
        if (next >= 10) {
          clearInterval(interval);
          setTimedOut(true);
        }
        return next;
      });

      try {
        const active = await checkEntitlementStatusAction(product);
        if (active) {
          clearInterval(interval);
          setConfirmed(true);
          router.refresh();
        }
      } catch {
        // Continue polling
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [confirmed, timedOut, product, router]);

  if (confirmed) {
    return (
      <div className="text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400">
          <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="mt-4 font-serif text-2xl font-semibold">Payment Confirmed!</h2>
        <p className="mt-2 text-muted">Your lifetime access to French Properly is now active.</p>
        <div className="mt-6 flex justify-center">
          <Link
            href="/lessons/b1"
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-8 py-2.5 font-medium text-white transition hover:opacity-90"
          >
            Start learning B1
          </Link>
        </div>
      </div>
    );
  }

  if (timedOut) {
    return (
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="mt-4 font-serif text-2xl font-semibold">Payment Received</h2>
        <p className="mx-auto mt-3 max-w-md text-muted leading-relaxed">
          We&apos;re finishing setting up your account. It can sometimes take a minute or two for the payment provider
          to confirm.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-4">
          <button
            type="button"
            onClick={() => {
              setTimedOut(false);
              setAttempts(0);
            }}
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-border bg-card px-6 py-2.5 font-medium transition hover:border-accent/40"
          >
            Check again
          </button>
          <Link
            href="/lessons"
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-6 py-2.5 font-medium text-white transition hover:opacity-90"
          >
            Browse lessons
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center">
        <svg className="h-8 w-8 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
      </div>
      <h2 className="mt-4 font-serif text-2xl font-semibold">Confirming your purchase...</h2>
      <p className="mt-2 text-muted">This usually takes just a few seconds.</p>
    </div>
  );
}
