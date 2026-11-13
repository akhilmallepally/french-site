'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { getSupabaseEnv } from '@/lib/supabase/env'
import { safeNext } from '@/lib/safe-next'

const linkStyle = 'text-sm font-medium text-muted transition-colors hover:text-accent'

/** Starts Google sign-in and comes back to `next` (checked again on the server by the callback). */
async function startGoogleSignIn(next: string) {
  const origin = window.location.origin
  const target = safeNext(next, origin)
  const supabase = createClient()
  if (!supabase) throw new Error('Sign-in is not available right now')
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(target)}` },
  })
}

/** Header control. The UI state only; access to lessons is decided on the server (lib/auth.ts). */
export default function AuthButton() {
  const router = useRouter()
  // undefined while loading, so the header doesn't flash the wrong state. With no Supabase config
  // (build-time public variables) the header starts, and stays, signed out.
  const [user, setUser] = useState<User | null | undefined>(() => (getSupabaseEnv() ? undefined : null))

  useEffect(() => {
    const supabase = createClient()
    // Not configured: the initial state is already signed out.
    if (!supabase) return
    supabase.auth
      .getUser()
      .then(({ data }) => setUser(data.user))
      .catch(() => setUser(null))
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null))
    return () => subscription.unsubscribe()
  }, [])

  async function signOut() {
    try {
      await createClient()?.auth.signOut()
    } catch {
      // The auth server is unreachable: still clear the local state below.
    }
    setUser(null)
    // Re-render the server components of this page: a gated lesson now shows the sign-in panel.
    router.refresh()
  }

  if (user === undefined) return <span className="inline-block h-5 w-16" aria-hidden="true" />

  if (user) {
    return (
      <div className="flex items-center gap-3">
        <span className="hidden max-w-48 truncate text-sm text-muted sm:inline" title={user.email ?? undefined}>
          {user.email ?? 'Signed in'}
        </span>
        <button onClick={signOut} className={linkStyle}>
          Sign out
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => startGoogleSignIn(window.location.pathname + window.location.search).catch(() => {})}
      className={linkStyle}
    >
      Sign in<span className="hidden sm:inline"> with Google</span>
    </button>
  )
}

/** The large Google button on the sign-in page. */
export function GoogleSignInButton({ next }: { next: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      onClick={async () => {
        setBusy(true)
        try {
          await startGoogleSignIn(next)
        } catch {
          setBusy(false)
        }
      }}
      disabled={busy}
      className="inline-flex min-h-11 items-center justify-center gap-3 rounded-full border border-border bg-card px-6 py-2.5 font-medium transition hover:border-accent/40 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
        <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" />
        <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
        <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" />
        <path fill="#EA4335" d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
      </svg>
      {busy ? 'Opening Google…' : 'Continue with Google'}
    </button>
  )
}
