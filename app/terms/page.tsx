import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms of Service for French Properly (frenchproperly.com).",
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="border-b border-border pb-8">
        <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Terms of Service</h1>
        <p className="mt-2 text-sm text-muted">Last updated: November 2026</p>
      </header>

      <div className="prose prose-lg mt-8 text-foreground prose-headings:font-serif prose-headings:font-semibold prose-headings:text-foreground prose-p:text-muted prose-li:text-muted prose-a:text-accent">
        <section>
          <h2>1. Overview</h2>
          <p>
            Welcome to <strong>French Properly</strong> (<em>frenchproperly.com</em>). By using our website, accessing
            our lessons, or purchasing lifetime access, you agree to these Terms of Service. If you disagree with any
            part of these terms, please do not use our service.
          </p>
        </section>

        <section className="mt-8">
          <h2>2. Personal Educational License</h2>
          <p>
            When you purchase access to French Properly, you are granted a non-exclusive, non-transferable, revocable
            license to access and use the educational content for your own personal, non-commercial language study.
          </p>
          <p>
            All rights, title, and interest in and to the curriculum, texts, exercises, and explanatory materials remain
            the intellectual property of French Properly.
          </p>
        </section>

        <section className="mt-8">
          <h2>3. Lifetime Access</h2>
          <p>
            &quot;Lifetime access&quot; grants you access to paid lesson levels (B1, B2, C1, C2, and any future lesson
            levels added to the main curriculum) for as long as the French Properly service is operated commercially.
            There are no recurring fees or ongoing subscription dues.
          </p>
        </section>

        <section className="mt-8">
          <h2>4. Payments and Merchant of Record</h2>
          <p>
            Payments are processed via an authorized Merchant of Record (such as Dodo Payments or Lemon Squeezy).
            The Merchant of Record handles transaction processing, invoicing, and applicable local sales tax, VAT, or
            GST calculation.
          </p>
          <p>
            We do not collect or store your payment card details. All transactions are subject to the security and
            privacy policies of the Merchant of Record.
          </p>
        </section>

        <section className="mt-8">
          <h2>5. Fair Use & Account Integrity</h2>
          <p>You agree not to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Share your account credentials with other individuals.</li>
            <li>Automate access to the site or scrape lesson materials, vocab tables, or exercise answers.</li>
            <li>Resell, redistribute, or republish lesson content in any form.</li>
            <li>Attempt to bypass or defeat access control checks or paywall gating.</li>
          </ul>
          <p className="mt-2">
            Accounts found violating fair use rules may be suspended or revoked without refund.
          </p>
        </section>

        <section className="mt-8">
          <h2>6. Refunds</h2>
          <p>
            We offer a full 7-day money-back guarantee on all lifetime purchases. For instructions and details on how to
            request a refund, please see our{" "}
            <Link href="/refund" className="underline underline-offset-2 hover:text-accent">
              Refund Policy
            </Link>
            .
          </p>
        </section>

        <section className="mt-8">
          <h2>7. Contact</h2>
          <p>
            If you have questions about these Terms of Service, please contact us at support@frenchproperly.com.
          </p>
        </section>
      </div>
    </main>
  );
}
