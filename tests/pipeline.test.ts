import { expect, test } from 'claude-code/testing'

import { forgeOf } from '../hooks/forge'
import type { Ctx, Kind } from '../hooks/paths'
import { DEFAULTS, MAX_FILE_HREFS, MAX_MARKDOWN, fileHrefs, transform, webHrefs } from '../hooks/pipeline'

// A neutral fake home folder: fixtures never name a real machine's paths.
const HOME = '/h/me'
const WS = `${HOME}/projects`
const README = `${WS}/cost-tracker/README.md`
const CTX: Ctx = { home: HOME, cwd: `${HOME}/src/shop` }
const FORGE = forgeOf('git@github.com:acme/web.git')
const FS: Record<string, Kind> = {
  [`${HOME}/x/#12/a.md`]: 'file',
  [README]: 'file',
  [`${WS}/cost-tracker`]: 'dir',
  [WS]: 'dir',
  [HOME]: 'dir',
}
// A trailing slash: matches "/h/me/dir/"; rejects "/h/me/file".
// Tester: https://regex101.com/?regex=%5C%2F%24&flags=g&testString=%2Fh%2Fme%2Fdir%2F%0A%2Fh%2Fme%2Ffile
const TRAILING_SLASH = /\/$/
// A markdown link's target: matches "[a](file:///h/me/a)"; rejects "[a] (x)".
// Tester: https://regex101.com/?regex=%5C%5D%5C%28%28%5B%5E%29%5D%2B%29%5C%29&flags=g&testString=%5Ba%5D%28file%3A%2F%2F%2Fh%2Fme%2Fa%29%0A%5Ba%5D%20%28x%29
const LINK_TARGET = /\]\(([^)]+)\)/g
// How far under the markdown cap the over-cap fixture starts.
const UNDER_CAP = 20
// More file links than pressableLinks may carry.
const OVER_BY = 44
const TOO_MANY = MAX_FILE_HREFS + OVER_BY

const look = (abs: string): Kind | undefined => FS[abs.replace(TRAILING_SLASH, '')]
const links = (md: string): string[] => [...md.matchAll(LINK_TARGET)].flatMap(m => (m[1] === undefined ? [] : [m[1]]))

test('defaults draw a path as one link', () => {
  expect(DEFAULTS.mode).toBe('file')
})

test('a #N inside a path or a URL fragment is no issue link, and the path is still one file link', () => {
  const out = transform('see ~/x/#12/a.md and https://a.dev/x#12', FORGE, CTX, DEFAULTS, look)
  expect(out.includes('/issues/12')).toBe(false)
  expect(links(out)).toEqual([`file://${HOME}/x/%2312/a.md`, 'https://a.dev/x#12'])
})

test('whole mode makes a path one link; split mode one link per folder and the file', () => {
  const text = 'open ~/projects/cost-tracker/README.md now'
  expect(links(transform(text, FORGE, CTX, DEFAULTS, look))).toEqual([`file://${README}`])
  expect(links(transform(text, FORGE, CTX, { ...DEFAULTS, mode: 'segments' }, look))).toEqual([
    `file://${HOME}/`,
    `file://${WS}/`,
    `file://${WS}/cost-tracker/`,
    `file://${README}`,
  ])
})

test('every stage runs once: refs, SHAs and paths in one reply', () => {
  const out = transform('#4 in 3f9e2a1 touched ~/projects/cost-tracker/README.md', FORGE, CTX, DEFAULTS, look)
  expect(links(out)).toEqual([
    'https://github.com/acme/web/issues/4',
    'https://github.com/acme/web/commit/3f9e2a1',
    `file://${README}`,
  ])
})

test('a reply that would grow past the markdown cap is returned unchanged', () => {
  const text = `${'x'.repeat(MAX_MARKDOWN - UNDER_CAP)} https://a.dev`
  expect(text.length <= MAX_MARKDOWN).toBe(true)
  expect(transform(text, FORGE, CTX, DEFAULTS, look)).toBe(text)
})

test('fileHrefs lists each file:// target once and no https target', () => {
  const md = `[a](file://${HOME}/a) [b](https://b.dev) [a](file://${HOME}/a) [c](file://${HOME}/c/)`
  expect(fileHrefs(md)).toEqual([`file://${HOME}/a`, `file://${HOME}/c/`])
})

test('fileHrefs keeps at most as many targets as pressableLinks may carry', () => {
  const md = Array.from({ length: TOO_MANY }, (_, i) => `[f](file://${HOME}/f${i})`).join(' ')
  expect(fileHrefs(md).length).toBe(MAX_FILE_HREFS)
})

test('webHrefs lists each http(s) target once, unwrapping <...> targets with parentheses, no file: target', () => {
  const md = transform('see #4, https://en.wikipedia.org/wiki/Foo_(bar) and #4 again', FORGE, CTX, DEFAULTS, look)
  expect(webHrefs(`${md} [f](file://${HOME}/a)`)).toEqual(['https://github.com/acme/web/issues/4', 'https://en.wikipedia.org/wiki/Foo_(bar)'])
})
