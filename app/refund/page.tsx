import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Refund Policy",
  description: "Refund policy for French Properly digital access.",
};

export default function RefundPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="border-b border-border pb-8">
        <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Refund Policy</h1>
        <p className="mt-2 text-sm text-muted">Last updated: 27 November 2026</p>
      </header>

      <div className="prose prose-lg mt-8 text-foreground prose-headings:font-serif prose-headings:font-semibold prose-headings:text-foreground prose-p:text-muted prose-li:text-muted prose-a:text-accent">
        <section>
          <h2>All Sales Final</h2>
          <p>
            Because all introductory lessons across A1 and A2 (100+ lessons) are completely free to try with no account
            or payment required, all purchases for B1–C2 lifetime access grant immediate, irrevocable digital access and
            are <strong>final and non-refundable</strong> once unlocked.
          </p>
          <p>
            Lifetime access is sold during the founding offer only, which ends on 31 December 2026 at 23:59 Bangkok
            time, or earlier once all founder places are taken. A purchase made during the founding offer follows this
            policy after the offer ends, too.
          </p>
          <p>
            We encourage all learners to explore the extensive free curriculum to ensure our pedagogical style meets
            their needs prior to completing a purchase.
          </p>
        </section>

        <section className="mt-8">
          <h2>Yearly Subscription Payments</h2>
          <p>
            Yearly subscription payments, the first one and each renewal, are <strong>final and non-refundable</strong>{" "}
            once access is unlocked, with the same exceptions as below.
          </p>
          <p>
            Cancelling a subscription isn&apos;t a refund. It stops the next renewal, and your access continues until
            the end of the year you&apos;ve already paid for.
          </p>
        </section>

        <section className="mt-8">
          <h2>Exceptions & Billing Errors</h2>
          <p>We review refund requests solely under the following limited circumstances:</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Duplicate or Technical Billing Errors:</strong> If a technical issue caused duplicate charges or
              an erroneous transaction, we will promptly refund the duplicate charge.
            </li>
            <li>
              <strong>Mandatory Consumer Rights:</strong> Where applicable statutory consumer protection laws in your
              jurisdiction mandate a statutory cancellation period for digital content, transactions will be handled in
              accordance with applicable law via Dodo Payments as our Merchant of Record.
            </li>
          </ul>
        </section>

        <section className="mt-8">
          <h2>Access Revocation on Refund</h2>
          <p>
            If a refund, dispute, or chargeback is processed for any reason, our Merchant of Record automatically notifies
            our system via webhook. Access to all paid levels (B1, B2, C1, and C2) is immediately and permanently
            revoked upon refund.
          </p>
          <p>
            For a yearly subscription, a refunded payment ends that subscription&apos;s access at once, even if part of
            the paid year is left.
          </p>
          <p>
            Introductory levels (A1 and A2) remain completely free and accessible at all times.
          </p>
        </section>

        <section className="mt-8">
          <h2>Contact Support</h2>
          <p>
            If you experienced a duplicate charge or billing error, please email us at{" "}
            <a href="mailto:support@frenchproperly.com">support@frenchproperly.com</a> with your order ID and transaction
            details. You may also review our{" "}
            <Link href="/terms" className="underline underline-offset-2 hover:text-accent">
              Terms of Service
            </Link>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
