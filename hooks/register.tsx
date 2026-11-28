// clickable-links: URLs, file paths, GitHub/GitLab #refs and commit SHAs in
// Claude Code replies and tool output become links.
//
// Path lookup (prefsOf, realRoot, kindOf, lookUp, ctxOf) is adapted from
// pepperonas/path-links@67a0e96 hooks/register.tsx (MIT); the engine-like
// reply row and the fullscreen/press handling follow kiankhooban/open-paths@
// dad28e2 hooks/register.tsx (MIT); the tool rows are baselane-sh/mods@4522510
// url-links and sha-links (MIT).

import type { EngineInterface, PluginOptions, Register, RenderElement, RenderInput } from 'claude-code'

import { forgeCache } from './forge'
import type { Forge } from './forge'
import { outputTexts } from './output'
import { DEFAULTS, MAX_FILE_HREFS, beforePaths, fileHrefs, transform, webHrefs } from './pipeline'
import { escapeLabel, probes, rewrite, rootOf, walk } from './paths'
import type { Ctx, Entry, Kind, Lister, Mode, Prefs } from './paths'
import { DEFAULT_CLICKS, pathOfFileHref, pressPlan } from './press'
import type { Clicks } from './press'
import { shaLinks } from './shas'
import { findUrls } from './urls'

const NAME = 'clickable-links'
/** What `/clickable-links paths <word>` sets the path mode to. */
// Per-folder links (path-links' `segments`) were dropped after dogfooding: without a hover
// underline a reader cannot tell which part of a path a click would open (user, 2026-11-26).
const PATH_WORDS: Record<string, Mode> = { whole: 'file', off: 'off' }
const WORD_OF: Record<Mode, string> = { file: 'whole', segments: 'whole', off: 'off' }
/** How long a lookup is trusted: a path that exists rarely vanishes, a missing one may appear soon. */
const HIT_MS = 60_000
const MISS_MS = 5_000
/** Lookups one drawing may start; the rest wait for the next drawing. */
const MAX_PROBES = 64
/** Lookups remembered at most. */
const MAX_CACHE = 2000
/** A listing that has not answered by then counts as missing, so a stalled mount never holds up a drawing. */
const LIST_TIMEOUT_MS = 300
/** How long a directory listing is reused while drawing (a press always lists afresh). */
const LIST_MS = 5_000
/** How long `open` may take. */
const OPEN_TIMEOUT_MS = 5_000
/** Link rows listed under one tool row, at most; the rest are counted. */
const MAX_ROWS = 5

// Runs of whitespace between command words: splits "paths  split" in two; "split" stays one word.
// Tester: https://regex101.com/?regex=%5Cs%2B&flags=g&testString=paths%20%20split
const WORDS = /\s+/
/** `on`/`off` set a switch; anything else flips it. */
const SWITCH: Record<string, boolean> = { on: true, off: false }

const isMode = (v: unknown): v is Mode => v === 'file' || v === 'off'
/** A stored or configured mode, with an earlier version's `segments` read as whole. */
const modeOf = (v: unknown): unknown => (v === 'segments' ? 'file' : v)
const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
const pick = <T,>(v: unknown, ok: (v: unknown) => v is T, d: T): T => (ok(v) ? v : d)

/** userConfig defaults, overridden by what /clickable-links stored. */
export function prefsOf(options: PluginOptions, stored: unknown): Prefs {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<Prefs>
  const base: Prefs = {
    mode: pick(modeOf(options.mode), isMode, DEFAULTS.mode),
    codeBlocks: pick(options.codeBlocks, isBool, DEFAULTS.codeBlocks),
    relative: pick(options.relative, isBool, DEFAULTS.relative),
  }
  return { mode: pick(modeOf(s.mode), isMode, base.mode), codeBlocks: pick(s.codeBlocks, isBool, base.codeBlocks), relative: pick(s.relative, isBool, base.relative) }
}

let prefs: Prefs = DEFAULTS
let home: string | undefined
let canReveal: boolean | undefined
let clicks: Clicks = DEFAULT_CLICKS
let appleTerminal: boolean | undefined
/** What `/clickable-links files|folders <word>` may set. */
const FILE_WORDS: readonly string[] = ['reveal', 'open']
const FOLDER_WORDS: readonly string[] = ['open', 'reveal']
/** Apple Terminal forwards Cmd+click as a plain click and Claude Code opens no link on a plain click
 * there (it does for Ghostty and Warp), so in Apple Terminal web links are this mod's to open. */
const APPLE_TERMINAL = 'Apple_Terminal'

/** The stored click actions, each checked; anything unknown falls back to the default. */
export function clicksOf(stored: unknown): Clicks {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<Clicks>
  return {
    files: s.files === 'open' ? 'open' : DEFAULT_CLICKS.files,
    folders: s.folders === 'reveal' ? 'reveal' : DEFAULT_CLICKS.folders,
  }
}
const forgeFor = forgeCache()
const cache = new Map<string, { kind: Kind | null; at: number }>()
const listings = new Map<string, { entries: readonly Entry[] | undefined; at: number }>()
const rootsReal = new Map<string, string | null>()

async function timed<T>($: EngineInterface, p: Promise<T>): Promise<T | undefined> {
  let timer: { cancel(): void } | undefined
  const late = new Promise<undefined>(done => {
    timer = $.clock.after(LIST_TIMEOUT_MS, () => done(undefined))
  })
  const r = await Promise.race([p.catch(() => undefined), late])
  timer?.cancel()
  return r
}

/** Where a trusted root really lies (`/tmp` is `/private/tmp` on macOS); only roots are ever stat-ed. */
async function realRoot($: EngineInterface, root: string): Promise<string | null> {
  if (!rootsReal.has(root)) {
    const st = await timed($, $.fs.stat(root, { resolve: true }))
    rootsReal.set(root, st?.kind === 'dir' && st.realPath ? st.realPath : null)
  }
  return rootsReal.get(root) ?? null
}

/** What `abs` is, walked down from its trusted root; `fresh` lists every folder again (a press). */
async function kindOf($: EngineInterface, abs: string, ctx: Ctx, now: number, fresh = false): Promise<Kind | null> {
  const root = rootOf(abs, ctx)
  if (!root) return null
  const real = await realRoot($, root)
  if (!real) return null
  const list: Lister = async dir => {
    const c = listings.get(dir)
    if (!fresh && c && now - c.at <= LIST_MS) return c.entries
    const entries = await timed($, $.fs.list(dir))
    listings.set(dir, { entries, at: now })
    return entries
  }
  return (await walk(abs, root, real, list)) ?? null
}

/** Look up what the text names and is not fresh in the cache. */
async function lookUp($: EngineInterface, paths: string[], now: number, ctx: Ctx): Promise<void> {
  const stale = paths.filter(p => {
    const c = cache.get(p)
    return !c || now - c.at > (c.kind ? HIT_MS : MISS_MS)
  })
  await Promise.all(
    stale.slice(0, MAX_PROBES).map(async p => {
      cache.set(p, { kind: await kindOf($, p, ctx, now), at: now })
    }),
  )
  if (listings.size > MAX_CACHE) listings.clear()
  if (cache.size > MAX_CACHE) {
    [...cache.keys()].slice(0, cache.size - MAX_CACHE).forEach(k => {
      cache.delete(k)
    })
  }
}

async function ctxOf($: EngineInterface): Promise<Ctx> {
  if (home === undefined) home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
  const cwd = await $.session.cwd().catch(() => undefined)
  return { home: home || undefined, cwd }
}

/** The session repository's forge, read once per working directory. */
async function forgeOfSession($: EngineInterface): Promise<Forge | undefined> {
  const cwd = await $.session.cwd().catch(() => '')
  return forgeFor(cwd, () => $.session.repo())
}

/** A plain click may reveal in Finder only on this Mac's own engine. */
async function revealable($: EngineInterface): Promise<boolean> {
  if (canReveal === undefined) {
    const info = await $.session.info().catch(() => undefined)
    canReveal = info?.platform === 'macos' && info.isHosted !== true
  }
  return canReveal
}

/** Whether this engine runs in Apple Terminal, read once. */
async function inAppleTerminal($: EngineInterface): Promise<boolean> {
  if (appleTerminal === undefined) appleTerminal = (await $.env.get('TERM_PROGRAM').catch(() => undefined)) === APPLE_TERMINAL
  return appleTerminal
}

/** A plain click on a link our row answers: a file:// link after a fresh lookup, a web link as is. */
async function press($: EngineInterface, href: string): Promise<void> {
  const path = pathOfFileHref(href)
  const ctx = await ctxOf($)
  const kindNow = path === undefined ? undefined : ((await kindOf($, path, ctx, await $.clock.now(), true)) ?? undefined)
  const plan = pressPlan(href, kindNow, clicks)
  if (plan.toast !== undefined) $.ui.toast(plan.toast)
  if (plan.argv !== undefined) await $.process.run(plan.argv, { timeoutMs: OPEN_TIMEOUT_MS })
}

// A link target that needs <...>: matches "https://w.org/Foo_(bar)"; rejects "https://a.dev/x".
// Tester: https://regex101.com/?regex=%5B%28%29%5Cs%3C%3E%5D&flags=&testString=https%3A%2F%2Fw.org%2FFoo_%28bar%29%0Ahttps%3A%2F%2Fa.dev%2Fx
const NEEDS_BRACKETS = /[()\s<>]/

/** A markdown link whose label and target cannot break out of it; the label escaped as path-links
 * escapes its own (`\`, backticks, `*`, `_`, `[`, `]`, `<`, `>`, `~` stay literal). */
const mdLink = (label: string, href: string): string => `[${escapeLabel(label)}](${NEEDS_BRACKETS.test(href) ? `<${href}>` : href})`

/** The engine's tool row with `↗` link rows under it: native links, or in Apple Terminal (where a
 * plain click never opens a native link) one Markdown whose links this mod opens on a plain click. */
async function linkRows(
  $: EngineInterface,
  e: RenderInput<'ToolResult'> | RenderInput<'ToolUse'>,
  row: RenderElement,
  links: readonly { href: string; label: string }[],
  key: string,
): Promise<RenderElement> {
  const { Box, Text, Link, Markdown } = $.ui.resolve(e)
  const shown = links.slice(0, MAX_ROWS)
  const rest = links.length - MAX_ROWS
  const more = rest > 0 ? <Text dimColor>{`  +${rest} more`}</Text> : null
  const ours = e.surface === 'terminal' && e.viewport?.isFullscreen !== false && (await revealable($)) && (await inAppleTerminal($))
  if (ours) {
    const text = shown.map(l => `↗ ${mdLink(l.label, l.href)}`).join('  \n')
    return (
      <Box flexDirection="column">
        {row}
        <Box paddingLeft={2} flexDirection="column">
          <Markdown key={key} text={text} pressableLinks={shown.map(l => l.href)} onLinkPress={link => press($, link.href)} />
          {more}
        </Box>
      </Box>
    ) as RenderElement
  }
  return (
    <Box flexDirection="column">
      {row}
      <Box key={key} flexDirection="column">
        {shown.map(l => (
          <Text key={l.href}>
            <Text dimColor>{'  ↗ '}</Text>
            <Link href={l.href} label={l.label} />
          </Text>
        ))}
        {more}
      </Box>
    </Box>
  ) as RenderElement
}

async function savePrefs($: EngineInterface, p: Prefs): Promise<void> {
  prefs = p
  await $.store.set('prefs', p).catch(() => undefined)
  $.ui.invalidate('ui.render')
}

async function saveClicks($: EngineInterface, c: Clicks): Promise<void> {
  clicks = c
  await $.store.set('clicks', c).catch(() => undefined)
}

/** Labels of the walkthrough's dialogs: one constant each, compared exactly with the answer. */
const MENU = { files: 'File clicks', folders: 'Folder clicks', paths: 'Path links', done: 'Done' } as const
const FILE_CHOICES = { reveal: 'Reveal in Finder', open: 'Open in its app' } as const
const FOLDER_CHOICES = { open: 'Open the folder', reveal: 'Reveal in its parent folder' } as const
const PATH_CHOICES = { on: 'On', off: 'Off', blocks: 'Code-block line on/off', relative: 'Relative paths on/off' } as const
/** Menu rounds one walkthrough may take, so an answer the dialog never gives cannot loop forever. */
const MAX_ROUNDS = 12

/** `/clickable-links` with no arguments: the settings, one AskUserQuestion dialog at a time.
 * Each change returns to the menu; Done, a dismissal or MAX_ROUNDS ends it. */
async function walkthrough($: EngineInterface, round = 0): Promise<void> {
  if (round >= MAX_ROUNDS) return
  const pick = await $.ui
    .ask(`What would you like to change? (now: ${status(prefs, clicks).slice(STATUS_PREFIX.length)})`, {
      header: 'Settings',
      options: [MENU.files, MENU.folders, MENU.paths, MENU.done],
    })
    .catch(() => MENU.done)
  if (pick === MENU.files) {
    const a = await $.ui.ask('What should a click on a file do?', { header: 'Files', options: [FILE_CHOICES.reveal, FILE_CHOICES.open] }).catch(() => '')
    if (a === FILE_CHOICES.reveal || a === FILE_CHOICES.open) await saveClicks($, { ...clicks, files: a === FILE_CHOICES.open ? 'open' : 'reveal' })
  } else if (pick === MENU.folders) {
    const a = await $.ui.ask('What should a click on a folder do?', { header: 'Folders', options: [FOLDER_CHOICES.open, FOLDER_CHOICES.reveal] }).catch(() => '')
    if (a === FOLDER_CHOICES.open || a === FOLDER_CHOICES.reveal) await saveClicks($, { ...clicks, folders: a === FOLDER_CHOICES.reveal ? 'reveal' : 'open' })
  } else if (pick === MENU.paths) {
    const a = await $.ui
      .ask('How should file paths in replies be linked?', { header: 'Paths', options: [PATH_CHOICES.on, PATH_CHOICES.off, PATH_CHOICES.blocks, PATH_CHOICES.relative] })
      .catch(() => '')
    if (a === PATH_CHOICES.on) await savePrefs($, { ...prefs, mode: 'file' })
    if (a === PATH_CHOICES.off) await savePrefs($, { ...prefs, mode: 'off' })
    if (a === PATH_CHOICES.blocks) await savePrefs($, { ...prefs, codeBlocks: !prefs.codeBlocks })
    if (a === PATH_CHOICES.relative) await savePrefs($, { ...prefs, relative: !prefs.relative })
  } else {
    return
  }
  return walkthrough($, round + 1)
}

const HELP = [
  'Commands:',
  `  /${NAME}                         walk through the settings (one dialog at a time)`,
  `  /${NAME} help                    this reference`,
  `  /${NAME} paths whole|off         a path is one link · paths off`,
  `  /${NAME} blocks on|off           a clickable line under code blocks that name paths`,
  `  /${NAME} relative on|off         link relative paths (resolved against the working directory)`,
  `  /${NAME} files reveal|open       a click on a file: select it in Finder · open it in its app`,
  `  /${NAME} folders open|reveal     a click on a folder: open it in Finder · select it in its parent`,
  'In Apple Terminal a plain click also opens web links (Cmd+click never reaches Claude Code there).',
]

/** What every status line starts with; the walkthrough's menu shows the rest. */
const STATUS_PREFIX = `${NAME}: `

const status = (p: Prefs, c: Clicks) =>
  `${STATUS_PREFIX}paths ${WORD_OF[p.mode]} · code blocks ${p.codeBlocks ? 'on' : 'off'} · relative ${p.relative ? 'on' : 'off'} · files ${c.files} · folders ${c.folders}`

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    prefs = prefsOf(options, await $.store.get('prefs').catch(() => undefined))
    clicks = clicksOf(await $.store.get('clicks').catch(() => undefined))
    await $.command.register({
      name: NAME,
      description: `${NAME}: clickable URLs, paths, #refs and SHAs (/${NAME} help)`,
      argumentHint: '[paths whole|off] [blocks on|off] [relative on|off] [files reveal|open] [folders open|reveal]',
      immediate: true,
    })
    return next(e)
  })

  on('command.run', { command: NAME }, async ($, e) => {
    const [cmd = '', arg = ''] = e.args.trim().toLowerCase().split(WORDS)
    if (cmd === '') {
      await walkthrough($)
      return { text: status(prefs, clicks) }
    }
    const save = async (p: Prefs) => {
      await savePrefs($, p)
      return { text: status(p, clicks) }
    }
    const setClicks = async (c: Clicks) => {
      await saveClicks($, c)
      return { text: status(prefs, c) }
    }
    const flag = (v: boolean) => SWITCH[arg] ?? !v
    const mode = PATH_WORDS[arg]
    if (cmd === 'paths' && mode !== undefined) return save({ ...prefs, mode })
    if (cmd === 'blocks') return save({ ...prefs, codeBlocks: flag(prefs.codeBlocks) })
    if (cmd === 'relative') return save({ ...prefs, relative: flag(prefs.relative) })
    if (cmd === 'files' && FILE_WORDS.includes(arg)) return setClicks({ ...clicks, files: arg === 'open' ? 'open' : 'reveal' })
    if (cmd === 'folders' && FOLDER_WORDS.includes(arg)) return setClicks({ ...clicks, folders: arg === 'reveal' ? 'reveal' : 'open' })
    return { text: [status(prefs, clicks), '', ...HELP].join('\n') }
  })

  // The stored reply stays as written; only its drawing carries the links.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary) return next(e)
    const text = e.props.text
    let out = text
    let own = false
    let hrefs: string[] = []
    try {
      const forge = await forgeOfSession($)
      const ctx = await ctxOf($)
      if (prefs.mode !== 'off') await lookUp($, probes(beforePaths(text, forge), ctx, prefs), await $.clock.now(), ctx)
      out = transform(text, forge, ctx, prefs, abs => cache.get(abs)?.kind ?? undefined)
      // Only the fullscreen terminal reports plain clicks; elsewhere the surface follows file:// itself.
      const ours = e.surface === 'terminal' && e.viewport?.isFullscreen !== false && (await revealable($))
      // Only file links the path stage made from a verified path are pressable: a file:// link the
      // model wrote itself (already there before the path stage) stays the surface's own.
      const written = new Set(fileHrefs(beforePaths(text, forge)))
      const made = fileHrefs(out).filter(h => !written.has(h))
      hrefs = ours ? [...made, ...((await inAppleTerminal($)) ? webHrefs(out) : [])].slice(0, MAX_FILE_HREFS) : []
      own = hrefs.length > 0
    } catch {
      return next(e) // never in the way of a reply
    }
    if (out === text) return next(e)
    if (!own) return next({ ...e, props: { ...e.props, text: out } })
    const { Box, Text, Markdown } = $.ui.resolve(e)
    // The engine's own reply row: a blank line above and a "● " gutter on a reply's first block.
    return (
      <Box flexDirection="row" marginTop={1}>
        <Box width={2} flexShrink={0}>
          <Text>{e.props.isFirstOfReply ? '●' : ' '}</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          <Markdown key={NAME} text={out} pressableLinks={hrefs} onLinkPress={link => press($, link.href)} />
        </Box>
      </Box>
    ) as RenderElement
  })

  // URLs in any tool's result, listed under it (the fold may hide them).
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const row = await next(e)
    try {
      const hrefs = findUrls(outputTexts(e.props.output))
      return hrefs.length === 0 ? row : await linkRows($, e, row, hrefs.map(href => ({ href, label: href })), `${NAME}-urls`)
    } catch {
      return row
    }
  })

  // Paths that exist in a prompt (a typed one, a handover's launch prompt), listed under it: the
  // engine draws a prompt as plain text, so a markdown link in its text would show as brackets.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const row = await next(e)
    if (prefs.mode === 'off') return row
    try {
      const ctx = await ctxOf($)
      await lookUp($, probes(e.props.text, ctx, prefs), await $.clock.now(), ctx)
      // Only links this stage made from a verified path; a file:// link typed into the prompt stays text.
      const written = new Set(fileHrefs(e.props.text))
      const hrefs = fileHrefs(rewrite(e.props.text, ctx, prefs, abs => cache.get(abs)?.kind ?? undefined)).filter(h => !written.has(h))
      if (hrefs.length === 0) return row
      const shown = hrefs.slice(0, MAX_ROWS)
      const rest = hrefs.length - MAX_ROWS
      // file:// cannot ride a native Link (https only), so the rows are one Markdown, as replies are.
      const ours = e.surface === 'terminal' && e.viewport?.isFullscreen !== false && (await revealable($))
      const { Box, Text, Markdown } = $.ui.resolve(e)
      const text = shown.map(h => `↗ ${mdLink(pathOfFileHref(h) ?? h, h)}`).join('  \n')
      return (
        <Box flexDirection="column">
          {row}
          <Box paddingLeft={2} flexDirection="column">
            <Markdown key={`${NAME}-paths`} text={text} pressableLinks={ours ? shown : []} onLinkPress={link => press($, link.href)} />
            {rest > 0 ? <Text dimColor>{`  +${rest} more`}</Text> : null}
          </Box>
        </Box>
      ) as RenderElement
    } catch {
      return row // never in the way of a prompt
    }
  })

  // Commit SHAs a git Bash call printed, listed under its row.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const row = await next(e)
    if (e.props.tool !== 'Bash') return row
    try {
      const links = shaLinks(e, await forgeOfSession($))
      return links.length === 0 ? row : await linkRows($, e, row, links, `${NAME}-shas`)
    } catch {
      return row
    }
  })
}
