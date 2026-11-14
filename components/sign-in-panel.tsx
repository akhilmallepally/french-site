import Link from "next/link";
import { safeNext } from "@/lib/safe-next";

/** Shown instead of a gated lesson to signed-out visitors. Contains nothing from the lesson. */
export function SignInPanel({ next }: { next: string }) {
  const href = `/sign-in?next=${encodeURIComponent(safeNext(next))}`;
  return (
    <section className="mt-8 rounded-2xl border border-border bg-card px-6 py-10 text-center sm:px-10">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">Google sign-in required</p>
      <h2 className="mt-3 font-serif text-2xl font-semibold sm:text-3xl">
        Sign in with Google to read this lesson. It&apos;s free.
      </h2>
      <p className="mx-auto mt-3 max-w-md text-muted">
        A1 and A2 are open to everyone. From B1 on, lessons and exercises are free once you sign in, and you&apos;ll come
        straight back here.
      </p>
      <Link
        href={href}
        prefetch={false}
        className="mt-6 inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-6 py-2.5 font-medium text-white transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Sign in to continue
      </Link>
    </section>
  );
}
