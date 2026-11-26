// Ported from baselane-sh/mods@4522510 plugins/sha-links/tests/sha-links.test.ts (MIT):
// the text-level cases; the mount cases become direct linkifyShas calls.
import { expect, test } from 'claude-code/testing'

import { forgeOf } from '../hooks/forge'
import { findShas, linkifyShas } from '../hooks/shas'

const GITHUB = forgeOf('git@github.com:baselane/mods.git')
const SHA = '3f9e2a1'
const FULL = '3f9e2a1c0b8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f'
const HREF = `https://github.com/baselane/mods/commit/${SHA}`
// 'ab12' × 16 = 64 hex digits: longer than any SHA, so it must stay text.
const OVERLONG_REPEATS = 16
// The body length of a GitHub classic token (ghp_ + 36): built at run time so no token-shaped literal is committed.
const TOKEN_BODY = 36

test('findShas keeps 7 to 40 lowercase hex with a digit and a letter, once each', () => {
  const text = [
    `Fixed in ${SHA} and ${FULL}; range ${SHA}..a1b2c3d4. Again ${SHA}.`,
    'Not: 1234567 deadbeef defaced ABC1234 0x1a2b3c4d #a1b2c3d4 abc12 file.a1b2c3d4',
    'Not: 550e8400-e29b-41d4-a716-446655440000 or a 64 digit one',
    `${'ab12'.repeat(OVERLONG_REPEATS)} or https://x.dev/a1b2c3d4e5 or ?sha=a1b2c3d4 or a1b2c3d4/x or a1b2c3d4.ts`,
  ].join('\n')
  expect(findShas(text)).toEqual([SHA, FULL, 'a1b2c3d4'])
})

test('forgeOf reads GitHub and GitLab remotes and keeps no user or token', () => {
  const project = { host: 'github.com', path: 'baselane/mods' }
  expect(forgeOf('https://github.com/baselane/mods.git/')).toEqual(project)
  expect(forgeOf('ssh://git@github.com:22/baselane/mods.git')).toEqual(project)
  expect(forgeOf('https://bob:' + 'ghp_' + 'x'.repeat(TOKEN_BODY) + '@github.com/baselane/mods.git')).toEqual(project)
  expect(forgeOf('git@gitlab.com:group/sub/proj.git')).toEqual({ host: 'gitlab.com', path: 'group/sub/proj' })
  expect(forgeOf('git@bitbucket.org:team/repo.git')).toBeUndefined()
  expect(forgeOf('https://github.com/a/..')).toBeUndefined()
})

test('a SHA in a reply links to its commit page; a code span that is exactly a SHA becomes the link text', () => {
  expect(linkifyShas(`Committed as ${SHA}, then \`${FULL}\`.`, GITHUB)).toBe(
    `Committed as [${SHA}](${HREF}), then [\`${FULL}\`](https://github.com/baselane/mods/commit/${FULL}).`,
  )
})

test('a link another stage drew is kept as written', () => {
  const issue = '[#42](https://github.com/baselane/mods/issues/42)'
  expect(linkifyShas(`Fixed in ${SHA}, closes ${issue}.`, GITHUB)).toBe(`Fixed in [${SHA}](${HREF}), closes ${issue}.`)
})

test('a GitLab origin links under /-/commit/', () => {
  expect(linkifyShas(`See ${SHA}.`, forgeOf('https://gitlab.com/group/sub/proj.git'))).toBe(
    `See [${SHA}](https://gitlab.com/group/sub/proj/-/commit/${SHA}).`,
  )
})

test('no forge, or SHA-looking words in paths, colours and prose, stay text', () => {
  expect(linkifyShas(`See ${SHA}.`, undefined)).toBe(`See ${SHA}.`)
  const text = 'colour #a1b2c3d, word deadbeef1x, path ~/a/abc1234/ and /tmp/abc1234, fenced:\n```\nabc1234\n```'
  expect(linkifyShas(text, GITHUB)).toBe(text)
})
