import type { Metadata } from "next";
import Link from "next/link";
import { Fraunces, Inter } from "next/font/google";
import AuthButton from "@/components/auth-button";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://frenchproperly.com"),
  title: { default: "French Properly: Learn French", template: "%s · French Properly" },
  description: "Clear, structured French lessons from A1 to C2.",
  openGraph: {
    siteName: "French Properly",
    locale: "en_US",
    type: "website",
    title: "French Properly: Learn French",
    description: "Clear, structured French lessons from A1 to C2.",
    url: "https://frenchproperly.com",
  },
  twitter: {
    card: "summary_large_image",
    title: "French Properly: Learn French",
    description: "Clear, structured French lessons from A1 to C2.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <header className="border-b border-border">
          <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 sm:px-6 py-4">
            <Link href="/" className="font-serif text-xl sm:text-2xl font-semibold tracking-tight">
              French Properly<span className="text-accent">.</span>
            </Link>

            <div className="flex items-center gap-3 sm:gap-6">
              <Link href="/lessons" className="text-sm font-medium text-muted transition-colors hover:text-accent">
                Lessons
              </Link>
              <Link href="/pricing" className="text-sm font-medium text-muted transition-colors hover:text-accent">
                Pricing
              </Link>
              <AuthButton />
            </div>
          </nav>
        </header>

        <div className="flex-1">{children}</div>

        <footer className="border-t border-border">
          <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-6 py-6 text-sm text-muted sm:flex-row">
            <div>French Properly. Learn French, one lesson at a time.</div>
            <div className="flex items-center gap-6">
              <Link href="/pricing" className="transition-colors hover:text-accent">
                Pricing
              </Link>
              <Link href="/terms" className="transition-colors hover:text-accent">
                Terms
              </Link>
              <Link href="/privacy" className="transition-colors hover:text-accent">
                Privacy
              </Link>
              <Link href="/refund" className="transition-colors hover:text-accent">
                Refund Policy
              </Link>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
