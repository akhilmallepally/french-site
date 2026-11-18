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
            focused, distraction-free, and respectful of your privacy. We do not sell your personal data, and we do not
            use third-party tracking scripts or advertising cookies.
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
              device in your browser.
            </li>
          </ul>
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
              <strong>Supabase:</strong> For secure database management and user authentication.
            </li>
            <li>
              <strong>Merchant of Record:</strong> For handling secure payment processing, invoicing, and tax compliance.
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
