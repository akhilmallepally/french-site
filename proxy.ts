import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseEnv, warnSupabaseEnvMissing } from '@/lib/supabase/env'

// Refreshes the Supabase session cookie. Not an access check (that's lib/auth.ts). Fails open for
// the request but never grants anything: with no config or no auth server, the visitor is simply
// treated as signed out by the server components.
export async function proxy(request: NextRequest) {
  const env = getSupabaseEnv()
  if (!env) {
    warnSupabaseEnvMissing('proxy')
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })

  try {
    const supabase = createServerClient(env.url, env.key, {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )

          supabaseResponse = NextResponse.next({ request })

          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    })

    await supabase.auth.getClaims()
  } catch (error) {
    console.warn('[supabase] session refresh failed in proxy:', error instanceof Error ? error.message : error)
    return NextResponse.next({ request })
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
