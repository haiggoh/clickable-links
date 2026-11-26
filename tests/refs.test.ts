// Ported from babarot/claude-linkify@99f52f2 tests/linkify.test.ts (MIT)
import { expect, test } from 'claude-code/testing'

import { forgeOf } from '../hooks/forge'
import { linkifyRefs } from '../hooks/refs'

const REPO = forgeOf('git@github.com:babarot/gomi.git')

test('#123 links into the session repository', () => {
  expect(linkifyRefs('Fixed in #123.', REPO)).toBe('Fixed in [#123](https://github.com/babarot/gomi/issues/123).')
  expect(linkifyRefs('（#7）と #8 を参照', REPO)).toBe(
    '（[#7](https://github.com/babarot/gomi/issues/7)）と [#8](https://github.com/babarot/gomi/issues/8) を参照',
  )
  expect(linkifyRefs('#1,#2', REPO)).toBe(
    '[#1](https://github.com/babarot/gomi/issues/1),[#2](https://github.com/babarot/gomi/issues/2)',
  )
})

test('owner/repo#123 links anywhere, with or without a session repository', () => {
  expect(linkifyRefs('see cli/cli#42', undefined)).toBe('see [cli/cli#42](https://github.com/cli/cli/issues/42)')
})

test('PR#, issue# and repo# point into the session repository and its owner', () => {
  const repo = forgeOf('git@github.com:acme/web.git')
  expect(linkifyRefs('PR#1', repo)).toBe('[PR#1](https://github.com/acme/web/pull/1)')
  expect(linkifyRefs('pr#1 and pull#1', repo)).toBe(
    '[pr#1](https://github.com/acme/web/pull/1) and [pull#1](https://github.com/acme/web/pull/1)',
  )
  expect(linkifyRefs('issue#2', repo)).toBe('[issue#2](https://github.com/acme/web/issues/2)')
  expect(linkifyRefs('api#3', repo)).toBe('[api#3](https://github.com/acme/api/issues/3)')
  expect(linkifyRefs('（docs#5）を参照', repo)).toBe('（[docs#5](https://github.com/acme/docs/issues/5)）を参照')
  expect(linkifyRefs('babarot/hoge#1', repo)).toBe('[babarot/hoge#1](https://github.com/babarot/hoge/issues/1)')
  expect(linkifyRefs('#4', repo)).toBe('[#4](https://github.com/acme/web/issues/4)')
})

test('repo#123 can be turned off, leaving PR#, issue# and #123', () => {
  const off = { repoRefs: false }
  expect(linkifyRefs('api#3', REPO, off)).toBe('api#3')
  expect(linkifyRefs('PR#1', REPO, off)).toBe('[PR#1](https://github.com/babarot/gomi/pull/1)')
})

test('what is not a reference stays text', () => {
  expect(linkifyRefs('Step#1 no#2 v#3 123#4 a&#123; #12abc #1-2 color: #fff', REPO)).toBe(
    'Step#1 no#2 v#3 123#4 a&#123; #12abc #1-2 color: #fff',
  )
  expect(linkifyRefs('# Heading', REPO)).toBe('# Heading')
  // Without a session repository, nothing short has anywhere to point.
  expect(linkifyRefs('Fixed in #123, PR#4 and gomi#5', undefined)).toBe('Fixed in #123, PR#4 and gomi#5')
})

test('bare URLs become links, without the punctuation around them', () => {
  expect(linkifyRefs('Open https://example.com/a?b=1.', undefined)).toBe(
    'Open [https://example.com/a?b=1](https://example.com/a?b=1).',
  )
  expect(linkifyRefs('https://example.comを見て', undefined)).toBe('[https://example.com](https://example.com)を見て')
  expect(linkifyRefs('(see https://example.com/x)', undefined)).toBe('(see [https://example.com/x](https://example.com/x))')
  expect(linkifyRefs('https://en.wikipedia.org/wiki/Foo_(bar)', undefined)).toBe(
    '[https://en.wikipedia.org/wiki/Foo\\_(bar)](<https://en.wikipedia.org/wiki/Foo_(bar)>)',
  )
  // A URL's own fragment is part of the URL, not a reference.
  expect(linkifyRefs('https://example.com/a#12', REPO)).toBe('[https://example.com/a#12](https://example.com/a#12)')
})

test('code and existing links are left alone', () => {
  const text = [
    'Run `gh issue view #12` or open [the PR](https://github.com/x/y/pull/3).',
    '<https://example.com>',
    '```sh',
    'curl https://example.com # see #5',
    '```',
    'then #6',
  ].join('\n')
  expect(linkifyRefs(text, REPO)).toBe(
    [
      'Run `gh issue view #12` or open [the PR](https://github.com/x/y/pull/3).',
      '<https://example.com>',
      '```sh',
      'curl https://example.com # see #5',
      '```',
      'then [#6](https://github.com/babarot/gomi/issues/6)',
    ].join('\n'),
  )
})

// Added for clickable-links: GitLab, credentials, MR refs.
const GITLAB = forgeOf('git@gitlab.com:grp/sub/proj.git')

test('#123 and MR#123 link into a GitLab project with nested groups', () => {
  expect(linkifyRefs('see #5 and MR#6', GITLAB)).toBe(
    'see [#5](https://gitlab.com/grp/sub/proj/-/issues/5) and [MR#6](https://gitlab.com/grp/sub/proj/-/merge_requests/6)',
  )
})

test('PR#1 on GitHub and on GitLab point at the right page kind', () => {
  expect(linkifyRefs('MR#2', REPO)).toBe('[MR#2](https://github.com/babarot/gomi/pull/2)')
  expect(linkifyRefs('PR#1', GITLAB)).toBe('[PR#1](https://gitlab.com/grp/sub/proj/-/merge_requests/1)')
})

test('a sibling repo ref on GitLab stays inside the same group', () => {
  expect(linkifyRefs('api#3', GITLAB)).toBe('[api#3](https://gitlab.com/grp/sub/api/-/issues/3)')
})

test('a remote carrying credentials never leaks them into an href', () => {
  const out = linkifyRefs('#4', forgeOf('https://u:tok@github.com/a/b.git'))
  expect(out).toBe('[#4](https://github.com/a/b/issues/4)')
  expect(out.includes('tok')).toBe(false)
})

test('a non-GitHub, non-GitLab origin links only URLs', () => {
  expect(linkifyRefs('#7 https://a.dev', forgeOf('git@bitbucket.org:a/b.git'))).toBe('#7 [https://a.dev](https://a.dev)')
})
