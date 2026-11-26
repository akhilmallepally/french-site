import type { Metadata } from "next";
import { cache, Suspense } from "react";
import { PracticeLevels } from "@/components/practice-levels";
import { getCurrentUser } from "@/lib/current-user";
import { getAllLessons, getProgressIndex, isFreeLevel, LEVEL_INFO, LEVELS } from "@/lib/lessons";
import { buildPracticeIndex, type PracticeLesson } from "@/lib/practice";
import { hasActiveEntitlement, type AccessState } from "@/lib/purchases";
import { AccessUnknownInline } from "@/components/access-unknown";
import { OfferSwitch } from "@/components/founder-offer";
import { getSharedOffer } from "@/lib/shared-pricing";
import type { PriceOffer } from "@/lib/pricing-offer";
import { connection } from "next/server";

export const metadata: Metadata = {
  title: "Practice",
  description: "Every unit review and level review of the French course in one place, with your best score on each.",
};

// One sign-in check and one access check per request, however many paid levels ask.
const paidAccess = cache(async (): Promise<AccessState> => {
  const user = await getCurrentUser();
  return user ? hasActiveEntitlement(user.id, "lessons") : "no";
});

// The offer for this request's time, for the lock's wording (lifetime before the switch, yearly after).
const lockOffer = cache(async (): Promise<{ offer: PriceOffer; nowMs: number }> => {
  await connection();
  const nowMs = Date.now();
  return { offer: await getSharedOffer("lessons", nowMs), nowMs };
});

/** A lock on a paid level for learners without access. Its slot is the same size either way. */
async function LevelLock({ level }: { level: string }) {
  const access = await paidAccess();
  if (access === "unknown") return <LockSlot level={level} locked="unknown" />;
  if (access === "yes") return <LockSlot level={level} locked={false} />;
  const { offer, nowMs } = await lockOffer();
  return <LockSlot level={level} locked={true} offer={offer} nowMs={nowMs} />;
}

function LockSlot({ level, locked, offer, nowMs }: { level: string; locked: boolean | null | "unknown"; offer?: PriceOffer; nowMs?: number }) {
  if (locked === "unknown") {
    return (
      <span className="inline-flex h-6 min-w-[8.5rem] items-center">
        <AccessUnknownInline />
      </span>
    );
  }
  const label = (text: string) => (
    <span>
      {text}
      <span className="sr-only"> needed for {level}</span>
    </span>
  );
  return (
    <span className="inline-flex h-6 min-w-[8.5rem] items-center text-xs font-medium text-muted">
      {locked && (
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-0.5">
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
            <path fillRule="evenodd" d="M10 2a4 4 0 0 0-4 4v2H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-1V6a4 4 0 0 0-4-4Zm2 6V6a2 2 0 1 0-4 0v2h4Z" clipRule="evenodd" />
          </svg>
          {offer && nowMs !== undefined ? (
            <OfferSwitch offer={offer} nowMs={nowMs} founder={label("Lifetime access")} yearly={label("Yearly access")} soon={label("Paid access")} />
          ) : (
            label("Lifetime access")
          )}
        </span>
      )}
    </span>
  );
}

/**
 * An index of the review lessons that already exist, by level and unit, in course order. No new
 * exercises: each entry links to the review lesson's own exercises (#practice). The list is static;
 * best scores are read in the browser (PracticeLevels), and only the paid-level locks read the session.
 */
export default function PracticePage() {
  const index = getProgressIndex();
  const catalogue: PracticeLesson[] = getAllLessons().map((l) => ({
    id: l.id,
    title: l.title,
    href: l.href,
    level: l.level,
    unit: l.unit,
    type: l.type,
    free: isFreeLevel(l.level),
    exercises: index.lessons[l.id]?.exercises.length ?? 0,
  }));
  const levels = buildPracticeIndex(catalogue);
  const levelNames = Object.fromEntries(LEVELS.map((level) => [level, LEVEL_INFO[level].name]));
  const locks = Object.fromEntries(
    levels
      .filter((l) => !l.free)
      .map((l) => [
        l.level,
        <Suspense key={l.level} fallback={<LockSlot level={l.level} locked={null} />}>
          <LevelLock level={l.level} />
        </Suspense>,
      ]),
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="font-serif text-4xl font-semibold tracking-tight">Practice</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Every unit review and level review in one place, with your best score. Each review mixes the exercises of its unit; open one
        to practise on its own page.
      </p>
      <PracticeLevels levels={levels} levelNames={levelNames} locks={locks} />
    </main>
  );
}
