// Adapted from babarot/claude-linkify@99f52f2 hooks/linkify.ts (MIT)
// Turns bare URLs and GitHub/GitLab references in markdown into markdown
// links, leaving code (fenced blocks, inline spans) and existing links alone.
//
// clickable-links changes: the session repository is a `Forge` (GitHub or
// GitLab, from baselane's forge.ts) instead of a GitHub `owner/repo` string;
// MR#123 is a merge/pull request; every href passes baselane's `linkable`.

import type { Forge } from './forge'
import { linkable } from './urls'

const FENCE = /^ {0,3}(`{3,}|~{3,})/

// What must not be touched on a line: inline code, markdown links and
// images, and autolinks. Each is copied through as written.
const PROTECTED = /(`+)[^`]*?\1|!?\[[^\]\n]*\]\([^)\n]*\)|<[a-z][a-z0-9+.-]*:[^>\s]*>/gi

// A bare URL, ASCII only so it stops at Japanese text that follows it
// ("https://example.comを"), or a reference: #123, owner/repo#123 or
// name#123, not preceded by a word character (so a&#123; and the repo in
// owner/repo#1 stay out) and not followed by one.
const TOKEN =
  /(https?:\/\/[A-Za-z0-9\-._~:/?#@!$&'()*+,;=%]+)|(^|[^A-Za-z0-9_/#&@.-])(?:([A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+)|([A-Za-z0-9][A-Za-z0-9._-]*))?#(\d+)(?![A-Za-z0-9_-])/g

// name#123 where the name says what kind of thing #123 is in the session
// repository, rather than naming another repository.
const KINDS: Record<string, 'pull' | 'issues'> = {
  pr: 'pull',
  pull: 'pull',
  mr: 'pull',
  issue: 'issues',
  issues: 'issues',
}

// Words written before #123 that are no repository's name; those stay text
// instead of linking to a repository that does not exist.
const NOT_REPOS = new Set([
  'case',
  'chapter',
  'fig',
  'figure',
  'id',
  'item',
  'line',
  'no',
  'number',
  'option',
  'page',
  'part',
  'phase',
  'round',
  'row',
  'section',
  'step',
  'task',
  'test',
  'ticket',
  'v',
  'version',
])

export type LinkifyOptions = {
  /** name#123 links to the repository `name` of the session repository's owner. */
  repoRefs: boolean
}

/** A URL without the punctuation that ends the sentence around it. */
function trimUrl(url: string): string {
  let end = url.length
  for (;;) {
    const last = url[end - 1] ?? ''
    if (/[.,;:!?'*]/.test(last)) {
      end--
      continue
    }
    if (last === ')') {
      const body = url.slice(0, end)
      if (body.split('(').length < body.split(')').length) {
        end--
        continue
      }
    }
    return url.slice(0, end)
  }
}

function link(text: string, href: string): string {
  const label = text.replace(/([\\*_~[\]])/g, '\\$1')
  const dest = /[()\s]/.test(href) ? `<${href}>` : href
  return `[${label}](${dest})`
}

/** The page of issue or pull request `num` in `path` on `forge`'s host. */
function pageOf(forge: Forge, path: string, kind: 'pull' | 'issues', num: string): string | null {
  const gitlab = forge.host === 'gitlab.com'
  const section = gitlab ? (kind === 'pull' ? '-/merge_requests' : '-/issues') : kind
  return linkable(`https://${forge.host}/${path}/${section}/${num}`) ?? null
}

/** Where a reference points, or null when it stays text. */
function resolveRef(
  qualified: string | undefined,
  name: string | undefined,
  num: string,
  forge: Forge | undefined,
  options: LinkifyOptions,
): string | null {
  // owner/repo#123 names a GitHub repository wherever the session is.
  // /issues/<n> redirects to the pull request when the number is one.
  if (qualified !== undefined) return linkable(`https://github.com/${qualified}/issues/${num}`) ?? null
  if (forge === undefined) return null
  if (name === undefined) return pageOf(forge, forge.path, 'issues', num)
  const lower = name.toLowerCase()
  const kind = KINDS[lower]
  if (kind !== undefined) return pageOf(forge, forge.path, kind, num)
  if (!options.repoRefs || NOT_REPOS.has(lower) || /^\d+$/.test(name)) return null
  // A sibling repository: same owner (GitHub) or same group (GitLab).
  const parent = forge.path.slice(0, forge.path.lastIndexOf('/'))
  return pageOf(forge, `${parent}/${name}`, 'issues', num)
}

function linkifyPlain(text: string, forge: Forge | undefined, options: LinkifyOptions): string {
  return text.replace(
    TOKEN,
    (
      whole,
      url: string | undefined,
      before: string,
      qualified: string | undefined,
      name: string | undefined,
      num: string,
    ) => {
      if (url !== undefined) {
        const trimmed = trimUrl(url)
        return link(trimmed, trimmed) + url.slice(trimmed.length)
      }
      const href = resolveRef(qualified, name, num, forge, options)
      if (href === null) return whole
      return before + link(`${qualified ?? name ?? ''}#${num}`, href)
    },
  )
}

function linkifyLine(line: string, forge: Forge | undefined, options: LinkifyOptions): string {
  let out = ''
  let last = 0
  for (const match of line.matchAll(PROTECTED)) {
    out += linkifyPlain(line.slice(last, match.index), forge, options) + match[0]
    last = match.index + match[0].length
  }
  return out + linkifyPlain(line.slice(last), forge, options)
}

/**
 * The markdown with bare URLs and issue references made links. `forge` is
 * the session repository, which #123, PR#123 and name#123 point into;
 * undefined leaves them as text.
 */
export function linkifyRefs(markdown: string, forge: Forge | undefined, options: LinkifyOptions = { repoRefs: true }): string {
  if (!markdown.includes('http') && !markdown.includes('#')) return markdown
  let fence: string | null = null
  return markdown
    .split('\n')
    .map(line => {
      const marker = FENCE.exec(line)?.[1]
      if (fence !== null) {
        // A fence closes with the same character, at least as many times.
        if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) fence = null
        return line
      }
      if (marker !== undefined) {
        fence = marker
        return line
      }
      // Indented code blocks are not told apart from nested list items,
      // which replies use far more; both are linkified.
      return linkifyLine(line, forge, options)
    })
    .join('\n')
}
