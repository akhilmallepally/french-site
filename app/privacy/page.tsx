import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy Policy for French Properly (frenchproperly.com).",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="border-b border-border pb-8">
        <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Privacy Policy</h1>
        <p className="mt-2 text-sm text-muted">Last updated: November 2026</p>
      </header>

      <div className="prose prose-lg mt-8 text-foreground prose-headings:font-serif prose-headings:font-semibold prose-headings:text-foreground prose-p:text-muted prose-li:text-muted prose-a:text-accent">
        <section>
          <h2>1. Overview</h2>
          <p>
            At <strong>French Properly</strong> (<em>frenchproperly.com</em>), we believe language learning should be
            focused, distraction-free, and respectful of your privacy. We do not sell your personal data. We use Vercel
            Web Analytics only to count page views. It is served from our own domain and uses no cookies, no cross-site
            tracking and no advertising.
          </p>
        </section>

        <section className="mt-8">
          <h2>2. Information We Collect</h2>
          <p>We collect only the minimum information necessary to provide and secure our educational services:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Account Information:</strong> When you sign in with Google OAuth, we receive your email address,
              name, and account identifier through Supabase Auth to identify your account and manage curriculum access.
            </li>
            <li>
              <strong>Purchase & Billing Information:</strong> When you purchase lifetime access, transactions are
              processed by our Merchant of Record (such as Dodo Payments). The Merchant of Record provides us with a
              customer identifier, order reference, and entitlement status. We never see or store your payment card details.
            </li>
            <li>
              <strong>Learning Progress:</strong> Your exercise submissions and lesson progress are stored locally on your
              device in your browser. When you&apos;re signed in, your progress may also be saved to your account so it
              follows you across devices (see Supabase below). The text you write in writing tasks never leaves your
              browser.
            </li>
          </ul>
          <p>
            <strong>Page views:</strong> We use Vercel Web Analytics to count page views. It doesn&apos;t use cookies.
            For each page view it records the page address, the referring page, filtered query parameters, an
            approximate location (country, region and city), your browser, operating system and device type, and the
            time. Visitors are told apart only by a hash of the request, which is discarded after 24 hours, and nothing
            is collected that tracks you across other websites. See{" "}
            <a href="https://vercel.com/docs/analytics/privacy-policy">Vercel&apos;s Web Analytics privacy documentation</a>.
          </p>
        </section>

        <section className="mt-8">
          <h2>3. How We Use Your Information</h2>
          <p>We use your information solely to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Authenticate your account and grant access to purchased B1–C2 curriculum levels.</li>
            <li>Send essential transactional notifications or customer support responses upon request.</li>
            <li>Prevent abuse, automated scraping, and unauthorized account sharing.</li>
          </ul>
        </section>

        <section className="mt-8">
          <h2>4. Third-Party Service Providers</h2>
          <p>We work with trusted infrastructure partners to operate French Properly:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Vercel:</strong> Hosts the website and provides Web Analytics (page view counts).{" "}
              <a href="https://vercel.com/legal/privacy-policy">Vercel&apos;s privacy policy</a>.
            </li>
            <li>
              <strong>Supabase:</strong> Handles sign-in, your account and your purchase record (database and
              authentication). For signed-in learners it also stores learning progress: scores, completion and
              attempt times, and whether a writing task is done, never the writing text.{" "}
              <a href="https://supabase.com/privacy">Supabase&apos;s privacy policy</a>.
            </li>
            <li>
              <strong>Dodo Payments:</strong> Our Merchant of Record, handling payment processing, invoicing and tax
              compliance. <a href="https://dodopayments.com/privacy-policy">Dodo Payments&apos; privacy policy</a>.
            </li>
          </ul>
        </section>

        <section className="mt-8">
          <h2>5. Cookies & Local Storage</h2>
          <p>
            We use strictly necessary first-party cookies to keep you signed in securely. We do not use third-party
            analytics cookies, advertising trackers, or social media pixels.
          </p>
        </section>

        <section className="mt-8">
          <h2>6. Your Rights & Data Deletion</h2>
          <p>
            You may request the deletion of your account and associated authentication data at any time by emailing us at{" "}
            support@frenchproperly.com.
          </p>
        </section>

        <section className="mt-8">
          <h2>7. Contact</h2>
          <p>
            If you have questions about this Privacy Policy or how your data is handled, please contact us at{" "}
            support@frenchproperly.com.
          </p>
          <p className="mt-2">
            See also our{" "}
            <Link href="/terms" className="underline underline-offset-2 hover:text-accent">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/refund" className="underline underline-offset-2 hover:text-accent">
              Refund Policy
            </Link>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
