// The lesson article, vocab tables and exercises. Server component. It loads the body only with a
// LessonAccess, so for a gated level it runs only after the server-side sign-in check.
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import { ExercisePlayer } from "@/components/exercise-player";
import { mdxComponents, VocabTable } from "@/components/mdx";
import { SignInPanel } from "@/components/sign-in-panel";
import { grantLessonAccess } from "@/lib/auth";
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
 * A gated lesson. Runs at request time inside <Suspense>: it checks the user with getUser() on the
 * server and loads the body only in the signed-in branch. Signed out, it renders the sign-in panel
 * and nothing from the lesson.
 */
export async function GatedLessonBody({ meta }: { meta: LessonMeta }) {
  const access = await grantLessonAccess(meta);
  if (!access) return <SignInPanel next={meta.href} />;
  return <LessonBody access={access} />;
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
