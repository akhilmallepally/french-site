import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Refund Policy",
  description: "7-day full refund policy for French Properly.",
};

export default function RefundPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="border-b border-border pb-8">
        <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Refund Policy</h1>
        <p className="mt-2 text-sm text-muted">Last updated: November 2026</p>
      </header>

      <div className="prose prose-lg mt-8 text-foreground prose-headings:font-serif prose-headings:font-semibold prose-headings:text-foreground prose-p:text-muted prose-li:text-muted prose-a:text-accent">
        <section>
          <h2>7-Day Full Refund Guarantee</h2>
          <p>
            We want you to be completely satisfied with French Properly. If our curriculum or teaching style is not the
            right fit for you, we offer a <strong>100% full refund within 7 calendar days</strong> of your initial
            purchase. No questions asked.
          </p>
        </section>

        <section className="mt-8">
          <h2>How to Request a Refund</h2>
          <p>You can request your refund through either of the following methods:</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Via Receipt Email:</strong> Open the confirmation or receipt email sent by our Merchant of Record
              (Dodo Payments or Lemon Squeezy) upon purchase and click the self-service refund or customer portal link.
            </li>
            <li>
              <strong>Via Email Support:</strong> Send an email to{" "}
              <a href="mailto:support@frenchproperly.com">support@frenchproperly.com</a> with your order ID or the email
              address associated with your purchase. We will process your refund promptly within 24 hours.
            </li>
          </ul>
        </section>

        <section className="mt-8">
          <h2>Access Revocation</h2>
          <p>
            When a refund is issued, our payment provider notifies our system automatically via a secure webhook. Access
            to all paid levels (B1, B2, C1, and C2) will be revoked immediately upon refund processing.
          </p>
          <p>
            Introductory levels (A1 and A2) remain completely free and open to everyone forever, so you may continue using
            our foundational lessons at any time.
          </p>
        </section>

        <section className="mt-8">
          <h2>Processing Time</h2>
          <p>
            Once issued, refunds typically take 5 to 10 business days to appear on your original payment method, depending
            on your financial institution and local payment network.
          </p>
        </section>

        <section className="mt-8">
          <h2>Questions?</h2>
          <p>
            If you have any questions regarding our refund policy, review our{" "}
            <Link href="/terms" className="underline underline-offset-2 hover:text-accent">
              Terms of Service
            </Link>{" "}
            or email us at{" "}
            <a href="mailto:support@frenchproperly.com">support@frenchproperly.com</a>.
          </p>
        </section>
      </div>
    </main>
  );
}
