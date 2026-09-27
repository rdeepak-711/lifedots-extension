/**
 * Turning "leetcode.com" into something Chrome will grant.
 *
 * Step 05's design: the extension declares `optional_host_permissions` broadly,
 * which grants nothing and warns about nothing, and then asks for one specific
 * site at the moment the user types it. Chrome shows its own prompt. The
 * install dialog stays at a single line.
 *
 * `chrome.permissions.request()` only works from a user gesture, so it has to
 * be called from the popup in direct response to a click — never from the
 * service worker.
 */

/** Strip the things people paste but Chrome will not accept. */
export function normaliseSite(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')
}

/**
 * The match patterns that cover a site.
 *
 * A bare host covers the host and its subdomains — someone who names
 * `bytebytego.com` means the blog on it too. A host with a path covers only
 * that path onward, which is how "the work" gets separated from "the same site,
 * but scrolling" (github.com/donnemartin vs github.com/explore).
 */
export function originPatterns(site: string): string[] {
  const clean = normaliseSite(site)
  if (!clean || clean.includes(' ')) return []

  const slash = clean.indexOf('/')
  if (slash === -1) {
    if (!clean.includes('.')) return []
    return [`*://${clean}/*`, `*://*.${clean}/*`]
  }

  const host = clean.slice(0, slash)
  const path = clean.slice(slash)
  if (!host.includes('.')) return []
  // `${path}*` rather than `${path}/*` so the bare path matches too.
  return [`*://${host}${path}*`, `*://*.${host}${path}*`]
}

export async function hasPermission(site: string): Promise<boolean> {
  const origins = originPatterns(site)
  if (origins.length === 0) return false
  try {
    // Granted if *any* pattern is held — subdomain coverage is a bonus, not a
    // requirement, and asking for all of them to be present would report false
    // for a site that works perfectly well.
    for (const origin of origins) {
      if (await chrome.permissions.contains({ origins: [origin] })) return true
    }
  } catch {
    return false
  }
  return false
}

/** Must be called from a click handler, or Chrome refuses silently. */
export async function requestPermission(site: string): Promise<boolean> {
  const origins = originPatterns(site)
  if (origins.length === 0) return false
  try {
    return await chrome.permissions.request({ origins })
  } catch {
    return false
  }
}

/** Give back access when a site is removed. Nothing keeps what it stopped needing. */
export async function dropPermission(site: string): Promise<void> {
  const origins = originPatterns(site)
  if (origins.length === 0) return
  try {
    await chrome.permissions.remove({ origins })
  } catch {
    // Chrome refuses to remove a permission it never granted; not an error.
  }
}
