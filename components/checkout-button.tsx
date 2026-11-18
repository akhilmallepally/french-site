"use client";

import { useState, useTransition } from "react";
import { createCheckoutAction } from "@/app/actions/checkout";
import type { ProductKey } from "@/lib/payments/types";

interface CheckoutButtonProps {
  product?: ProductKey;
  className?: string;
  label?: string;
}

export function CheckoutButton({
  product = "lessons",
  className,
  label = "Get Lifetime Access",
}: CheckoutButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await createCheckoutAction(product);
        if (result.error) {
          setError(result.error);
          if (result.redirectUrl) {
            window.location.href = result.redirectUrl;
          }
          return;
        }
        if (result.checkoutUrl) {
          window.location.href = result.checkoutUrl;
          return;
        }
        if (result.redirectUrl) {
          window.location.href = result.redirectUrl;
          return;
        }
      } catch {
        setError("Unable to initiate checkout. Please try again.");
      }
    });
  }

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className={
          className ||
          "inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-8 py-2.5 font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        }
      >
        {isPending ? (
          <span className="flex items-center gap-2">
            <svg
              className="h-4 w-4 animate-spin text-white"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            Preparing checkout...
          </span>
        ) : (
          label
        )}
      </button>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
