// Fakes for the review sync tests: a server that runs the real runReviewSync and runReviewGet against
// an in-memory review_cards following apply_review's rules (0008), and worlds that share the
// progress fakes (storage, Web Locks, clock). Used by lib/review-sync*.test.ts (not a test file).
import fs from "node:fs";
import path from "node:path";
import { A, Clock, FakeLocks, FakeStorage, settle } from "./progress-test-fakes.ts";
import type { FacadeEnv } from "./progress-store.ts";
import type { ReviewIdIndex } from "./review-catalogue.ts";
import { parseReviewOutbox, reviewOutboxKey, type ReviewItem, type ReviewOutbox } from "./review-outbox.ts";
import { applyReview, type CardState } from "./review-scheduler.ts";
import { LocalReviewStore } from "./review-store.ts";
import { ReviewSyncFacade, SupabaseReviewStore, type ReviewActions, type ReviewWiring } from "./review-sync-store.ts";
import { runReviewGet, runReviewSync, type ReviewDb, type ReviewRow } from "./review-sync.ts";

export { A, B, settle } from "./progress-test-fakes.ts";

export const CARD_INDEX: ReviewIdIndex = JSON.parse(fs.readFileSync(path.join(process.cwd(), "lib", "generated", "review-card-ids.json"), "utf8"));
const allIds = (pick: (level: string) => boolean) =>
  Object.entries(CARD_INDEX.lessons).filter(([, l]) => pick(l.level)).flatMap(([lesson, l]) => l.cards.map((s) => `${lesson}-${s}`));
export const FREE_IDS = allIds((l) => l === "A1" || l === "A2");
export const PAID_IDS = allIds((l) => l !== "A1" && l !== "A2");
export const CAP = 6000;

export type Behaviour = "ok" | "network" | "not-found" | "unavailable" | "malformed" | "invalid" | "block" | "hang";

const toRow = (id: string, s: CardState): ReviewRow => ({ card_id: id, box: s.box, due_at: s.dueAt, last_reviewed_at: s.lastReviewedAt, review_count: s.reviews, lapse_count: s.lapses });
const fromItem = (i: ReviewItem): CardState => ({ box: i.box, dueAt: i.dueAt, lastReviewedAt: i.lastReviewedAt, reviews: i.reviews, lapses: i.lapses });

export class ReviewFakeServer {
  cards = new Map<string, Map<string, CardState>>();
  access = new Set<string>();
  accessChecks = 0;
  sessionUser: string | null = A;
  behaviour: Behaviour = "ok";
  rejectKeys = new Map<string, string>();
  calls: { expectedUserId: string; items: ReviewItem[] }[] = [];
  gets = 0;
  private blocked: (() => void)[] = [];

  of(user: string): Map<string, CardState> {
    if (!this.cards.has(user)) this.cards.set(user, new Map());
    return this.cards.get(user)!;
  }

  /** apply_review in memory: the merge, the cap on new cards, and forced rejections. */
  db(user: string): ReviewDb {
    const rows = this.of(user);
    return {
      apply: async (items) => {
        const applied: string[] = [];
        const rejected: { key: string; code: string }[] = [];
        for (const i of items) {
          if (this.rejectKeys.has(i.key)) rejected.push({ key: i.key, code: this.rejectKeys.get(i.key)! });
          else if (!rows.has(i.cardId) && rows.size >= CAP) rejected.push({ key: i.key, code: "cap_reached" });
          else {
            rows.set(i.cardId, applyReview(rows.get(i.cardId), fromItem(i)));
            applied.push(i.key);
          }
        }
        return { applied, rejected };
      },
      read: async (ids) => [...rows].filter(([id]) => ids.includes(id)).map(([id, s]) => toRow(id, s)),
      readAll: async () => [...rows].map(([id, s]) => toRow(id, s)),
      deleteAll: async () => rows.clear(),
    };
  }

  private hasAccess(user: string) {
    return async () => {
      this.accessChecks++;
      return this.access.has(user);
    };
  }

  actionsFor(clock: Clock): ReviewActions {
    return {
      sync: async (input) => {
        this.calls.push(JSON.parse(JSON.stringify(input)));
        if (this.behaviour === "block") await new Promise<void>((r) => this.blocked.push(r));
        if (this.behaviour === "hang") return new Promise(() => {});
        if (this.behaviour === "network") throw new TypeError("fetch failed");
        if (this.behaviour === "not-found") throw new Error("Server Action unavailable.");
        if (this.behaviour === "unavailable") return { status: "unavailable" };
        if (this.behaviour === "malformed") return "<html>";
        if (this.behaviour === "invalid") return { status: "invalid", code: "unexpected_field" };
        if (!this.sessionUser) return { status: "signed-out" };
        const u = this.sessionUser;
        return runReviewSync(input, { userId: u, index: CARD_INDEX, nowMs: clock.now, db: this.db(u), hasAccess: this.hasAccess(u) });
      },
      get: async (expectedUserId) => {
        this.gets++;
        if (!this.sessionUser) return { status: "signed-out" };
        if (this.sessionUser !== expectedUserId) return { status: "wrong-user" };
        const u = this.sessionUser;
        return runReviewGet({ userId: u, index: CARD_INDEX, db: this.db(u), hasAccess: this.hasAccess(u) });
      },
      reset: async () => ({ status: "ok" }),
    };
  }

  release() {
    this.behaviour = "ok";
    for (const r of this.blocked.splice(0)) r();
  }

  sentKeys(): string[] {
    return this.calls.flatMap((c) => c.items.map((i) => i.key));
  }
}

export type ReviewWorld = { storage: FakeStorage; locks: FakeLocks | null; clock: Clock; server: ReviewFakeServer; warnings: string[]; env: FacadeEnv; cookieUser: string | null };

export function reviewWorld(opts: { locks?: boolean } = {}): ReviewWorld {
  const storage = new FakeStorage();
  const locks = opts.locks === false ? null : new FakeLocks();
  const clock = new Clock();
  const warnings: string[] = [];
  const w = { storage, locks, clock, server: new ReviewFakeServer(), warnings, cookieUser: null as string | null } as ReviewWorld;
  w.env = { storage, locks, now: () => clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, warn: (m) => warnings.push(m), on: () => {}, storedSessionUser: () => w.cookieUser };
  return w;
}

export const reviewStoreFor = (w: ReviewWorld, user = A, onWrongUser?: () => void, onSignedOut?: () => void) =>
  new SupabaseReviewStore(user, w.server.actionsFor(w.clock), w.env, onWrongUser, onSignedOut);
export const reviewOutboxOf = (w: ReviewWorld, user = A): ReviewOutbox => parseReviewOutbox(w.storage.getItem(reviewOutboxKey(user)), user);

/** A facade with a fake session. Pass `existing` to share storage and server (a reload, a second tab). */
export function reviewFacadeWorld(initialUser: string | null, existing?: ReviewWorld, opts: { holdWiring?: Promise<void> } = {}) {
  const w = existing ?? reviewWorld();
  w.server.sessionUser = initialUser;
  w.cookieUser = initialUser;
  let user = initialUser;
  let verify: () => Promise<string | null> = async () => user;
  let listener: (u: string | null) => void = () => {};
  let loads = 0;
  const wiring: ReviewWiring = {
    auth: { getUserId: async () => user, verifyUserId: () => verify(), onChange: (cb) => (listener = cb) },
    actions: w.server.actionsFor(w.clock),
  };
  const local = new LocalReviewStore(() => w.cookieUser, () => w.storage);
  const facade = new ReviewSyncFacade(
    async () => {
      loads++;
      if (opts.holdWiring) await opts.holdWiring;
      return wiring;
    },
    () => w.env,
    local,
  );
  return {
    w,
    facade,
    loads: () => loads,
    setVerify: (fn: () => Promise<string | null>) => {
      verify = fn;
    },
    switchTo: async (u: string | null) => {
      user = u;
      w.cookieUser = u;
      w.server.sessionUser = u;
      listener(u);
      await settle();
    },
  };
}
