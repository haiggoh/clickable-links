// Adapted from baselane-sh/mods@4522510 plugins/sha-links/hooks/rules/sha-links.ts (MIT)
//
// Git commit SHAs become links to the commit page of the repository's
// GitHub or GitLab origin: in replies, and under the row of a Bash call that
// ran git. Display only; with no known origin everything stays plain.
// clickable-links change: the rule wrapper (baselane's engine.ts) is gone;
// these are plain functions the pipeline and register.tsx call.

import type { ElementTable, RenderElement, RenderInput } from 'claude-code'

import type { Forge } from './forge'
import { commitHref } from './forge'
import { linkTokens } from './marks'
import { outputTexts } from './output'
import { MAX_SCAN } from './urls'

// 7 to 40 lowercase hex digits holding a digit and a letter, not part of a
// longer word, path, URL, number (0x...), color (#...) or file name. A range
// (`a1b2c3d..e4f5a6b`) links both ends.
// Matches "3f9e2a1" in "fixed in 3f9e2a1"; rejects "#a1b2c3d4" and "deadbeef".
// Tester: https://regex101.com/?regex=%28%3F%3C%21%5B%5Cw%2F%3A%23%40%3D%3F%26-%5D%29%28%3F%3C%21%5Cw%5C.%29%28%3F%3D%5B0-9a-f%5D%2A%5Ba-f%5D%29%28%3F%3D%5B0-9a-f%5D%2A%5Cd%29%5B0-9a-f%5D%7B7%2C40%7D%28%3F%21%5B%5Cw%2F-%5D%7C%5C.%5Cw%29&flags=g&testString=fixed%20in%203f9e2a1%0Anot%20%23a1b2c3d4%20or%20deadbeef
const SHA = String.raw`(?<![\w/:#@=?&-])(?<!\w\.)(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}(?![\w/-]|\.\w)`
// The SHA pattern above, global, for matchAll and linkTokens: same matches
// ("3f9e2a1"), same rejects ("deadbeef").
// Tester: https://regex101.com/?regex=%28%3F%3C%21%5B%5Cw%2F%3A%23%40%3D%3F%26-%5D%29%28%3F%3C%21%5Cw%5C.%29%28%3F%3D%5B0-9a-f%5D%2A%5Ba-f%5D%29%28%3F%3D%5B0-9a-f%5D%2A%5Cd%29%5B0-9a-f%5D%7B7%2C40%7D%28%3F%21%5B%5Cw%2F-%5D%7C%5C.%5Cw%29&flags=g&testString=fixed%20in%203f9e2a1%0Anot%20%23a1b2c3d4%20or%20deadbeef
const SHA_GLOBAL = new RegExp(SHA, 'g')
// A shell command that runs git: matches "cd x && git log"; rejects "github".
// Tester: https://regex101.com/?regex=%28%5E%7C%5B%5Cs%3B%26%7C%28%60%5D%29git%28%5Cs%7C%24%29&flags=&testString=cd%20x%20%26%26%20git%20log%0Agithub
const GIT_COMMAND = /(^|[\s;&|(`])git(\s|$)/
// A diff's `index <blob>..<blob>` line names blobs, not commits.
// Matches "index 3f9e2a1..a1b2c3d 100644"; rejects "commit 3f9e2a1".
// Tester: https://regex101.com/?regex=%5Eindex%20%5B0-9a-f%5D%2B%28%2C%5B0-9a-f%5D%2B%29%2A%5C.%5C.%5B0-9a-f%5D%2B&flags=&testString=index%203f9e2a1..a1b2c3d%20100644%0Acommit%203f9e2a1
const BLOB_LINE = /^index [0-9a-f]+(,[0-9a-f]+)*\.\.[0-9a-f]+/
const KEY = 'clickable-links-shas'
const MAX_LINKS = 5
const LABEL = 12

/** Each SHA once, in the order first written. */
export const findShas = (text: string): string[] => [...new Set([...text.slice(0, MAX_SCAN).matchAll(SHA_GLOBAL)].map(match => match[0]))]

/** The markdown with each SHA outside code and links made a commit link; unchanged without a forge. */
export const linkifyShas = (markdown: string, forge: Forge | undefined): string => {
  if (forge === undefined || findShas(markdown).length === 0) return markdown
  return linkTokens(markdown, SHA_GLOBAL, sha => commitHref(forge, sha))
}

const commandOf = (input: unknown): string | undefined =>
  typeof input === 'object' && input !== null && 'command' in input && typeof input.command === 'string' ? input.command : undefined

/** The engine's Bash row with up to five `↗ <sha>` commit links under it, or undefined to leave the row alone. */
export const shaRows = (
  e: RenderInput<'ToolUse'>,
  row: RenderElement,
  { Box, Text, Link }: ElementTable,
  forge: Forge | undefined,
): RenderElement | undefined => {
  if (forge === undefined) return undefined
  const command = commandOf(e.props.input)
  if (command === undefined || !GIT_COMMAND.test(command) || e.props.output === undefined) return undefined
  const shas = findShas(
    outputTexts(e.props.output)
      .join('\n')
      .slice(0, MAX_SCAN)
      .split('\n')
      .filter(line => !BLOB_LINE.test(line))
      .join('\n'),
  )
  const links = shas.flatMap(sha => {
    const href = commitHref(forge, sha)
    return href === undefined ? [] : [{ sha, href }]
  })
  if (links.length === 0) return undefined
  const rest = links.length - MAX_LINKS
  return h(
    Box,
    { flexDirection: 'column' },
    row,
    h(
      Box,
      { key: KEY, flexDirection: 'column' },
      ...links
        .slice(0, MAX_LINKS)
        .map(({ sha, href }) => h(Text, null, h(Text, { dimColor: true }, '  ↗ '), h(Link, { href, label: sha.slice(0, LABEL) }))),
      rest > 0 ? h(Text, { dimColor: true }, `  +${rest} more`) : null,
    ),
  ) as RenderElement
}
