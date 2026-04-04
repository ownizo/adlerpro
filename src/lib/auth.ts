import { createServerFn } from '@tanstack/react-start'
import { supabaseAdmin } from './supabase-admin'
import { getRequestHeader, getCookies } from '@tanstack/react-start/server'
import type { User } from './identity-context'

export type { User as IdentityUser }

function parseCookieValue(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value)
    // @supabase/ssr stores as base64-<base64encodedJSON>
    if (decoded.startsWith('base64-')) {
      const b64 = decoded.slice(7)
      const json = Buffer.from(b64, 'base64').toString('utf-8')
      const parsed = JSON.parse(json)
      if (parsed?.access_token) return parsed.access_token
      return null
    }
    const parsed = JSON.parse(decoded)
    if (typeof parsed === 'string') return parsed
    if (Array.isArray(parsed) && parsed[0]) return parsed[0]
    if (parsed?.access_token) return parsed.access_token
    return null
  } catch {
    return value || null
  }
}

function extractAccessToken(): string | null {
  try {
    const authHeader = getRequestHeader('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7)
    }

    const cookies = getCookies()

    // Supabase stores tokens in cookies named sb-<ref>-auth-token
    for (const [name, value] of Object.entries(cookies)) {
      if (name.match(/^sb-[^-]+-auth-token$/) && value) {
        const token = parseCookieValue(value)
        if (token) return token
      }
    }

    // Try chunked cookies (sb-<ref>-auth-token.0, .1, etc.)
    const chunkNames = Object.keys(cookies)
      .filter((name) => name.match(/^sb-[^-]+-auth-token\.\d+$/))
      .sort()
    if (chunkNames.length > 0) {
      const full = chunkNames.map((n) => cookies[n]).join('')
      const token = parseCookieValue(full)
      if (token) return token
    }

    return null
  } catch {
    return null
  }
}

export const getServerUser = createServerFn({ method: 'GET' }).handler(
  async (): Promise<User | null> => {
    const token = extractAccessToken()
    if (!token) return null

    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
    if (error || !user) return null

    const meta = user.user_metadata ?? {}
    const appMeta = user.app_metadata ?? {}
    return {
      id: user.id,
      email: user.email,
      name: meta.full_name ?? meta.name ?? user.email,
      roles: appMeta.roles ?? [],
      metadata: meta,
      user_metadata: meta,
    }
  }
)
