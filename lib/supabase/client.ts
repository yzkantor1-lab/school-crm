import { createBrowserClient } from '@supabase/ssr'

// Some networks/browsers (ad blockers, VPNs, flaky Wi-Fi) intermittently fail
// the fetch to Supabase at the network level — surfaces as a bare "Load failed"
// (Safari) / "Failed to fetch" (Chrome) TypeError, before any HTTP response
// comes back. Retrying a couple of times clears most of these transient drops.
// Non-network failures (4xx/5xx HTTP responses) are untouched — fetch() only
// throws on true network errors, so normal error handling downstream still works.
async function retryingFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const attempts = 5
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(input, init)
    } catch (err) {
      if (i === attempts - 1) throw err
      await new Promise(resolve => setTimeout(resolve, 500 * (i + 1)))
    }
  }
  throw new Error('unreachable')
}

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: retryingFetch } }
  )
}
