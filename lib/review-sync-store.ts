// The synced review store and its facade (docs/plans/review.md, rollout step 4), built like the
// progress ones (lib/progress-store.ts) and reusing their environment, timings and rules:
// - Local first: every change is written to this user's cache and outbox at once (under a Web
//   Lock), then sent in batches of at most 200 entries and 120 KiB, one flusher per browser.
// - One in-flight and one pending entry per card; the server's rows win; rejected entries are never
//   resent but are kept (ids, boxes, times, counts only) so the learner's record stays visible.
// - Backoff on network errors and timeouts (25 s), a pause until the next page load on a 409
//   ("Server Action unavailable"), a malformed reply or an invalid payload.
// - Accounts: per-user keys, the session read from the cookie for early reads (an expired session is
//   nobody), a "signed-out" reply checked with the auth server and handled as a sign-out, other
//   accounts' caches swept on every switch.
// - Import: this browser's signed-out cards go to the account that owns the progress import claim
//   (IMPORT_OWNER_KEY, the same claim, never a second one); an account's own local cards always go to
//   that account. Queued with a marker under the lock, so an interrupted import resumes from the
//   outbox and nothing is queued twice.
// Separate flag: NEXT_PUBLIC_REVIEW_SYNC=on (lib/review.ts). Off, the app uses LocalReviewStore.
import {
  ACTION_TIMEOUT_MS,
  browserEnv,
  DEBOUNCE_MS,
  IMPORT_OWNER_KEY,
  isActionNotFound,
  RETRY_FIRST_MS,
  RETRY_MAX_MS,
  SNAPSHOT_EVERY_MS,
  type FacadeEnv,
  type StoreEnv,
  type Wiring,
} from "./progress-store.ts";
import {
  emptyReviewOutbox,
  isCardState,
  overlayCards,
  parseReviewCache,
  parseReviewOutbox,
  queueCard,
  queueReviewImport,
  REVIEW_CACHE_PREFIX,
  REVIEW_IMPORTED_MARKER_KEY,
  REVIEW_LAST_USER_KEY,
  reviewCacheKey,
  reviewHasWork,
  reviewOutboxKey,
  reviewRejectedKey,
  serializeReviewCache,
  settleReview,
  takeReviewBatch,
  type ReviewCache,
  type ReviewEntry,
  type ReviewItem,
  type ReviewOutbox,
} from "./review-outbox.ts";
import { answer, logAnswer, logDrawn, logFor, newCard, type Calendar, type CardState, type Grade } from "./review-scheduler.ts";
import { createLocalReviewStore, LocalReviewStore, mergeLogs, parseReviewData, REVIEW_KEY, reviewLocalKey, type ReviewData, type ReviewStore } from "./review-store.ts";

export type ReviewActions = {
  sync(input: { expectedUserId: string; items: ReviewItem[] }): Promise<unknown>;
  get(expectedUserId: string): Promise<unknown>;
  reset(input: { expectedUserId: string; confirm: "reset" }): Promise<unknown>;
};
export type ReviewWiring = { auth: Wiring["auth"]; actions: ReviewActions };

const OUTBOX_LOCK = "parlons-review-outbox";
const FLUSH_LOCK = "parlons-review-flush";
const MAX_REJECTIONS_KEPT = 500;

type KeptRejection = { key: string; code: string; at: string; entry?: ReviewEntry };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCards = (v: unknown): v is Record<string, CardState> => isObj(v) && Object.values(v).every(isCardState);

// ---------- The synced store ----------

export class SupabaseReviewStore implements ReviewStore {
  private flushing = false;
  private paused: string | null = null;
  private stopped = false;
  private retryMs = 0;
  private retryAt = 0;
  private flushTimer: unknown = null;
  private snapshot: Promise<void> | null = null;
  private snapshotAt = 0;
  private readonly listeners = new Set<() => void>();

  readonly userId: string;
  private readonly actions: ReviewActions;
  private readonly env: StoreEnv;
  private readonly onWrongUser: () => void;
  private readonly onSignedOut: () => void;

  constructor(userId: string, actions: ReviewActions, env: StoreEnv, onWrongUser: () => void = () => {}, onSignedOut: () => void = () => {}) {
    this.userId = userId;
    this.actions = actions;
    this.env = env;
    this.onWrongUser = onWrongUser;
    this.onSignedOut = onSignedOut;
  }

  // ----- storage (writes only inside withOutboxLock) -----

  private safe(fn: () => void): void {
    try {
      fn();
    } catch {
      // Storage blocked or full: the change just isn't saved.
    }
  }

  private readCache(): ReviewCache {
    try {
      return parseReviewCache(this.env.storage.getItem(reviewCacheKey(this.userId)), this.userId) ?? { cards: {} };
    } catch {
      return { cards: {} };
    }
  }

  private writeCache(cache: ReviewCache): void {
    this.safe(() => this.env.storage.setItem(reviewCacheKey(this.userId), serializeReviewCache(cache, this.userId)));
  }

  private readOutbox(): ReviewOutbox {
    try {
      return parseReviewOutbox(this.env.storage.getItem(reviewOutboxKey(this.userId)), this.userId);
    } catch {
      return emptyReviewOutbox(this.userId);
    }
  }

  private writeOutbox(outbox: ReviewOutbox): void {
    this.safe(() =>
      reviewHasWork(outbox)
        ? this.env.storage.setItem(reviewOutboxKey(this.userId), JSON.stringify(outbox))
        : this.env.storage.removeItem(reviewOutboxKey(this.userId)),
    );
  }

  /** The kept rejections (the newest 500), or none. */
  readRejections(): KeptRejection[] {
    try {
      const saved = JSON.parse(this.env.storage.getItem(reviewRejectedKey(this.userId)) ?? "null");
      if (isObj(saved) && saved.userId === this.userId && Array.isArray(saved.items)) return saved.items as KeptRejection[];
    } catch {
      // Corrupted log: start a new one.
    }
    return [];
  }

  private recordRejections(rejected: { key: string; code: string }[], before: ReviewOutbox): void {
    if (!rejected.length) return;
    const at = new Date(this.env.now()).toISOString();
    const added = rejected.map((r) => ({ key: r.key, code: String(r.code), at, ...(before.slots[r.key]?.inFlight ? { entry: before.slots[r.key].inFlight } : {}) }));
    const list = [...this.readRejections(), ...added].slice(-MAX_REJECTIONS_KEPT);
    this.safe(() => this.env.storage.setItem(reviewRejectedKey(this.userId), JSON.stringify({ userId: this.userId, items: list })));
    for (const r of rejected) this.env.warn(`[review] rejected ${r.key}: ${r.code}`);
  }

  /** The kept rejected states merged over `cards` (display only). */
  private withKept(cards: Record<string, CardState>): Record<string, CardState> {
    const slots: ReviewOutbox["slots"] = {};
    for (const r of this.readRejections()) if (r.entry && isCardState(r.entry.state)) slots[`kept:${r.key}:${r.at}`] = { pending: r.entry };
    return overlayCards(cards, { v: 1, userId: this.userId, seq: 0, slots });
  }

  private withOutboxLock<T>(fn: () => T): Promise<T> {
    if (!this.env.locks) return Promise.resolve().then(fn);
    return this.env.locks.request(OUTBOX_LOCK, {}, () => fn());
  }

  private timed<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = this.env.setTimer(() => reject(new Error("review action timed out")), ACTION_TIMEOUT_MS);
      promise.then(
        (v) => {
          this.env.clearTimer(timer);
          resolve(v);
        },
        (e) => {
          this.env.clearTimer(timer);
          reject(e);
        },
      );
    });
  }

  // ----- reads: never wait for the network -----

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of [...this.listeners]) {
      try {
        l();
      } catch {
        // A listener's error never stops the store.
      }
    }
  }

  async getAll(): Promise<ReviewData> {
    void this.ensureSnapshot();
    const c = this.readCache();
    return c.today ? { cards: c.cards, today: c.today } : { cards: c.cards };
  }

  /** The server's copy replaces the cache's cards, with kept rejections and the outbox on top. */
  ensureSnapshot(force = false): Promise<void> {
    if (this.snapshot && !force) return this.snapshot;
    this.snapshot = (async () => {
      try {
        const reply = await this.timed(this.actions.get(this.userId));
        if (isObj(reply) && reply.status === "ok" && isCards(reply.cards)) {
          const cards = reply.cards;
          await this.withOutboxLock(() => {
            const cache = this.readCache();
            this.writeCache({ ...cache, cards: overlayCards(this.withKept({ ...cards }), this.readOutbox()) });
          });
          this.snapshotAt = this.env.now();
          this.notify();
        } else if (isObj(reply) && reply.status === "wrong-user") {
          this.stop();
          this.onWrongUser();
        } else if (isObj(reply) && reply.status === "signed-out") {
          this.onSignedOut();
        }
      } catch {
        // Offline or Supabase down: the cache stays as it is.
      }
    })();
    return this.snapshot;
  }

  // ----- writes: local first, then a flush -----

  async addCards(cardIds: string[], nowMs: number): Promise<void> {
    const added = await this.withOutboxLock(() => {
      const cache = this.readCache();
      let outbox = this.readOutbox();
      let n = 0;
      for (const id of cardIds) {
        if (cache.cards[id]) continue;
        const s = newCard(nowMs);
        cache.cards[id] = s;
        outbox = queueCard(outbox, id, s);
        n++;
      }
      if (n) {
        this.writeOutbox(outbox);
        this.writeCache(cache);
      }
      return n;
    });
    if (added) this.scheduleFlush(DEBOUNCE_MS);
  }

  async recordAnswer(cardId: string, grade: Grade, nowMs: number, cal: Calendar): Promise<CardState | null> {
    const after = await this.withOutboxLock(() => {
      const cache = this.readCache();
      const before = cache.cards[cardId];
      if (!before) return null;
      const next = answer(before, grade, nowMs, cal);
      const today = cal.dayOf(nowMs);
      cache.cards[cardId] = next;
      cache.today = logAnswer(logFor(cache.today, today), today, cardId, before.box === 0);
      this.writeOutbox(queueCard(this.readOutbox(), cardId, next));
      this.writeCache(cache);
      return next;
    });
    if (after) this.scheduleFlush(DEBOUNCE_MS);
    return after;
  }

  async recordDrawn(cardIds: string[], nowMs: number, cal: Calendar): Promise<void> {
    if (!cardIds.length) return;
    await this.withOutboxLock(() => {
      const cache = this.readCache();
      cache.today = logDrawn(logFor(cache.today, cal.dayOf(nowMs)), cal.dayOf(nowMs), cardIds);
      this.writeCache(cache);
    });
  }

  /** Deletes this user's cache and outbox here, and their cards on the server. No UI calls it yet. */
  async reset(): Promise<void> {
    await this.withOutboxLock(() => {
      this.safe(() => this.env.storage.removeItem(reviewCacheKey(this.userId)));
      this.safe(() => this.env.storage.removeItem(reviewOutboxKey(this.userId)));
    });
    try {
      await this.timed(this.actions.reset({ expectedUserId: this.userId, confirm: "reset" }));
    } catch {
      // The server rows stay; nothing local is left to resend.
    }
  }

  // ----- sending -----

  scheduleFlush(ms: number, retry = false): void {
    if (this.stopped || this.paused) return;
    if (!retry && this.retryAt > this.env.now()) return;
    if (this.flushTimer !== null) this.env.clearTimer(this.flushTimer);
    this.flushTimer = this.env.setTimer(() => {
      this.flushTimer = null;
      void this.flush();
    }, ms);
  }

  private retryLater(): void {
    this.retryMs = this.retryMs ? Math.min(this.retryMs * 2, RETRY_MAX_MS) : RETRY_FIRST_MS;
    this.retryAt = this.env.now() + this.retryMs;
    this.scheduleFlush(this.retryMs, true);
  }

  private pause(reason: string): void {
    this.paused = reason;
    this.env.warn(`[review] sync paused until the next page load: ${reason}`);
  }

  get pausedReason(): string | null {
    return this.paused;
  }

  async flush(): Promise<void> {
    if (this.stopped || this.paused || this.flushing) return;
    this.flushing = true;
    try {
      const run = async () => {
        for (;;) {
          if (this.stopped || this.paused) return;
          const items = await this.withOutboxLock(() => {
            const { outbox, items } = takeReviewBatch(this.readOutbox());
            if (items.length) this.writeOutbox(outbox);
            return items;
          });
          if (!items.length) {
            this.retryMs = 0;
            this.retryAt = 0;
            return;
          }
          if ((await this.send(items)) !== "ok") return;
          this.retryMs = 0;
          this.retryAt = 0;
        }
      };
      if (!this.env.locks) await run();
      else {
        const got = await this.env.locks.request(FLUSH_LOCK, { ifAvailable: true }, async (lock) => {
          if (!lock) return false;
          await run();
          return true;
        });
        if (!got) this.scheduleFlush(2 * DEBOUNCE_MS);
      }
    } finally {
      this.flushing = false;
    }
  }

  private async send(items: ReviewItem[]): Promise<"ok" | "stop"> {
    let reply: unknown;
    try {
      reply = await this.timed(this.actions.sync({ expectedUserId: this.userId, items }));
    } catch (error) {
      if (isActionNotFound(error)) this.pause("server action not found (the site was updated)");
      else this.retryLater();
      return "stop";
    }
    if (!isObj(reply) || typeof reply.status !== "string") {
      this.pause("malformed reply");
      return "stop";
    }
    if (reply.status === "ok") {
      const { applied, rejected, rows } = reply;
      const rejectedOk = Array.isArray(rejected) && rejected.every((r) => isObj(r) && typeof r.key === "string");
      if (!Array.isArray(applied) || !applied.every((k) => typeof k === "string") || !rejectedOk || !isCards(rows)) {
        this.pause("malformed reply");
        return "stop";
      }
      const rejectedList = (rejected as { key: string; code: unknown }[]).map((r) => ({ key: r.key, code: String(r.code) }));
      await this.withOutboxLock(() => {
        const before = this.readOutbox();
        const outbox = settleReview(before, applied as string[], rejectedList.map((r) => r.key));
        this.writeOutbox(outbox);
        this.recordRejections(rejectedList, before);
        // The server's rows replace the cache's cards (the server wins), then the outbox goes on top.
        const cache = this.readCache();
        Object.assign(cache.cards, rows);
        this.writeCache({ ...cache, cards: overlayCards(cache.cards, outbox, Object.keys(rows)) });
      });
      this.notify();
      return "ok";
    }
    if (reply.status === "wrong-user") {
      this.stop();
      this.onWrongUser();
      return "stop";
    }
    if (reply.status === "invalid") {
      this.pause(`invalid payload (${String(reply.code)})`);
      return "stop";
    }
    if (reply.status === "signed-out") this.onSignedOut();
    this.retryLater();
    return "stop";
  }

  // ----- importing -----

  /**
   * This browser's signed-out cards, if this account owns the progress import claim (the first
   * account to sign in here claims it, once; later accounts never get it). Only cards changed after
   * the marker go in; the entries and the marker are written together under the lock. The
   * signed-out cards themselves stay where they are.
   */
  async importAnonymous(): Promise<number> {
    const queued = await this.withOutboxLock(() => {
      const storage = this.env.storage;
      let owner: string | null;
      let text: string | null;
      let markerText: string | null;
      try {
        owner = storage.getItem(IMPORT_OWNER_KEY);
        text = storage.getItem(REVIEW_KEY);
        markerText = storage.getItem(REVIEW_IMPORTED_MARKER_KEY);
      } catch {
        return 0;
      }
      if (owner === null) this.safe(() => storage.setItem(IMPORT_OWNER_KEY, this.userId));
      else if (owner !== this.userId) return 0;
      const anonymous = parseReviewData(text, null);
      const marker = Date.parse(markerText ?? "");
      const { outbox, keys, newestMs } = queueReviewImport(this.readOutbox(), anonymous.cards, Number.isFinite(marker) ? marker : Number.NEGATIVE_INFINITY);
      if (!keys.length) return 0;
      this.writeOutbox(outbox);
      this.safe(() => storage.setItem(REVIEW_IMPORTED_MARKER_KEY, new Date(newestMs).toISOString()));
      const cache = this.readCache();
      this.writeCache({ ...cache, cards: overlayCards(cache.cards, outbox, keys.map((k) => k.slice(2))) });
      return keys.length;
    });
    if (queued) {
      this.notify();
      this.scheduleFlush(0);
    }
    return queued;
  }

  /** This account's own local cards (saved while signed in with sync off) go to it, whatever the claim says. */
  async importLocal(): Promise<number> {
    const queued = await this.withOutboxLock(() => {
      const storage = this.env.storage;
      let text: string | null;
      try {
        text = storage.getItem(reviewLocalKey(this.userId));
      } catch {
        return 0;
      }
      if (text === null) return 0;
      const local = parseReviewData(text, this.userId);
      const { outbox, keys } = queueReviewImport(this.readOutbox(), local.cards, Number.NEGATIVE_INFINITY);
      const cache = this.readCache();
      const today = mergeLogs(cache.today, local.today);
      if (keys.length) this.writeOutbox(outbox);
      this.writeCache({ cards: overlayCards(cache.cards, outbox, keys.map((k) => k.slice(2))), ...(today ? { today } : {}) });
      this.safe(() => storage.removeItem(reviewLocalKey(this.userId)));
      return keys.length;
    });
    if (queued) {
      this.notify();
      this.scheduleFlush(0);
    }
    return queued;
  }

  // ----- lifecycle -----

  start(): void {
    void this.ensureSnapshot();
    void this.flush();
  }

  onOnline(): void {
    void this.flush();
  }

  onVisible(): void {
    if (this.env.now() - this.snapshotAt > SNAPSHOT_EVERY_MS) void this.ensureSnapshot(true);
    void this.flush();
  }

  stop(): void {
    this.stopped = true;
    if (this.flushTimer !== null) this.env.clearTimer(this.flushTimer);
    this.flushTimer = null;
  }

  /** Sign-out: delete this user's cache; keep a non-empty outbox for their next sign-in here. */
  async signOut(): Promise<void> {
    this.stop();
    await this.withOutboxLock(() => {
      this.safe(() => this.env.storage.removeItem(reviewCacheKey(this.userId)));
      if (!reviewHasWork(this.readOutbox())) this.safe(() => this.env.storage.removeItem(reviewOutboxKey(this.userId)));
    });
  }
}

// ---------- The facade ----------

/** Picks the synced store for the signed-in user, the local store otherwise (as SyncFacade does for progress). */
export class ReviewSyncFacade implements ReviewStore {
  private readonly local: ReviewStore;
  private remote: SupabaseReviewStore | null = null;
  private init: Promise<void> | null = null;
  private initDone = false;
  private wiring: ReviewWiring | null = null;
  private env: FacadeEnv | null = null;
  private readonly listeners = new Set<() => void>();
  private unsubscribeRemote: () => void = () => {};
  private selecting: Promise<void> = Promise.resolve();
  private verifying: Promise<void> | null = null;

  private readonly loadWiring: () => Promise<ReviewWiring>;
  private readonly makeEnv: () => FacadeEnv;

  constructor(loadWiring: () => Promise<ReviewWiring>, makeEnv: () => FacadeEnv, local?: ReviewStore) {
    this.loadWiring = loadWiring;
    this.makeEnv = makeEnv;
    this.local = local ?? new LocalReviewStore(() => this.envNow().storedSessionUser(), () => this.envNow().storage);
  }

  private envNow(): FacadeEnv {
    return (this.env ??= this.makeEnv());
  }

  /** The store answering now (for tests). */
  async currentStore(): Promise<ReviewStore> {
    await this.ensureInit();
    return this.remote ?? this.local;
  }

  /** The last account, but only while the browser still holds an unexpired session for it. */
  private trustedHint(): string | null {
    try {
      const hint = this.envNow().storage.getItem(REVIEW_LAST_USER_KEY);
      return hint && this.envNow().storedSessionUser() === hint ? hint : null;
    } catch {
      return null;
    }
  }

  /** Reads before the store is picked: the trusted account's cache, else the local store. Never the network. */
  private earlyData(): ReviewData | null {
    if (this.initDone) return null;
    void this.ensureInit();
    const hint = this.trustedHint();
    if (!hint) return null;
    try {
      const c = parseReviewCache(this.envNow().storage.getItem(reviewCacheKey(hint)), hint);
      return c ? (c.today ? { cards: c.cards, today: c.today } : { cards: c.cards }) : { cards: {} };
    } catch {
      return { cards: {} };
    }
  }

  private ensureInit(): Promise<void> {
    this.init ??= (async () => {
      try {
        this.envNow();
        this.wiring = await this.loadWiring();
        this.wiring.auth.onChange((userId) => void this.select(userId));
        await this.select(await this.wiring.auth.getUserId());
        this.env!.on("online", () => this.remote?.onOnline());
        this.env!.on("visible", () => this.remote?.onVisible());
      } catch {
        this.remote = null;
      }
      this.initDone = true;
      this.notify();
    })();
    return this.init;
  }

  select(userId: string | null): Promise<void> {
    this.selecting = this.selecting.then(() => this.selectNow(userId)).catch(() => {});
    return this.selecting;
  }

  private async selectNow(userId: string | null): Promise<void> {
    if (!this.env || !this.wiring) return;
    if (this.remote?.userId === userId) return;
    const previous = this.remote;
    this.remote = null;
    this.unsubscribeRemote();
    this.unsubscribeRemote = () => {};
    if (previous) await previous.signOut();
    this.sweepCaches(userId);
    try {
      if (userId) this.env.storage.setItem(REVIEW_LAST_USER_KEY, userId);
      else this.env.storage.removeItem(REVIEW_LAST_USER_KEY);
    } catch {
      // Storage blocked: early reads use the local store.
    }
    if (userId) {
      const store = new SupabaseReviewStore(userId, this.wiring.actions, this.env, () => void this.recheck(), () => void this.verifySession());
      this.remote = store;
      this.unsubscribeRemote = store.subscribe(() => this.notify());
      await store.importLocal();
      await store.importAnonymous();
      store.start();
    }
    this.notify();
  }

  /** No other account's synced copy stays readable here; outboxes stay, sent only by their own account. */
  private sweepCaches(keepUserId: string | null): void {
    const storage = this.env!.storage;
    try {
      const doomed: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k?.startsWith(REVIEW_CACHE_PREFIX) && k !== (keepUserId ? reviewCacheKey(keepUserId) : null)) doomed.push(k);
      }
      for (const k of doomed) storage.removeItem(k);
    } catch {
      // Storage blocked.
    }
  }

  /** The server said "signed-out": if the auth server agrees, do what a sign-out does. */
  private verifySession(): Promise<void> {
    this.verifying ??= (async () => {
      try {
        if (!this.wiring || !this.remote) return;
        const confirmed = await this.wiring.auth.verifyUserId();
        if (confirmed !== this.remote?.userId) await this.select(confirmed);
      } catch {
        // Couldn't reach the auth server: nothing changes.
      } finally {
        this.verifying = null;
      }
    })();
    return this.verifying;
  }

  /** The server says another user is signed in: follow the browser's session. */
  private async recheck(): Promise<void> {
    if (!this.wiring) return;
    const stale = this.remote;
    try {
      const userId = await this.wiring.auth.getUserId();
      if (stale && userId === stale.userId) return; // stay stopped until the page reloads
      await this.select(userId);
    } catch {
      // Keep the stopped store.
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of [...this.listeners]) {
      try {
        l();
      } catch {
        // A listener's error never stops the store.
      }
    }
  }

  private async store(): Promise<ReviewStore> {
    await this.ensureInit();
    return this.remote ?? this.local;
  }

  async getAll(): Promise<ReviewData> {
    const early = this.earlyData();
    if (early) return early;
    if (!this.initDone) return this.local.getAll();
    return (await this.store()).getAll();
  }
  async addCards(cardIds: string[], nowMs: number) {
    return (await this.store()).addCards(cardIds, nowMs);
  }
  async recordAnswer(cardId: string, grade: Grade, nowMs: number, cal: Calendar) {
    return (await this.store()).recordAnswer(cardId, grade, nowMs, cal);
  }
  async recordDrawn(cardIds: string[], nowMs: number, cal: Calendar) {
    return (await this.store()).recordDrawn(cardIds, nowMs, cal);
  }
}

/**
 * The review store the app uses. Sync only with NEXT_PUBLIC_REVIEW_SYNC "on" and Supabase
 * configured; otherwise the browser-only store, which makes no network calls and loads nothing else.
 */
export function createReviewStore(options: {
  flag: string | undefined;
  supabaseConfigured: boolean;
  loadWiring: () => Promise<ReviewWiring>;
  makeEnv?: () => FacadeEnv;
}): ReviewStore {
  if (options.flag !== "on" || !options.supabaseConfigured) return createLocalReviewStore();
  return new ReviewSyncFacade(options.loadWiring, options.makeEnv ?? browserEnv);
}
