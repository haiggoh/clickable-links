// What a plain click on a file:// link in a reply does: a file is revealed in
// Finder (selected in its folder), a folder is opened in Finder. Pure: what
// the path is now comes in as `kindNow`, from a fresh lookup at press time,
// so a path deleted since the reply was drawn runs nothing.

import type { Kind } from './paths'

export type PressPlan = { argv: string[] } | { toast: string }

const SCHEME = 'file://'

/** The local absolute path a file:// href names, or undefined (another scheme, a host, a bad escape). */
export function pathOfFileHref(href: string): string | undefined {
  if (!href.startsWith(SCHEME)) return undefined
  const rest = href.slice(SCHEME.length)
  if (!rest.startsWith('/')) return undefined
  try {
    // decodeURIComponent undoes encodeURI and path-links' extra %23 %3F %28 %29,
    // and a literal % in a name (encoded %25) comes back as itself.
    const path = decodeURIComponent(rest)
    return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
  } catch {
    return undefined
  }
}

/** The `open` call for a press on `href`, or a toast when the path is gone or no local path. */
export function pressPlan(href: string, kindNow: Kind | undefined): PressPlan {
  const path = pathOfFileHref(href)
  if (path === undefined) return { toast: `clickable-links: ${href} is not a local path` }
  if (kindNow === undefined) return { toast: `clickable-links: ${path} no longer exists` }
  return { argv: kindNow === 'file' ? ['open', '-R', path] : ['open', path] }
}
