import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { GoogleSignInButton } from "@/components/auth-button";
import { getCurrentUser } from "@/lib/auth";
import { safeNext } from "@/lib/safe-next";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <div className="rounded-2xl border border-border bg-card px-6 py-10 text-center sm:px-10">
        <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Sign in</h1>
        <p className="mx-auto mt-3 max-w-sm text-muted">
          A1 and A2 are open to everyone. Sign in with Google to read every lesson from B1 on. It&apos;s free.
        </p>
        <Suspense fallback={<div className="mx-auto mt-8 h-11 w-56 animate-pulse rounded-full bg-border/60" />}>
          <SignInContent searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

/** Reads the query and the session at request time. */
async function SignInContent({ searchParams }: { searchParams: PageProps<"/sign-in">["searchParams"] }) {
  const params = await searchParams;
  const next = safeNext(first(params.next));
  const failed = first(params.error) !== undefined;

  // Already signed in: go straight to where the visitor wanted to be.
  if (await getCurrentUser()) redirect(next);

  return (
    <>
      {failed && (
        <p role="alert" className="mx-auto mt-6 max-w-sm rounded-xl border border-border bg-background px-4 py-3 text-sm">
          Sign-in didn&apos;t go through. Please try again.
        </p>
      )}
      <div className="mt-8">
        <GoogleSignInButton next={next} />
      </div>
      {next !== "/" && <p className="mt-4 text-sm text-muted">You&apos;ll come back to the lesson you were reading.</p>}
    </>
  );
}
