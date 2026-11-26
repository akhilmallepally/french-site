import type { Metadata } from "next";
import { ReviewSession } from "@/components/review-session";

// Personal, so never indexed (and not in the sitemap).
export const metadata: Metadata = {
  title: "Daily review",
  description: "A few minutes a day with the words from the lessons you've practised.",
  robots: { index: false, follow: true },
};

/**
 * Prerendered for everyone: a static shell. The learner's cards are read in the browser from the
 * review store (docs/plans/review.md, section 6), and the text of each batch is fetched by a server
 * action, so the page itself holds no card text and reads no cookies.
 */
export default function ReviewPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-12 sm:px-6">
      <h1 className="font-serif text-4xl font-semibold tracking-tight">Daily review</h1>
      <ReviewSession />
    </main>
  );
}
