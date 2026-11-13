# Auth setup: gated lessons

A1 and A2 are free with no login. Every other level (B1, B2, C1, C2 and any level added later) needs a Google sign-in to read the lesson body, vocab and exercises. Level pages, titles and descriptions stay public. The design is in docs/auth-plan.md.

## How it works

- **The check.** The check is `getUser()` on the server, in `lib/auth.ts` (`import "server-only"`). The lesson body is loaded only by `loadLessonFull(access)` in `lib/lessons.ts`, which needs a `LessonAccess`. Only `lib/auth.ts` creates one:
  - `grantFreeAccess` for A1 and A2, which reads no cookies, so those lessons stay prerendered.
  - `grantLessonAccess` after `getUser()`.
- **The lesson page.** `app/lessons/[level]/[slug]/page.tsx` renders the shell from `LessonMeta` only. For gated levels, `GatedLessonBody` (`components/lesson-body.tsx`) runs inside `<Suspense>` at request time. Signed out, it renders `SignInPanel` and nothing from the lesson.
- **The leak guard.** `LessonMeta` can't carry `content`, `body`, `vocab` or `exercises`. `lib/lessons.typetest.ts` proves it with `npx tsc --noEmit`.
- **Sign-in and the callback.** `/sign-in?next=…` starts Google OAuth with `redirectTo = origin + /auth/callback?next=…`. `app/auth/callback/route.ts` exchanges the code and redirects only to `safeNext(next)` (`lib/safe-next.ts`). On failure it goes to `/sign-in?error=auth`.
- **proxy.ts** only refreshes the session. It isn't an access check.

## Manual steps

1. **Make the GitHub repository private.** It's public today: anyone can read every B1 to C1 `.mdx` file, `docs/all-data.md` (every exercise with its answers) and `docs/review/*.txt`. Go to GitHub, then Settings, then Danger Zone, then "Change visibility". Afterwards, push a commit and check that Vercel still deploys. Vercel needs access to the private repo through its GitHub app.
2. **Supabase, Authentication, URL Configuration:**
   - Site URL: the production URL, for example `https://<production-domain>`.
   - Redirect URLs:
     - `http://localhost:3000/**`
     - `https://<production-domain>/**`
     - `https://*-<vercel-team-or-user>.vercel.app/**` for preview deployments
3. **Supabase, Authentication, Providers, Google:** enable it, and paste the Client ID and Client Secret from Google Cloud.
4. **Google Cloud Console, APIs & Services, Credentials, OAuth client:**
   - Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
   - Authorized JavaScript origins: `http://localhost:3000` and the production URL.
   - Publish the OAuth consent screen, so it isn't limited to test users.
5. **Vercel, Settings, Environment Variables.** Set these for Production, Preview and Development:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
6. **Never put a service-role or secret key in client code** or in any `NEXT_PUBLIC_` variable. None is used today.

## Manual checklist (after each deploy that touches auth)

- [ ] Signed out, open a B1 lesson: the header, title and navigation show, and the sign-in panel replaces the lesson.
- [ ] Click "Sign in to continue", sign in with Google: you land back on the same lesson, with its content and exercises.
- [ ] Sign out from the header on a B1 lesson: the page switches to the sign-in panel without a manual reload.
- [ ] Sign in from the header on any page: you come back to that page.
- [ ] Error path: open `/auth/callback?code=bad`. You should land on `/sign-in?error=auth`, with the "Sign-in didn't go through" message.
- [ ] Already signed in, open `/sign-in?next=/lessons/b2/<slug>`: you're sent straight to the lesson.
- [ ] At mobile width (about 375 px): the header shows "Sign in" or "Sign out" without overflow, and the panel and sign-in page fit.
- [ ] A1 and A2 lessons work with no login, exercises included.

## Automated checks

- `npm run test:safe-next`: unit tests for the redirect rules.
- `npm run test:gating`: needs a running server (`npm run build` and then `npm start`).
  - For every gated lesson, it fetches the HTML, the RSC payload, the prefetch and every segment-prefetch variant with no cookie. It fails if a marker sentence or an accepted answer appears.
  - It scans `.next/static` and the prerendered lesson files.
  - It checks that a sample of A1 and A2 lessons is complete, and that `/auth/callback` with a hostile `next` stays on the same origin.
- **Post-deploy:** run `BASE_URL=https://<production-domain> npm run test:gating` (PowerShell: `$env:BASE_URL="https://<production-domain>"; npm run test:gating`). The file scans read the local `.next`, so run it from a checkout that has a fresh `npm run build` of the deployed commit.

## Known limits and later decisions

- **Signed-in users receive exercise answers in the page**, because answers are checked in the browser (`ExercisePlayer`, `lib/check-answer.ts`). Anyone signed in can read them in the page source. Hiding them needs server-side checking (a Server Action that grades against answers kept on the server). That's a later decision.
- **The repository history was public.** Making the repo private hides it from now on. Copies made earlier, forks and caches can't be recalled. Removing the files from history would need a history rewrite, which is a separate decision.
- **The tests don't cover:**
  - the signed-in view (no Google session in the automated test)
  - the real Vercel CDN and its caching
  - preview deployments
  - Supabase settings
  Check these by hand with the checklist above, and run `test:gating` against production after deploy.
- **Unit tests reach `getUser()` only indirectly,** through the gated page. It needs the Supabase auth server; if Supabase is unreachable, gated lessons show the sign-in panel (deny by default).
