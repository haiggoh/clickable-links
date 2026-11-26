// What a plain click on a link our row answers does. A file is revealed in
// Finder (or opened, `files open`), a folder opened (or revealed in its parent,
// `folders reveal`), a web link opened in the browser. Pure: what a path is now
// comes in as `kindNow`, from a fresh lookup at press time, so a path deleted
// since the reply was drawn runs nothing.

import type { Kind } from './paths'

export type Clicks = { files: 'reveal' | 'open'; folders: 'open' | 'reveal' }
/** The `open` call to run (with a note to show beside it), or only a note when nothing runs. */
export type PressPlan = { argv: string[]; toast?: string } | { toast: string; argv?: undefined }

export const DEFAULT_CLICKS: Clicks = { files: 'reveal', folders: 'open' }

/** File types `open` would launch, run or install rather than show: never opened, only revealed
 * (open-paths' policy: "revealed in the file manager, never launched"). An extensionless file is
 * treated the same, as a mod cannot read the executable bit. */
const RUNS = new Set([
  'app', 'command', 'tool', 'terminal', 'workflow', 'action', 'scpt', 'scptd', 'applescript',
  'sh', 'bash', 'zsh', 'fish', 'csh', 'ksh', 'py', 'pyw', 'rb', 'pl', 'php', 'ps1', 'bat', 'cmd',
  'jar', 'pkg', 'mpkg', 'dmg', 'exe', 'msi', 'webloc', 'inetloc', 'fileloc', 'url',
])

/** Whether opening this file could run something instead of showing it. */
function couldRun(name: string): boolean {
  const dot = name.lastIndexOf('.')
  return dot <= 0 || RUNS.has(name.slice(dot + 1).toLowerCase())
}

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
  if (kindNow === 'dir') {
    // -a Finder: an app bundle is a folder too, and plain `open` would launch it.
    return { argv: clicks.folders === 'reveal' ? ['open', '-R', path] : ['open', '-a', 'Finder', path] }
  }
  if (clicks.files === 'reveal') return { argv: ['open', '-R', path] }
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (couldRun(name)) return { argv: ['open', '-R', path], toast: `clickable-links: ${name} could run something, so it is shown in Finder instead` }
  return { argv: ['open', path] }
}
