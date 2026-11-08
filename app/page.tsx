import Link from "next/link";

const features = [
  { title: "Clear lessons", body: "Short, focused lessons with vocab tables and real examples. No fluff." },
  { title: "Smart practice", body: "Exercises that target exactly what you just learned." },
  { title: "Daily review", body: "Spaced repetition brings words back right before you forget them." },
];

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
        <Link
          href="/lessons"
          className="mt-10 inline-block rounded-full bg-accent px-7 py-3 font-medium text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          Start learning →
        </Link>
      </section>

      <section className="grid gap-5 pb-24 sm:grid-cols-3">
        {features.map((f) => (
          <div key={f.title} className="rounded-2xl border border-border bg-card p-6">
            <h2 className="font-serif text-xl font-semibold">{f.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
