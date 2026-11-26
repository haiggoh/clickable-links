// The whole of clickable-links that rewrites a reply's markdown: refs and
// URLs, then commit SHAs, then file paths. Every stage leaves fenced code,
// existing links and autolinks alone, so a later stage never links inside
// what an earlier one linked. Pure: whether a path exists comes in via `look`.

import type { Forge } from './forge'
import type { Ctx, Look, Prefs } from './paths'
import { DEFAULT_PREFS, rewrite } from './paths'
import { linkifyRefs } from './refs'
import { linkifyShas } from './shas'

/** Past this many characters a rewritten reply is drawn as written (baselane's MAX_MARKDOWN). */
export const MAX_MARKDOWN = 10_000
/** The most targets a Markdown's `pressableLinks` may carry. */
export const MAX_FILE_HREFS = 256

/** path-links' defaults, with a path drawn as one link (`/clickable-links paths whole`). */
export const DEFAULTS: Prefs = { ...DEFAULT_PREFS, mode: 'file' }

// A markdown link whose target is a file:// URL, the target captured.
// Matches "[a](file:///h/me/a)"; rejects "[b](https://b.dev)".
// Tester: https://regex101.com/?regex=%5C%5D%5C%28%28file%3A%5C%2F%5C%2F%5B%5E%29%5Cs%5D%2B%29%5C%29&flags=g&testString=%5Ba%5D%28file%3A%2F%2F%2Fh%2Fme%2Fa%29%0A%5Bb%5D%28https%3A%2F%2Fb.dev%29
const FILE_LINK = /\]\((file:\/\/[^)\s]+)\)/g

/** The reply after the refs and SHA stages: what the path stage scans (and the hook probes). */
export function beforePaths(text: string, forge: Forge | undefined): string {
  return linkifyShas(linkifyRefs(text, forge), forge)
}

/** The reply with every stage's links, or the reply as written when the result passes MAX_MARKDOWN. */
export function transform(text: string, forge: Forge | undefined, ctx: Ctx, prefs: Prefs, look: Look): string {
  const out = rewrite(beforePaths(text, forge), ctx, prefs, look)
  return out.length > MAX_MARKDOWN ? text : out
}

// A markdown link whose target is an http(s) URL: the `<...>` form linkify writes for a URL with
// parentheses, or the plain form; the target captured without the angle brackets.
// Matches "[x](<https://w.org/Foo_(bar)>)" and "[#9](https://github.com/a/b/issues/9)"; rejects "[f](file:///h/me/a)".
// Tester: https://regex101.com/?regex=%5C%5D%5C%28%28%3F%3A%3C%28https%3F%3A%5C%2F%5C%2F%5B%5E%3E%5Cs%5D%2B%29%3E%7C%28https%3F%3A%5C%2F%5C%2F%5B%5E%29%5Cs%5D%2B%29%29%5C%29&flags=g&testString=%5B%239%5D%28https%3A%2F%2Fgithub.com%2Fa%2Fb%2Fissues%2F9%29%0A%5Bx%5D%28%3Chttps%3A%2F%2Fw.org%2FFoo_%28bar%29%3E%29%0A%5Bf%5D%28file%3A%2F%2F%2Fh%2Fme%2Fa%29
const WEB_LINK = /\]\((?:<(https?:\/\/[^>\s]+)>|(https?:\/\/[^)\s]+))\)/g

/** Each http(s) link target once, in order, at most MAX_FILE_HREFS. */
export function webHrefs(markdown: string): string[] {
  const targets = [...markdown.matchAll(WEB_LINK)].flatMap(m => {
    const href = m[1] ?? m[2]
    return href === undefined ? [] : [href]
  })
  return [...new Set(targets)].slice(0, MAX_FILE_HREFS)
}

/** Each file:// link target once, in order, at most MAX_FILE_HREFS. */
export function fileHrefs(markdown: string): string[] {
  const targets = [...markdown.matchAll(FILE_LINK)].flatMap(m => (m[1] === undefined ? [] : [m[1]]))
  return [...new Set(targets)].slice(0, MAX_FILE_HREFS)
}
