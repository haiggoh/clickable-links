// What a plain click on a link our row answers does. A file is revealed in
// Finder (or opened, `files open`), a folder opened (or revealed in its parent,
// `folders reveal`), a web link opened in the browser. Pure: what a path is now
// comes in as `kindNow`, from a fresh lookup at press time, so a path deleted
// since the reply was drawn runs nothing.

import type { Kind } from './paths'

export type Clicks = { files: 'reveal' | 'open'; folders: 'open' | 'reveal' }
export type PressPlan = { argv: string[] } | { toast: string }

export const DEFAULT_CLICKS: Clicks = { files: 'reveal', folders: 'open' }

const SCHEME = 'file://'
const WEB = ['https://', 'http://']

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

/** The `open` call for a press on `href`, or a toast when it is gone or not a link this mod opens. */
export function pressPlan(href: string, kindNow: Kind | undefined, clicks: Clicks): PressPlan {
  if (WEB.some(w => href.startsWith(w))) return { argv: ['open', href] }
  const path = pathOfFileHref(href)
  if (path === undefined) return { toast: `clickable-links: ${href} is not a link this mod opens` }
  if (kindNow === undefined) return { toast: `clickable-links: ${path} no longer exists` }
  const reveal = kindNow === 'file' ? clicks.files === 'reveal' : clicks.folders === 'reveal'
  return { argv: reveal ? ['open', '-R', path] : ['open', path] }
}
