import Link from "next/link";
import { CheckoutButton } from "@/components/checkout-button";

interface PaywallPanelProps {
  spotsLeft: number;
  priceCents: number;
  currency: string;
  next?: string;
}

export function PaywallPanel({ spotsLeft }: PaywallPanelProps) {
  const isFounder = spotsLeft > 0;

  return (
    <section className="mt-8 rounded-2xl border border-border bg-card px-6 py-10 text-center sm:px-10">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">
        {isFounder ? "Founder Lifetime Access" : "Lifetime Access"}
      </p>
      <h2 className="mt-3 font-serif text-2xl font-semibold sm:text-3xl">
        Continue your learning from B1 to Mastery
      </h2>
      <p className="mx-auto mt-4 max-w-xl text-muted leading-relaxed">
        You&apos;ve finished the free levels. Bravo ! We hope A1 and A2 were useful. B1 to C1 is a one-time
        payment, with all future lessons included.{" "}
        {isFounder ? (
          <span>Founding price: $8 for the first 100 learners ({spotsLeft} left).</span>
        ) : (
          <span>Standard price: $12 for lifetime access.</span>
        )}
      </p>

      <div className="mt-6 flex justify-center">
        <CheckoutButton
          product="lessons"
          label={isFounder ? "Get founder access for $8" : "Get lifetime access for $12"}
        />
      </div>

      <p className="mt-4 text-xs text-muted">
        Try all A1 & A2 lessons free • One-time payment, lifetime access ·{" "}
        <Link href="/pricing" className="underline underline-offset-2 hover:text-accent">
          Pricing details
        </Link>{" "}
        ·{" "}
        <Link href="/refund" className="underline underline-offset-2 hover:text-accent">
          Refund policy
        </Link>
      </p>
    </section>
  );
}
