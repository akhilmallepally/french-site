# Auth plan: gating B1 to C2

This is an inspection and plan only. No code has changed. Checked against Next.js 16.4.3 and the bundled docs `node_modules/next/dist/docs/01-app/02-guides/authentication-with-cache-components.md` and `01-getting-started/16-proxy.md`.

## 1. Architecture today

- **Content loading.** `lib/lessons.ts` reads `content/lessons/<level>/*.mdx` with `fs` and gray-matter. Pages call `getLesson(levelSlug, slug)`, `getLevel()`, `getLevelSummaries()` and `getLessonConnections()`. All of these are server-only, because they use `fs`.
- **Routes** (all Server Components):
  - `app/page.tsx`: home page, no lesson content.
  - `app/lessons/page.tsx`: level cards. These show level summaries and `LevelCompletion`.
  - `app/lessons/[level]/page.tsx`: unit and lesson list, with titles, descriptions and `LessonStatus`.
  - `app/lessons/[level]/[slug]/page.tsx`: the full lesson.
  - `app/auth/callback/route.ts`: the OAuth code exchange.
- **MDX.** `MDXRemote` from `next-mdx-remote/rsc` renders the body on the server, with the components in `components/mdx.tsx` (VocabTable, Example, Callout, LessonLink). Those are server components.
- **Client components:**
  - `components/exercise-player.tsx`
  - `components/progress-status.tsx`
  - `components/auth-button.tsx`
- **Answers reach the client.** The lesson page passes `exercises={lesson.exercises}` to `ExercisePlayer`, and each exercise includes `answers`, `strictAccents` and `explanation`. Answers are therefore serialized into the RSC payload and the HTML of every lesson, because checking happens in the browser (`checkAnswer` / `checkChoice`).
- **Progress.** `lib/progress.ts` stores progress in localStorage only.

## 2. Static vs dynamic

- `next.config.ts` sets `cacheComponents: true` and `partialPrefetching: true`. It has no static export (`output` isn't set).
- `app/lessons/[level]/[slug]/page.tsx` has `generateStaticParams()` over every lesson. Every lesson, B1 to C1 included, is prerendered at build time. The page reads no request data (no `cookies()` or `headers()`), so the whole lesson is in the static shell.
- `app/lessons/[level]/page.tsx` prerenders every level page with `generateStaticParams()`.
- No ISR or `revalidate` is set.
- **Routes that serve content with no auth check:** every `/lessons/b1/*`, `/lessons/b2/*` and `/lessons/c1/*` URL. Each one is served as:
  - prerendered HTML
  - its `.rsc` payload
  - its `.segments/**` prefetch files
- I confirmed this in the current build output: `.next/server/app/lessons/c1/passe-anterieur.html`, `.rsc` and the segment `.rsc` contain the En résumé text and the accepted answer *furent parties*.

## 3. Content leaks

| Where | File | How to close it |
|---|---|---|
| Page HTML and RSC payload | `app/lessons/[level]/[slug]/page.tsx` (prerendered) | Move the body, vocab and exercises into a request-time section behind an auth check, so the static shell holds only the title, description and links. |
| Prefetch segments | `.segments/**` files for each lesson, fetched by `<Link>` prefetch from level pages | The same fix: gated content must not be in the static shell. Test that a prefetch doesn't carry the body. |
| Answers in client props | `ExercisePlayer` props | Send them only after auth. A signed-in user can still read every answer; hiding answers from signed-in users needs server-side checking (a Server Action), which is a later decision. |
| Metadata | `generateMetadata`: title and description | Intended to stay public. |
| Build output | `.next/server/app/lessons/**` | Not public on its own. It's only reachable through the routes, so it's closed by the route fix. Rebuild after the change. |
| API routes, sitemap, robots, RSS, search index | None exist (`app/api`, `app/sitemap.ts` and `app/robots.ts` are absent) | Nothing to do now. Keep any future sitemap to titles only. |
| `public/` | Only the default SVGs | Nothing to do. |
| **Public GitHub repo** | `content/lessons/b1`, `b2`, `c1` (`*.mdx`); `docs/all-data.md` (every vocab entry and every exercise with its answers); `docs/review/*.txt` (full B2 and C1 lessons) | See section 6. The site can't protect these. |

## 4. Existing Supabase setup

- **Files:**
  - `lib/supabase/client.ts`: `createBrowserClient`.
  - `lib/supabase/server.ts`: `createServerClient`, with `cookies()` from `next/headers`.
  - `proxy.ts`: refreshes the session with `createServerClient` and calls `supabase.auth.getClaims()`. Its matcher covers everything except static assets and images. It checks nothing and redirects nowhere.
  - `app/auth/callback/route.ts`: `exchangeCodeForSession(code)`, then a redirect to `${origin}/`, or `/?error=auth` on failure. It doesn't handle a `next` parameter.
  - `components/auth-button.tsx`: a client component. It reads the user with `supabase.auth.getUser()`, listens with `onAuthStateChange`, and calls `signInWithOAuth({ provider: 'google', redirectTo: origin + '/auth/callback' })` and `signOut()`.
- **Env variable names:** `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, in `.env.local`, which is gitignored by `.env*`. There's no service-role or secret key.
- **Session reads:** `getClaims()` in proxy.ts and `getUser()` in the browser. `getSession()` isn't used. No server component reads the session yet.
- **Next.js 16 proxy:** `proxy.ts` exists, and there's no `middleware.ts`.

## 5. Security issues found

- **Gated content isn't protected at all yet**, as sections 2 and 3 describe.
- **The repo is public**, along with the dumps in `docs/` (section 6).
- **The callback** always returns to `/`. When `next` is added, it must accept only a relative path: it starts with `/`, doesn't start with `//` or `/\`, and has no scheme. Anything else falls back to `/`. Never use an absolute URL from the query.
- **Sign-out is client-only.** After it, server-rendered gated content stays on screen until a navigation. Call `router.refresh()`, or use a server route for sign-out.
- **proxy.ts is only an optimistic layer.** The docs say not to rely on it alone. The real check must be in the server component, with `getUser()` (verified by the auth server), or `getClaims()` if the project uses asymmetric JWT signing keys.
- **No secret is exposed.** The publishable key is public by design.

## 6. Repository visibility

- `origin` is `https://github.com/akhilmallepally/french-site.git`.
- `gh` isn't installed. An unauthenticated request to the repo page returned HTTP 200, so **the repository is public**.
- Whatever the site does, every B1 to C1 `.mdx` file is readable on GitHub with all its answers, and so are `docs/all-data.md` and `docs/review/*.txt`.
- Options:
  - Make the repo private. Vercel deploys private repos.
  - Or move B1 to C2 content out of the repo, to a private repo or Supabase Storage.
  - Rewriting history is also needed if the old commits must disappear.

## 7. Proposed design

- **The level rule.** Add `isFreeLevel(level)` in `lib/lessons.ts`, which is true for A1 and A2 only. Also add `lib/auth.ts` (server-only) with `getCurrentUser()`. It calls `createClient()` and then `supabase.auth.getUser()`, and returns `{ id, email }` or `null`.
- **The lesson page** (`app/lessons/[level]/[slug]/page.tsx`):
  - Keep `generateStaticParams` and the static header (breadcrumb, title, description, prerequisites, prev/next, "Keep exploring").
  - Move the article, vocab and `ExercisePlayer` into a `<LessonBody>` server component.
  - For A1 and A2, `LessonBody` renders as it does now: no session read, still prerendered.
  - For B1 and above, it sits inside `<Suspense>` and runs at request time. It calls `getCurrentUser()`. With no user, it renders a short "Sign in with Google to read this lesson" panel. That panel links to `/sign-in?next=/lessons/b1/slug`, and no content is sent.
  - The panel is better than `redirect()` here, because titles stay visible and the static shell is already streaming. An optional proxy.ts redirect for gated paths can be added for speed, but the component check remains the source of truth.
  - Don't wrap gated content in `use cache` keyed by anything but the user. Plain lesson rendering may be cached only if the cache sits inside the authorized branch.
- **Sign-in:**
  - Add `app/sign-in/page.tsx`. It shows a button that calls `signInWithOAuth`, with `redirectTo = origin + '/auth/callback?next=' + encodeURIComponent(safeNext)`.
  - The callback validates `next` (section 5) and redirects to `${origin}${next}`.
- **The header:**
  - `AuthButton` stays a client component.
  - On sign-in, pass the current path as `next`.
  - On sign-out, call `router.refresh()`.
  - Optionally render the signed-in state on the server behind `<Suspense>` in the layout. The docs say not to `await` the session at the top level of the layout.
- **Level pages and `/lessons`:** no change apart from a small lock label on B1 to C2 for signed-out visitors. That label is optional; it's a client or Suspense element.
- **Must not change:**
  - A1 and A2 routes, content and prerendering
  - styling and layout
  - lesson content, ids and URLs
  - the content scripts
  - `lib/check-answer.ts`

## 8. Files to change or add, by phase

1. **Gating and login flow:**
   - `lib/lessons.ts` (`isFreeLevel`)
   - `lib/auth.ts` (new)
   - `lib/safe-next.ts` (new, with a test)
   - `app/lessons/[level]/[slug]/page.tsx` (split out `LessonBody`, add Suspense)
   - `components/sign-in-panel.tsx` (new)
   - `app/sign-in/page.tsx` (new)
   - `app/auth/callback/route.ts` (`next`)
   - `components/auth-button.tsx` (`next`, refresh)
   - `proxy.ts` (optional optimistic redirect)
   - `scripts/test-gating.mjs` (new: curl checks)
2. **Database and RLS**, as SQL files in `supabase/migrations/`:
   - `0001_profiles.sql`: `profiles`, keyed by `auth.users.id`, with an insert trigger.
   - `0002_progress.sql`: `lesson_progress`, `exercise_attempts` and `saved_vocab`, each with `user_id uuid references auth.users` and RLS so that select, insert, update and delete are allowed only when `auth.uid() = user_id`.
   - `0003_activity.sql`: `last_activity`.
3. **Progress features:**
   - `lib/progress.ts`: a `SupabaseProgressStore` behind the existing `ProgressStore` interface, with localStorage as the fallback when signed out.
   - Server Actions for writes. They re-read the user, never trusting a client id.
   - A dashboard page, and a one-time import of localStorage progress on first sign-in.

## 9. Manual settings you'll need

- **Supabase, Authentication, URL configuration:**
  - Site URL: the production URL.
  - Redirect URLs:
    - `http://localhost:3000/**`
    - `https://<production-domain>/**`
    - `https://*-<vercel-team-or-user>.vercel.app/**` (previews)
- **Supabase, Google provider:** enabled, with the Client ID and Client Secret from Google Cloud.
- **Google Cloud OAuth client:**
  - Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
  - Authorized JavaScript origins: localhost, production.
  - The consent screen is published.
- **Supabase, JWT signing keys:** check whether asymmetric keys are on. This decides `getClaims()` or `getUser()` on the server.
- **Vercel environment variables:** `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, for Production, Preview and Development. Never add a service-role key with a `NEXT_PUBLIC_` prefix.
- **GitHub:** repository visibility (section 6).

## 10. Risks and test plan

- **Risks:**
  - Gated content stays in the static shell through a mistake, for example an import-time render or `use cache` above the check.
  - Prefetch segments carry the body.
  - The proxy alone is trusted.
  - An open redirect through `next`.
  - Previews fail sign-in because a redirect URL is missing.
  - The public repo makes all of this moot until it's private.
- **Tests, after `npm run build && npm start`:**
  1. Run `curl -s localhost:3000/lessons/c1/passe-anterieur`, with no cookie. Search the output for a known sentence (*Le passé antérieur se forme*) and an answer (*furent parties*). Both must be absent, and the sign-in panel present.
  2. Run the same curl for the `.rsc` payload (with the `RSC: 1` header) and for a prefetch request. Both must be absent there too.
  3. Run `grep -r "Le passé antérieur se forme" .next/` after the build. It must match nothing in `.next/static`. For `.next/server/app/lessons/c1`, the prerendered shell must not contain it.
  4. A1: `curl /lessons/a1/greetings` still returns the full lesson with no session.
  5. Signed in (copy the session cookie into curl), the B1 lesson returns its content.
  6. Open redirect: `/auth/callback?code=x&next=//evil.com`, and `next=https://evil.com`, must land on `/`.
  7. View source in a signed-out browser, and check the Network tab for RSC requests while hovering links on a B1 level page.
  8. Run `npm run build`, validate, the tests and the content checks unchanged.
