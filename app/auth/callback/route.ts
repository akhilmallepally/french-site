import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { safeNext } from '@/lib/safe-next'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // Only a same-origin path is ever used as the redirect target.
  const next = safeNext(searchParams.get('next'), origin)

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      return NextResponse.redirect(new URL(next, origin))
    }
  }

  const failed = new URL('/sign-in', origin)
  failed.searchParams.set('error', 'auth')
  if (next !== '/') failed.searchParams.set('next', next)
  return NextResponse.redirect(failed)
}
