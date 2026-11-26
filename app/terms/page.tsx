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
        <p className="mt-2 text-sm text-muted">Last updated: 27 November 2026</p>
      </header>

      <div className="prose prose-lg mt-8 text-foreground prose-headings:font-serif prose-headings:font-semibold prose-headings:text-foreground prose-p:text-muted prose-li:text-muted prose-a:text-accent">
        <section>
          <h2>1. Overview</h2>
          <p>
            Welcome to <strong>French Properly</strong> (<em>frenchproperly.com</em>). By using our website, accessing
            our lessons, or buying lifetime access or a yearly subscription, you agree to these Terms of Service. If you disagree with any
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
            &quot;Lifetime access&quot; grants you access to the written B1–C2 lesson library and all future written
            lessons and curriculum updates included for as long as the French Properly service is operated commercially.
            It covers the core written curriculum and future written additions, excluding separate optional add-ons or
            future product tiers. There are no recurring fees or ongoing subscription dues.
          </p>
          <p>
            Lifetime access is sold during the founding offer only. The founding offer ends on 31 December 2026 at
            23:59 Bangkok time (16:59 UTC), or earlier once all founder places are taken, whichever comes first. The
            deadline is the same for everyone and is not extended for individual learners. Everyone who has bought
            lifetime access keeps it under these terms after the founding offer ends.
          </p>
        </section>

        <section className="mt-8">
          <h2>4. Yearly Subscription</h2>
          <p>
            After the founding offer ends, B1–C2 is sold as a yearly subscription. It costs $12 a year, plus tax where
            applicable, and gives access to the written B1–C2 lesson library, future written lessons and curriculum
            updates, and the daily review for as long as it&apos;s active.
          </p>
          <p>
            The subscription renews automatically every year, at the end of each paid year, until you cancel it.
          </p>
          <p>
            You can cancel at any time with <strong>Manage subscription</strong> on your Progress page, or with the
            link in the emails our Merchant of Record sends you. Cancelling stops the next renewal: your access
            continues until the end of the year you&apos;ve already paid for, and then ends.
          </p>
          <p>
            If a renewal payment fails, you have 7 days to update your card, and your access continues during those
            days. If the payment still hasn&apos;t gone through after 7 days, your access pauses until the payment is
            made.
          </p>
          <p>
            A change to the subscription price applies only to new subscriptions. Existing lifetime access isn&apos;t
            affected by the subscription: everyone who bought lifetime access keeps it under section 3.
          </p>
        </section>

        <section className="mt-8">
          <h2>5. Payments and Merchant of Record</h2>
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
          <h2>6. Fair Use & Account Integrity</h2>
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
          <h2>7. Refunds & Cancellations</h2>
          <p>
            Because all introductory lessons across A1 and A2 (100+ lessons) are free to try without payment or an
            account, all sales for B1–C2 lifetime access and all yearly subscription payments are final once unlocked,
            except in cases of duplicate billing errors or where mandatory statutory consumer protection laws apply.
          </p>
          <p className="mt-2">
            Cancelling a subscription isn&apos;t a refund: it stops future renewals, and access runs to the end of the
            paid year (see section 4).
          </p>
          <p className="mt-2">
            In the event that a refund or chargeback is processed, access to paid lesson levels is automatically and
            immediately revoked. Please review our full{" "}
            <Link href="/refund" className="underline underline-offset-2 hover:text-accent">
              Refund Policy
            </Link>{" "}
            for complete details.
          </p>
        </section>

        <section className="mt-8">
          <h2>8. Contact</h2>
          <p>
            If you have questions about these Terms of Service, please contact us at support@frenchproperly.com.
          </p>
        </section>
      </div>
    </main>
  );
}
