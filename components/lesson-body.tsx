// The lesson article, vocab tables and exercises. Server component. It loads the body only with a
// LessonAccess, so for a gated level it runs only after the server-side sign-in and entitlement check.
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import { ExercisePlayer } from "@/components/exercise-player";
import { mdxComponents, VocabTable } from "@/components/mdx";
import { SignInPanel } from "@/components/sign-in-panel";
import { PaywallPanel } from "@/components/paywall-panel";
import { checkLessonAccess } from "@/lib/auth";
import { AccessUnknown } from "@/components/access-unknown";
import { loadLessonFull, type LessonAccess, type LessonMeta } from "@/lib/lessons";

/** Renders the full lesson. Requires proof of access (lib/auth.ts). */
export function LessonBody({ access }: { access: LessonAccess }) {
  const lesson = loadLessonFull(access);
  return (
    <>
      <article className="prose prose-lg mt-8 max-w-none prose-headings:font-serif prose-headings:font-semibold prose-headings:text-foreground prose-p:text-foreground prose-li:text-foreground prose-strong:text-foreground prose-a:text-accent prose-a:underline-offset-2">
        <MDXRemote
          source={lesson.body}
          components={{
            ...mdxComponents,
            VocabTable: ({ group }: { group?: string }) => <VocabTable items={lesson.vocab} group={group} />,
          }}
          options={{ mdxOptions: { remarkPlugins: [remarkGfm] } }}
        />
      </article>

      {lesson.exercises.length > 0 && <ExercisePlayer key={lesson.id} lessonId={lesson.id} exercises={lesson.exercises} />}
    </>
  );
}

/**
 * A gated lesson. Runs at request time inside <Suspense>:
 * - Signed out: renders SignInPanel
 * - Signed in unpaid: renders PaywallPanel with live founder count and checkout
 * - Access check failed: "Couldn't check your access" with Retry (no paywall, no lesson)
 * - Paid: loads and renders the full lesson body and exercises
 */
export async function GatedLessonBody({ meta }: { meta: LessonMeta }) {
  const result = await checkLessonAccess(meta);

  if (result.status === "signed-out") {
    return <SignInPanel next={meta.href} offer={result.offer} nowMs={result.nowMs} />;
  }

  if (result.status === "unknown") return <AccessUnknown />;

  if (result.status === "unpaid") {
    return (
      <PaywallPanel offer={result.offer} nowMs={result.nowMs} next={meta.href} />
    );
  }

  return <LessonBody access={result.access} />;
}

/** Shown while the gated body streams in. No lesson content. */
export function LessonBodySkeleton() {
  return (
    <div className="mt-8 space-y-4" aria-hidden="true">
      <div className="h-4 w-3/4 animate-pulse rounded-full bg-border/60" />
      <div className="h-4 w-full animate-pulse rounded-full bg-border/60" />
      <div className="h-4 w-5/6 animate-pulse rounded-full bg-border/60" />
      <div className="mt-8 h-40 animate-pulse rounded-2xl border border-border bg-card/60" />
    </div>
  );
}
