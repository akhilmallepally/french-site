import type { Metadata } from "next";
import Link from "next/link";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Parlons: Learn French", template: "%s · Parlons" },
  description: "Clear, text-only French lessons for A1 beginners.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <header className="border-b border-border">
          <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
            <Link href="/" className="font-serif text-2xl font-semibold tracking-tight">
              Parlons<span className="text-accent">.</span>
            </Link>
            <Link href="/lessons" className="text-sm font-medium text-muted transition-colors hover:text-accent">
              Lessons
            </Link>
          </nav>
        </header>

        <div className="flex-1">{children}</div>

        <footer className="border-t border-border">
          <div className="mx-auto max-w-5xl px-6 py-6 text-sm text-muted">
            Parlons. Learn French, one lesson at a time.
          </div>
        </footer>
      </body>
    </html>
  );
}
