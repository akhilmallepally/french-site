// Fakes for the progress store tests: storage, Web Locks, a clock, and a server that runs the real
// runSync and validator against an in-memory database following apply_progress's rules.
// Used by lib/progress-store.test.ts and lib/progress-import.test.ts (not a test file itself).
import fs from "node:fs";
import path from "node:path";
import { LocalProgressStore, type ProgressData } from "./progress-core.ts";
import { applyAttempt, applyExerciseImport, applyLesson, applyWriting, lessonFromImport } from "./progress-merge.ts";
import { parseOutbox, type Outbox } from "./progress-outbox.ts";
import { outboxKey, SupabaseProgressStore, SyncFacade, type FacadeEnv, type LocksLike, type StorageLike, type SyncActions, type Wiring } from "./progress-store.ts";
import { rowsToProgress, runSync, type ProgressDb, type Rows } from "./progress-sync.ts";
import type { ProgressIndexData, SyncItem } from "./progress-validate.ts";

export const INDEX: ProgressIndexData = JSON.parse(fs.readFileSync(path.join(process.cwd(), "lib", "generated", "progress-index.json"), "utf8"));
export const ALL_EXERCISES = Object.values(INDEX.lessons).flatMap((l) => l.exercises);
export const A = "aaaaaaaa-0000-4000-8000-00000000000a";
export const B = "bbbbbbbb-0000-4000-8000-00000000000b";

// ---------- Fakes ----------

export class FakeStorage implements StorageLike {
  map = new Map<string, string>();
  onSet: (key: string) => void = () => {};
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.onSet(k);
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.onSet(k);
    this.map.delete(k);
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  get length() {
    return this.map.size;
  }
}

/** Exclusive locks by name; ifAvailable gets null while the lock is held, like navigator.locks. */
export class FakeLocks implements LocksLike {
  held = new Map<string, Promise<void>>();
  async request<T>(name: string, options: { ifAvailable?: boolean }, cb: (lock: unknown) => Promise<T> | T): Promise<T> {
    if (options.ifAvailable && this.held.has(name)) return cb(null);
    while (this.held.has(name)) await this.held.get(name);
    let release!: () => void;
    this.held.set(name, new Promise<void>((r) => (release = r)));
    try {
      return await cb({ name });
    } finally {
      this.held.delete(name);
      release();
    }
  }
}

export class Clock {
  now = Date.UTC(2026, 10, 25, 12, 0, 0);
  timers: { at: number; fn: () => void; id: number }[] = [];
  private nextId = 1;
  setTimer = (fn: () => void, ms: number) => {
    const id = this.nextId++;
    this.timers.push({ at: this.now + ms, fn, id });
    return id;
  };
  clearTimer = (id: unknown) => {
    this.timers = this.timers.filter((t) => t.id !== id);
  };
  /** Moves time on, firing due timers, and lets the async work they start finish. */
  async advance(ms: number) {
    const end = this.now + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((t) => t !== due);
      this.now = Math.max(this.now, due.at);
      due.fn();
      await settle();
    }
    this.now = end;
    await settle();
  }
  pending(): number[] {
    return this.timers.map((t) => t.at - this.now).sort((a, b) => a - b);
  }
}

export async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

export type Behaviour = "ok" | "network" | "not-found" | "unavailable" | "malformed" | "invalid" | "block";

/** The server: one in-memory database per user, the real runSync in front of it. */
export class FakeServer {
  db = new Map<string, Rows>();
  sessionUser: string | null = A;
  behaviour: Behaviour = "ok";
  rejectKeys = new Map<string, string>(); // key → code, as apply_progress would reject it
  calls: { expectedUserId: string; items: SyncItem[] }[] = [];
  gets = 0;
  /** When true, getProgressAction never answers (a slow or stuck network). */
  hangGets = false;
  private getGate: Promise<void> | null = null;

  /** Holds getProgressAction until the returned function is called. */
  holdGets(): () => void {
    let release!: () => void;
    this.getGate = new Promise<void>((r) => (release = r));
    return () => {
      this.getGate = null;
      release();
    };
  }
  private blocked: (() => void)[] = [];

  rows(user: string): Rows {
    if (!this.db.has(user)) this.db.set(user, { lessons: [], exercises: [], writing: [] });
    return this.db.get(user)!;
  }

  private dbFor(user: string, clock: Clock): ProgressDb {
    const rows = this.rows(user);
    return {
      apply: async (items) => {
        const applied: string[] = [];
        const rejected: { key: string; code: string }[] = [];
        const data = rowsToProgress(rows);
        for (const i of items) {
          if (this.rejectKeys.has(i.key)) {
            rejected.push({ key: i.key, code: this.rejectKeys.get(i.key)! });
            continue;
          }
          if (i.kind === "attempt") data.exercises[i.exerciseId] = applyAttempt(data.exercises[i.exerciseId], i);
          else if (i.kind === "import-exercise")
            data.exercises[i.exerciseId] = applyExerciseImport(data.exercises[i.exerciseId], { attempts: i.attempts, correct: i.correct, lastResult: i.lastResult, lastAttemptedAt: i.lastAttemptedAt });
          else if (i.kind === "import-lesson" || i.kind === "run") {
            const rec = i.kind === "run" ? { bestScore: i.score, bestTotal: i.total, lastCompletedAt: i.runAt } : { bestScore: i.bestScore, bestTotal: i.bestTotal, lastCompletedAt: i.lastRunAt, ...(i.completedAt ? { completedAt: i.completedAt } : {}) };
            data.lessons[i.lessonId] = applyLesson(data.lessons[i.lessonId], lessonFromImport(rec));
          } else if (i.kind === "writing") data.writingTasks![i.exerciseId] = applyWriting(data.writingTasks![i.exerciseId], { done: true, checked: i.checked, doneAt: i.doneAt });
          applied.push(i.key);
        }
        this.db.set(user, toRows(data));
        void clock;
        return { applied, rejected };
      },
      read: async (keys) => {
        const r = this.rows(user);
        return {
          lessons: r.lessons.filter((x) => keys.lessons.includes(x.lesson_id)),
          exercises: r.exercises.filter((x) => keys.exercises.includes(x.exercise_id)),
          writing: r.writing.filter((x) => keys.writing.includes(x.exercise_id)),
        };
      },
    };
  }

  actionsFor(clock: Clock): SyncActions {
    return {
      sync: async (input) => {
        this.calls.push(JSON.parse(JSON.stringify(input)));
        if (this.behaviour === "block") await new Promise<void>((r) => this.blocked.push(r));
        if (this.behaviour === "network") throw new TypeError("fetch failed");
        if (this.behaviour === "not-found") throw new Error("Server Action unavailable."); // what the Next.js 16 client throws on a 409
        if (this.behaviour === "unavailable") return { status: "unavailable" };
        if (this.behaviour === "malformed") return "<html>";
        if (this.behaviour === "invalid") return { status: "invalid", code: "unexpected_field" };
        if (!this.sessionUser) return { status: "signed-out" };
        return runSync(input, { userId: this.sessionUser, index: INDEX, nowMs: clock.now, db: this.dbFor(this.sessionUser, clock) });
      },
      get: async (expectedUserId) => {
        this.gets++;
        if (this.hangGets) return new Promise(() => {});
        if (this.getGate) await this.getGate;
        if (this.sessionUser !== expectedUserId) return { status: "wrong-user" };
        return { status: "ok", data: rowsToProgress(this.rows(expectedUserId)) };
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

export function toRows(d: ProgressData): Rows {
  return {
    lessons: Object.entries(d.lessons).map(([id, l]) => ({ lesson_id: id, best_score: l.bestScore, best_total: l.bestTotal, last_run_at: l.lastCompletedAt, completed_at: l.completedAt ?? null })),
    exercises: Object.entries(d.exercises).map(([id, e]) => ({ exercise_id: id, attempts: e.attempts, correct_count: e.correct, last_result: e.lastResult, last_attempt_at: e.lastAttemptedAt })),
    writing: Object.entries(d.writingTasks ?? {}).map(([id, w]) => ({ exercise_id: id, done: true, checked: w.checked, done_at: w.doneAt })),
  };
}

export type World = { storage: FakeStorage; locks: FakeLocks | null; clock: Clock; server: FakeServer; warnings: string[]; env: FacadeEnv };

export function world(opts: { locks?: boolean } = {}): World {
  const storage = new FakeStorage();
  const locks = opts.locks === false ? null : new FakeLocks();
  const clock = new Clock();
  const server = new FakeServer();
  const warnings: string[] = [];
  const env: FacadeEnv = { storage, locks, now: () => clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, warn: (m) => warnings.push(m), on: () => {} };
  return { storage, locks, clock, server, warnings, env };
}

export const storeFor = (w: World, user = A, onWrongUser?: () => void) => new SupabaseProgressStore(user, w.server.actionsFor(w.clock), w.env, onWrongUser);
export const outboxOf = (w: World, user = A): Outbox => parseOutbox(w.storage.getItem(outboxKey(user)), user);
export const ex = (n: number) => ALL_EXERCISES[n];

/** A facade with a fake session. Pass `existing` to share storage and server, like a reload or a second tab. */
export function facadeWorld(initialUser: string | null, existing?: World) {
  const w = existing ?? world();
  w.server.sessionUser = initialUser;
  let user = initialUser;
  let listener: (u: string | null) => void = () => {};
  let loads = 0;
  const wiring: Wiring = {
    auth: { getUserId: async () => user, onChange: (cb) => (listener = cb) },
    actions: w.server.actionsFor(w.clock),
  };
  const local = new LocalProgressStore();
  const facade = new SyncFacade(async () => (loads++, wiring), () => w.env, local);
  return {
    w,
    facade,
    loads: () => loads,
    switchTo: async (u: string | null) => {
      user = u;
      w.server.sessionUser = u;
      listener(u);
      await settle();
    },
  };
}

