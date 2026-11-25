// The synced progress store and the facade that picks a store (docs/plans/progress.md, section 6).
// Everything outside the browser is injected (storage, Web Locks, the server actions, timers), so
// lib/progress-store.test.ts runs it in Node with fakes.
//
// - Sync is on only when NEXT_PUBLIC_PROGRESS_SYNC is "on", Supabase is configured and someone is
//   signed in. Otherwise the plain LocalProgressStore answers, exactly as before, with no network.
// - Writes are local first: the cache and the outbox change under the outbox lock and the call
//   resolves at once; a flush sends the outbox later.
// - Per user: the cache, the outbox and the rejection log are keyed by the user id and carry it
//   inside, so nothing is ever sent or shown under another account.
import type { AnswerStatus } from "./check-answer.ts";
import {
  LocalProgressStore,
  STORAGE_KEY,
  nextAttempt,
  nextRun,
  nextWriting,
  type ImportNotice,
  type LessonProgress,
  type ProgressMode,
  type ProgressData,
  type ProgressStore,
  type WritingTaskProgress,
} from "./progress-core.ts";
import {
  attemptKey,
  hasWork,
  keysOfRows,
  lastTimeFor,
  overlay,
  parseOutbox,
  queueAttempt,
  queueImport,
  queueRun,
  queueWriting,
  settle,
  takeBatch,
  writingKey,
  type Outbox,
  type OutboxEntry,
} from "./progress-outbox.ts";
import type { Rejection, SyncItem } from "./progress-validate.ts";

// ---------- Injected environment ----------

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
};

/** The part of navigator.locks we use. */
export type LocksLike = {
  request<T>(name: string, options: { ifAvailable?: boolean }, callback: (lock: unknown) => Promise<T> | T): Promise<T>;
};

export type SyncActions = {
  sync(input: { expectedUserId: string; items: SyncItem[] }): Promise<unknown>;
  get(expectedUserId: string): Promise<unknown>;
  reset(input: { expectedUserId: string; confirm: "reset" }): Promise<unknown>;
};

export type StoreEnv = {
  storage: StorageLike;
  /** null where the Web Locks API is missing: then there is no lock (plan, section 6.5). */
  locks: LocksLike | null;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  warn(message: string): void;
};

// ---------- Keys ----------

export const cacheKey = (userId: string) => `parlons-progress-v1:u:${userId}`;
export const outboxKey = (userId: string) => `parlons-progress-outbox-v1:${userId}`;
export const rejectedKey = (userId: string) => `parlons-progress-rejected-v1:${userId}`;
/** The import's progress and its notice, per user. */
export const importKey = (userId: string) => `parlons-progress-import-v1:${userId}`;
/** The account that owns this browser's signed-out progress (section 8). Set once, never changed. */
export const IMPORT_OWNER_KEY = "parlons-progress-import-owner-v1";
/** The newest signed-out record time already imported (section 8). */
export const IMPORTED_MARKER_KEY = "parlons-progress-imported-v1";

// The plan's wording (section 8, decision 7); the second adds one plain sentence when some items were refused.
export const IMPORT_NOTICE = "We added the progress saved in this browser to your account.";
export const IMPORT_NOTICE_PARTIAL = "We added the progress saved in this browser to your account. A few items couldn't be added.";
const CACHE_PREFIX = "parlons-progress-v1:u:";
/** The account the facade picked last, so reads can answer before the session is known again. */
export const LAST_USER_KEY = "parlons-progress-last-user-v1";
const OUTBOX_LOCK = "parlons-progress-outbox";
const FLUSH_LOCK = "parlons-progress-flush";

export const DEBOUNCE_MS = 1000;
export const RETRY_FIRST_MS = 30_000;
export const RETRY_MAX_MS = 5 * 60_000;
export const SNAPSHOT_EVERY_MS = 5 * 60_000; // re-read the server on visibility after this long
const MAX_REJECTIONS_KEPT = 500;

/** The import's state: keys still to confirm, how many were applied and rejected, and the notice. */
type ImportState = { userId: string; keys: string[]; applied: number; rejected: number; notice: "none" | "due" | "shown" };

/** A rejected entry: never sent again, but kept (ids, counts and times only) so the learner's record stays visible. */
type KeptRejection = { key: string; code: string; at: string; entry?: OutboxEntry };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const emptyData = (): ProgressData => ({ exercises: {}, lessons: {}, writingTasks: {} });

/** A user's cached synced progress, or null when there's none (or it names another user). */
export function readCachedProgress(storage: StorageLike, userId: string): ProgressData | null {
  try {
    const c = JSON.parse(storage.getItem(cacheKey(userId)) ?? "null");
    if (isObj(c) && c.userId === userId && isProgressData(c.data)) return { writingTasks: {}, ...c.data };
  } catch {
    // Corrupted: treated as empty; the next server snapshot fills it.
  }
  return null;
}

/**
 * The page was built before a deploy, so its action ids are gone. Next.js 16 answers 409 and the
 * client throws "Server Action unavailable."; older versions said "Failed to find Server Action".
 */
export function isActionNotFound(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /server action/i.test(message) && /(unavailable|not found|failed to find)/i.test(message);
}

function isProgressData(v: unknown): v is ProgressData {
  return isObj(v) && isObj(v.exercises) && isObj(v.lessons) && (v.writingTasks === undefined || isObj(v.writingTasks));
}

// ---------- The synced store ----------

type SendResult = "ok" | "stop";

export class SupabaseProgressStore implements ProgressStore {
  private flushing = false;
  private paused: string | null = null; // why sending stopped until the next page load
  private stopped = false;
  private retryMs = 0;
  private retryAt = 0; // while backing off, a write doesn't bring the next send forward
  private flushTimer: unknown = null;
  private snapshot: Promise<void> | null = null;
  private snapshotAt = 0;
  private readonly listeners = new Set<() => void>();

  readonly userId: string;
  private readonly actions: SyncActions;
  private readonly env: StoreEnv;
  private readonly onWrongUser: () => void;

  constructor(userId: string, actions: SyncActions, env: StoreEnv, onWrongUser: () => void = () => {}) {
    this.userId = userId;
    this.actions = actions;
    this.env = env;
    this.onWrongUser = onWrongUser;
  }

  // ----- storage (writes only inside withOutboxLock) -----

  private readCache(): ProgressData {
    return readCachedProgress(this.env.storage, this.userId) ?? emptyData();
  }

  private writeCache(data: ProgressData): void {
    this.safe(() => this.env.storage.setItem(cacheKey(this.userId), JSON.stringify({ userId: this.userId, data })));
  }

  private readOutbox(): Outbox {
    return parseOutbox(this.env.storage.getItem(outboxKey(this.userId)), this.userId);
  }

  private writeOutbox(outbox: Outbox): void {
    this.safe(() =>
      hasWork(outbox) ? this.env.storage.setItem(outboxKey(this.userId), JSON.stringify(outbox)) : this.env.storage.removeItem(outboxKey(this.userId)),
    );
  }

  private readRejections(): KeptRejection[] {
    try {
      const saved = JSON.parse(this.env.storage.getItem(rejectedKey(this.userId)) ?? "null");
      if (isObj(saved) && saved.userId === this.userId && Array.isArray(saved.items)) return saved.items as KeptRejection[];
    } catch {
      // Corrupted log: start a new one.
    }
    return [];
  }

  /**
   * Rejected entries go here with their code (the newest 500) and are never retried. The entry
   * itself is kept too, so a server snapshot doesn't hide what the learner did (see withKept).
   */
  private recordRejections(rejected: Rejection[], before: Outbox): void {
    if (!rejected.length) return;
    const at = new Date(this.env.now()).toISOString();
    const added = rejected.map((r) => ({ key: r.key, code: String(r.code), at, ...(before.slots[r.key]?.inFlight ? { entry: before.slots[r.key].inFlight } : {}) }));
    const list = [...this.readRejections(), ...added].slice(-MAX_REJECTIONS_KEPT);
    this.safe(() => this.env.storage.setItem(rejectedKey(this.userId), JSON.stringify({ userId: this.userId, items: list })));
    for (const r of rejected) this.env.warn(`[progress] rejected ${r.key}: ${r.code}`);
  }

  private safe(fn: () => void): void {
    try {
      fn();
    } catch {
      // Storage blocked or full: as in the local store, the change just isn't saved.
    }
  }

  /** Every read-modify-write of the cache, the outbox and the rejection log runs in here. */
  private withOutboxLock<T>(fn: () => T): Promise<T> {
    if (!this.env.locks) return Promise.resolve().then(fn);
    return this.env.locks.request(OUTBOX_LOCK, {}, () => fn());
  }

  /** A time strictly after every earlier time for this key, so the server counts the new entry. */
  private timeAfter(...floors: (string | undefined)[]): string {
    let ms = this.env.now();
    for (const f of floors) if (f) ms = Math.max(ms, Date.parse(f) + 1);
    return new Date(ms).toISOString();
  }

  /** The kept rejected entries applied over `data`, by the same rules as the outbox (display only). */
  private withKept(data: ProgressData): ProgressData {
    const slots: Outbox["slots"] = {};
    for (const r of this.readRejections()) if (r.entry) slots[`kept:${r.key}:${r.at}`] = { pending: r.entry };
    return overlay(data, { v: 1, userId: this.userId, seq: 0, slots });
  }

  // ----- reads -----

  /**
   * Reads never wait for the network: they answer from the cache at once and start the page's one
   * shared server read in the background; subscribers hear when its copy lands.
   */
  private readable(): ProgressData {
    void this.ensureSnapshot();
    return this.readCache();
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

  async getAll(): Promise<ProgressData> {
    return this.readable();
  }

  async getLessonProgress(lessonId: string): Promise<LessonProgress | null> {
    return this.readable().lessons[lessonId] ?? null;
  }

  async getWritingTask(exerciseId: string): Promise<WritingTaskProgress | null> {
    return this.readable().writingTasks?.[exerciseId] ?? null;
  }

  /** The server's snapshot replaces the cache, with the outbox re-applied on top. */
  ensureSnapshot(force = false): Promise<void> {
    if (this.snapshot && !force) return this.snapshot;
    this.snapshot = (async () => {
      try {
        const reply = await this.actions.get(this.userId);
        if (isObj(reply) && reply.status === "ok" && isProgressData(reply.data)) {
          const data = reply.data;
          await this.withOutboxLock(() => this.writeCache(overlay(this.withKept({ writingTasks: {}, ...data }), this.readOutbox())));
          this.snapshotAt = this.env.now();
          this.notify();
        } else if (isObj(reply) && reply.status === "wrong-user") {
          this.stop();
          this.onWrongUser();
        }
      } catch {
        // Offline or Supabase down: the cache stays as it is.
      }
    })();
    return this.snapshot;
  }

  // ----- writes: local first, then a flush -----

  async recordAttempt(exerciseId: string, result: AnswerStatus): Promise<void> {
    await this.withOutboxLock(() => {
      const data = this.readCache();
      const outbox = this.readOutbox();
      const at = this.timeAfter(lastTimeFor(outbox, attemptKey(exerciseId)), data.exercises[exerciseId]?.lastAttemptedAt);
      data.exercises[exerciseId] = nextAttempt(data.exercises[exerciseId], result, at);
      this.writeOutbox(queueAttempt(outbox, exerciseId, result, at));
      this.writeCache(data);
    });
    this.scheduleFlush(DEBOUNCE_MS);
  }

  async recordRun(lessonId: string, score: number, total: number): Promise<LessonProgress> {
    const updated = await this.withOutboxLock(() => {
      const data = this.readCache();
      const at = this.timeAfter();
      const next = nextRun(data.lessons[lessonId], score, total, at);
      data.lessons[lessonId] = next;
      this.writeOutbox(queueRun(this.readOutbox(), lessonId, score, total, at));
      this.writeCache(data);
      return next;
    });
    this.scheduleFlush(DEBOUNCE_MS);
    return updated;
  }

  async recordWritingTask(exerciseId: string, checked: number[]): Promise<WritingTaskProgress> {
    const entry = await this.withOutboxLock(() => {
      const data = this.readCache();
      const outbox = this.readOutbox();
      const at = this.timeAfter(lastTimeFor(outbox, writingKey(exerciseId)), data.writingTasks?.[exerciseId]?.doneAt);
      const next = nextWriting(checked, at);
      data.writingTasks = { ...(data.writingTasks ?? {}), [exerciseId]: next };
      this.writeOutbox(queueWriting(outbox, exerciseId, next.checked, at));
      this.writeCache(data);
      return next;
    });
    this.scheduleFlush(DEBOUNCE_MS);
    return entry;
  }

  /** Deletes this user's cache and outbox here, and their rows on the server. No UI calls it yet. */
  async reset(): Promise<void> {
    await this.withOutboxLock(() => {
      this.safe(() => this.env.storage.removeItem(cacheKey(this.userId)));
      this.safe(() => this.env.storage.removeItem(outboxKey(this.userId)));
    });
    try {
      await this.actions.reset({ expectedUserId: this.userId, confirm: "reset" });
    } catch {
      // The server rows stay; nothing local is left to resend.
    }
  }

  // ----- sending -----

  scheduleFlush(ms: number, retry = false): void {
    if (this.stopped || this.paused) return;
    if (!retry && this.retryAt > this.env.now()) return; // the retry already scheduled will send it
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
    this.env.warn(`[progress] sync paused until the next page load: ${reason}`);
  }

  /** Why sending is paused (until the next page load), or null. For tests and debugging. */
  get pausedReason(): string | null {
    return this.paused;
  }

  /**
   * Sends the outbox in batches until it's empty or a call fails. One flusher per browser: the
   * flush lock is taken with ifAvailable, so another tab skips (and checks again shortly) instead
   * of sending the same entries.
   */
  async flush(): Promise<void> {
    if (this.stopped || this.paused || this.flushing) return;
    this.flushing = true;
    try {
      const run = async () => {
        for (;;) {
          if (this.stopped || this.paused) return;
          const items = await this.withOutboxLock(() => {
            const { outbox, items } = takeBatch(this.readOutbox());
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
        if (!got) this.scheduleFlush(2 * DEBOUNCE_MS); // another tab is sending; look again soon
      }
    } finally {
      this.flushing = false;
    }
  }

  private async send(items: SyncItem[]): Promise<SendResult> {
    let reply: unknown;
    try {
      reply = await this.actions.sync({ expectedUserId: this.userId, items });
    } catch (error) {
      if (isActionNotFound(error)) this.pause("server action not found (the site was updated)");
      else this.retryLater(); // network error or timeout: everything stays, in flight first
      return "stop";
    }
    if (!isObj(reply) || typeof reply.status !== "string") {
      this.pause("malformed reply");
      return "stop";
    }
    if (reply.status === "ok") {
      const { applied, rejected, rows } = reply as { applied?: unknown; rejected?: unknown; rows?: unknown };
      if (!Array.isArray(applied) || !Array.isArray(rejected) || !isProgressData(rows)) {
        this.pause("malformed reply");
        return "stop";
      }
      await this.withOutboxLock(() => {
        const before = this.readOutbox();
        const outbox = settle(before, applied as string[], rejected as Rejection[]);
        this.writeOutbox(outbox);
        this.recordRejections(rejected as Rejection[], before);
        this.trackImport(applied as string[], rejected as Rejection[]);
        // The server's rows replace the cache's records (the server wins), then the outbox goes on top.
        const cache = this.readCache();
        Object.assign(cache.exercises, rows.exercises);
        Object.assign(cache.lessons, rows.lessons);
        cache.writingTasks = { ...(cache.writingTasks ?? {}), ...(rows.writingTasks ?? {}) };
        this.writeCache(overlay(cache, outbox, keysOfRows(rows)));
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
    this.retryLater(); // "unavailable", "signed-out" (an expired session) or anything else
    return "stop";
  }

  // ----- importing signed-out progress (section 8) -----

  private readImport(): ImportState {
    try {
      const saved = JSON.parse(this.env.storage.getItem(importKey(this.userId)) ?? "null");
      if (isObj(saved) && saved.userId === this.userId && Array.isArray(saved.keys)) return saved as ImportState;
    } catch {
      // Corrupted: start again (the import itself is idempotent).
    }
    return { userId: this.userId, keys: [], applied: 0, rejected: 0, notice: "none" };
  }

  private writeImport(state: ImportState): void {
    this.safe(() => this.env.storage.setItem(importKey(this.userId), JSON.stringify(state)));
  }

  /** Counts the import's entries as the server confirms them; the notice is due once all are in. */
  private trackImport(applied: string[], rejected: Rejection[]): void {
    const state = this.readImport();
    if (!state.keys.length) return;
    const waiting = new Set(state.keys);
    for (const k of applied) if (waiting.delete(k)) state.applied++;
    for (const r of rejected) if (waiting.delete(r.key)) state.rejected++;
    state.keys = [...waiting];
    if (!state.keys.length && state.applied > 0 && state.notice === "none") state.notice = "due";
    this.writeImport(state);
  }

  /**
   * Puts this browser's signed-out progress into this account's outbox, if this account owns it:
   * the first account to sign in here claims it, once, and later accounts never get it. Only records
   * newer than the marker go in, and the entries and the marker are written together under the lock,
   * so a closed tab or a failed send resumes from the outbox and nothing is queued twice. The
   * signed-out data itself stays where it is. Returns how many entries were queued.
   */
  async importAnonymous(): Promise<number> {
    const queued = await this.withOutboxLock(() => {
      const storage = this.env.storage;
      const owner = storage.getItem(IMPORT_OWNER_KEY);
      if (owner === null) this.safe(() => storage.setItem(IMPORT_OWNER_KEY, this.userId));
      else if (owner !== this.userId) return 0;
      let anonymous: unknown;
      try {
        anonymous = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
      } catch {
        return 0;
      }
      if (!isProgressData(anonymous)) return 0;
      const marker = Date.parse(storage.getItem(IMPORTED_MARKER_KEY) ?? "");
      const since = Number.isFinite(marker) ? marker : Number.NEGATIVE_INFINITY;
      const { outbox, keys, newestMs } = queueImport(this.readOutbox(), anonymous, since);
      if (!keys.length) return 0;
      this.writeOutbox(outbox);
      this.safe(() => storage.setItem(IMPORTED_MARKER_KEY, new Date(newestMs).toISOString()));
      const state = this.readImport();
      state.keys = [...new Set([...state.keys, ...keys])];
      this.writeImport(state);
      // Badges update at once: the imported records go over the cache like any pending entry.
      this.writeCache(overlay(this.readCache(), outbox, keys));
      return keys.length;
    });
    if (queued) {
      this.notify();
      this.scheduleFlush(0);
    }
    return queued;
  }

  async importNotice(): Promise<ImportNotice | null> {
    const state = this.readImport();
    if (state.notice !== "due") return null;
    return { text: state.rejected ? IMPORT_NOTICE_PARTIAL : IMPORT_NOTICE };
  }

  async mode(): Promise<ProgressMode> {
    return "account";
  }

  async markImportNoticeShown(): Promise<void> {
    await this.withOutboxLock(() => {
      const state = this.readImport();
      if (state.notice === "due") this.writeImport({ ...state, notice: "shown" });
    });
  }

  // ----- lifecycle -----

  /** Page load: read the server and send anything waiting. */
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
      this.safe(() => this.env.storage.removeItem(cacheKey(this.userId)));
      if (!hasWork(this.readOutbox())) this.safe(() => this.env.storage.removeItem(outboxKey(this.userId)));
    });
  }
}

// ---------- The facade ----------

export type Wiring = {
  auth: { getUserId(): Promise<string | null>; onChange(callback: (userId: string | null) => void): void };
  actions: SyncActions;
};

export type FacadeEnv = StoreEnv & { on(event: "online" | "visible", callback: () => void): void };

/**
 * Picks the store: the synced store for the signed-in user, the local store otherwise. Created
 * only when sync is on; it loads the Supabase client and the actions on first use, never at import.
 */
export class SyncFacade implements ProgressStore {
  private readonly local: ProgressStore;
  private remote: SupabaseProgressStore | null = null;
  private init: Promise<void> | null = null;
  private wiring: Wiring | null = null;
  private env: FacadeEnv | null = null;
  private readonly listeners = new Set<() => void>();
  private unsubscribeRemote: () => void = () => {};

  private readonly loadWiring: () => Promise<Wiring>;
  private readonly makeEnv: () => FacadeEnv;

  constructor(loadWiring: () => Promise<Wiring>, makeEnv: () => FacadeEnv, local?: ProgressStore) {
    this.loadWiring = loadWiring;
    this.makeEnv = makeEnv;
    this.local = local ?? new LocalProgressStore();
  }

  /** The store answering now (for tests). */
  async currentStore(): Promise<ProgressStore> {
    await this.ensureInit();
    return this.remote ?? this.local;
  }

  private initDone = false;

  private envNow(): FacadeEnv {
    return (this.env ??= this.makeEnv());
  }

  /** The user picked last on this browser (null if none, or if storage is blocked). */
  private hintedUser(): string | null {
    try {
      return this.envNow().storage.getItem(LAST_USER_KEY);
    } catch {
      return null;
    }
  }

  /**
   * Reads before the session is known (the wiring chunk is loading, or getSession is refreshing a
   * token): the hinted user's cache, or this browser's signed-out progress. Never the network.
   * Once the facade has picked the store it notifies, and readers read again.
   */
  private earlyData(): ProgressData | null {
    if (this.initDone) return null;
    void this.ensureInit();
    const hint = this.hintedUser();
    if (!hint) return null; // answer from the local store
    return readCachedProgress(this.envNow().storage, hint) ?? emptyData();
  }

  private ensureInit(): Promise<void> {
    this.init ??= (async () => {
      try {
        this.envNow();
        this.wiring = await this.loadWiring();
        // Listen first, then read the session, so a sign-in that lands meanwhile isn't missed
        // (selections run one at a time, in order).
        this.wiring.auth.onChange((userId) => void this.select(userId));
        await this.select(await this.wiring.auth.getUserId());
        this.env!.on("online", () => this.remote?.onOnline());
        this.env!.on("visible", () => this.remote?.onVisible());
      } catch {
        // Couldn't load the client or read the session: stay on the local store.
        this.remote = null;
      }
      this.initDone = true;
      this.notify();
    })();
    return this.init;
  }

  private selecting: Promise<void> = Promise.resolve();

  /** Switches to `userId`'s store (null: the local store). Selections run one at a time, in order. */
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
    // A shared browser: no other account's synced copy stays readable here. Outboxes stay (unsent
    // work, sent only when that same account signs in again), but they're never shown.
    this.sweepCaches(userId);
    try {
      if (userId) this.env.storage.setItem(LAST_USER_KEY, userId);
      else this.env.storage.removeItem(LAST_USER_KEY);
    } catch {
      // Storage blocked: early reads just use the local store.
    }
    if (userId) {
      const store = new SupabaseProgressStore(userId, this.wiring.actions, this.env, () => void this.recheck());
      this.remote = store;
      this.unsubscribeRemote = store.subscribe(() => this.notify());
      // On every selection: a sign-in event, or a page load while already signed in.
      await store.importAnonymous();
      store.start();
    }
    this.notify(); // another store answers now: readers should read again
  }

  private sweepCaches(keepUserId: string | null): void {
    const storage = this.env!.storage;
    try {
      const doomed: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k?.startsWith(CACHE_PREFIX) && k !== (keepUserId ? cacheKey(keepUserId) : null)) doomed.push(k);
      }
      for (const k of doomed) storage.removeItem(k);
    } catch {
      // Storage blocked: nothing was cached either.
    }
  }

  /** The server says another user is signed in: read the browser session again and follow it. */
  private async recheck(): Promise<void> {
    if (!this.wiring) return;
    const stale = this.remote;
    try {
      const userId = await this.wiring.auth.getUserId();
      if (stale && userId === stale.userId) {
        // Same user in the browser: stay stopped (no sending) until the page reloads.
        return;
      }
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

  async importNotice() {
    return (await this.store()).importNotice();
  }

  async markImportNoticeShown() {
    return (await this.store()).markImportNoticeShown();
  }

  async mode(): Promise<ProgressMode> {
    if (!this.initDone) {
      void this.ensureInit();
      return this.hintedUser() ? "account" : "browser-signed-out";
    }
    return this.remote ? "account" : "browser-signed-out";
  }

  private async store(): Promise<ProgressStore> {
    await this.ensureInit();
    return this.remote ?? this.local;
  }

  async getLessonProgress(lessonId: string) {
    const early = this.earlyData();
    if (early) return early.lessons[lessonId] ?? null;
    if (!this.initDone) return this.local.getLessonProgress(lessonId);
    return (await this.store()).getLessonProgress(lessonId);
  }
  async recordAttempt(exerciseId: string, result: AnswerStatus) {
    return (await this.store()).recordAttempt(exerciseId, result);
  }
  async recordRun(lessonId: string, score: number, total: number) {
    return (await this.store()).recordRun(lessonId, score, total);
  }
  async recordWritingTask(exerciseId: string, checked: number[]) {
    return (await this.store()).recordWritingTask(exerciseId, checked);
  }
  async getWritingTask(exerciseId: string) {
    const early = this.earlyData();
    if (early) return early.writingTasks?.[exerciseId] ?? null;
    if (!this.initDone) return this.local.getWritingTask(exerciseId);
    return (await this.store()).getWritingTask(exerciseId);
  }
  async getAll() {
    const early = this.earlyData();
    if (early) return early;
    if (!this.initDone) return this.local.getAll();
    return (await this.store()).getAll();
  }
  async reset() {
    return (await this.store()).reset();
  }
}

/** The browser's storage, locks, timers and events. Called only on first use, never during SSR. */
export function browserEnv(): FacadeEnv {
  return {
    storage: window.localStorage,
    locks: typeof navigator !== "undefined" && navigator.locks ? (navigator.locks as unknown as LocksLike) : null,
    now: () => Date.now(),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (h) => window.clearTimeout(h as number),
    warn: (m) => console.warn(m),
    on(event, callback) {
      if (event === "online") window.addEventListener("online", callback);
      else document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && callback());
    },
  };
}

/**
 * The store the app uses. Sync only with the flag "on" and Supabase configured; otherwise the
 * plain local store, which makes no network calls and loads nothing else.
 */
export function createProgressStore(options: {
  flag: string | undefined;
  supabaseConfigured: boolean;
  loadWiring: () => Promise<Wiring>;
  makeEnv?: () => FacadeEnv;
}): ProgressStore {
  if (options.flag !== "on" || !options.supabaseConfigured) return new LocalProgressStore();
  return new SyncFacade(options.loadWiring, options.makeEnv ?? browserEnv);
}
