import Link from "next/link";

// Every card links somewhere; the unlinked style below stays for a card without a page.
const features: { title: string; body: string; href?: string }[] = [
  { title: "Clear lessons", body: "Short, focused lessons with vocab tables and real examples. No fluff.", href: "/pricing" },
  { title: "Practice", body: "Every unit review in one place, with your best score.", href: "/practice" },
  { title: "Daily review", body: "A few minutes a day to keep the words you've learned.", href: "/review" },
];

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-6">
      <section className="py-20 text-center sm:py-28">
        <p className="text-sm font-medium uppercase tracking-widest text-accent">French for beginners</p>
        <h1 className="mt-4 font-serif text-5xl font-semibold tracking-tight sm:text-7xl">
          Learn French, <em className="text-accent">properly.</em>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-muted">
          Text-first lessons that explain the why, not just the what. Start from zero and build a real foundation.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
          <Link
            href="/pricing"
            className={`inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-7 py-3 font-medium text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${focusRing}`}
          >
            Start learning →
          </Link>
          <Link
            href="/lessons/a1"
            className={`inline-flex min-h-11 items-center justify-center rounded-full border border-border bg-card px-7 py-3 font-medium text-foreground transition hover:border-accent/40 hover:text-accent ${focusRing}`}
          >
            Try a free lesson
          </Link>
        </div>
      </section>

      <section className="grid gap-5 pb-24 sm:grid-cols-3">
        {features.map((f) =>
          f.href ? (
            <Link
              key={f.title}
              href={f.href}
              className={`group block rounded-2xl border border-border bg-card p-6 transition hover:border-accent/40 hover:shadow-sm ${focusRing}`}
            >
              <h2 className="font-serif text-xl font-semibold group-hover:text-accent group-hover:underline group-hover:underline-offset-4 group-focus-visible:text-accent group-focus-visible:underline group-focus-visible:underline-offset-4">
                {f.title}{" "}
                <span aria-hidden="true" className="inline-block text-accent transition group-hover:translate-x-1">
                  →
                </span>
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
            </Link>
          ) : (
            <div key={f.title} className="rounded-2xl border border-border bg-card p-6">
              <h2 className="font-serif text-xl font-semibold">{f.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
            </div>
          ),
        )}
      </section>
    </main>
  );
}
