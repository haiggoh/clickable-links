// clickable-links: URLs, file paths, GitHub/GitLab #refs and commit SHAs in
// Claude Code replies and tool output become links.
//
// Path lookup (prefsOf, realRoot, kindOf, lookUp, ctxOf) is adapted from
// pepperonas/path-links@67a0e96 hooks/register.tsx (MIT); the engine-like
// reply row and the fullscreen/press handling follow kiankhooban/open-paths@
// dad28e2 hooks/register.tsx (MIT); the tool rows are baselane-sh/mods@4522510
// url-links and sha-links (MIT).

import type { EngineInterface, PluginOptions, Register, RenderElement } from 'claude-code'

import { forgeCache } from './forge'
import type { Forge } from './forge'
import { outputTexts } from './output'
import { DEFAULTS, beforePaths, fileHrefs, transform } from './pipeline'
import { probes, rootOf, walk } from './paths'
import type { Ctx, Entry, Kind, Lister, Mode, Prefs } from './paths'
import { pathOfFileHref, pressPlan } from './press'
import { shaRows } from './shas'
import { findUrls } from './urls'

const NAME = 'clickable-links'
/** What `/clickable-links paths <word>` sets the path mode to. */
const PATH_WORDS: Record<string, Mode> = { whole: 'file', split: 'segments', off: 'off' }
const WORD_OF: Record<Mode, string> = { file: 'whole', segments: 'split', off: 'off' }
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
/** URL rows listed under one tool result, at most; the rest are counted. */
const MAX_URL_ROWS = 5

// Runs of whitespace between command words: splits "paths  split" in two; "split" stays one word.
// Tester: https://regex101.com/?regex=%5Cs%2B&flags=g&testString=paths%20%20split
const WORDS = /\s+/
/** `on`/`off` set a switch; anything else flips it. */
const SWITCH: Record<string, boolean> = { on: true, off: false }

const isMode = (v: unknown): v is Mode => v === 'file' || v === 'segments' || v === 'off'
const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
const pick = <T,>(v: unknown, ok: (v: unknown) => v is T, d: T): T => (ok(v) ? v : d)

/** userConfig defaults, overridden by what /clickable-links stored. */
export function prefsOf(options: PluginOptions, stored: unknown): Prefs {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<Prefs>
  const base: Prefs = {
    mode: pick(options.mode, isMode, DEFAULTS.mode),
    codeBlocks: pick(options.codeBlocks, isBool, DEFAULTS.codeBlocks),
    relative: pick(options.relative, isBool, DEFAULTS.relative),
  }
  return { mode: pick(s.mode, isMode, base.mode), codeBlocks: pick(s.codeBlocks, isBool, base.codeBlocks), relative: pick(s.relative, isBool, base.relative) }
}

let prefs: Prefs = DEFAULTS
let home: string | undefined
let canReveal: boolean | undefined
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

/** A plain click on a file:// link: reveal a file or open a folder in Finder, after a fresh lookup. */
async function press($: EngineInterface, href: string): Promise<void> {
  const path = pathOfFileHref(href)
  const ctx = await ctxOf($)
  const kindNow = path === undefined ? undefined : ((await kindOf($, path, ctx, await $.clock.now(), true)) ?? undefined)
  const plan = pressPlan(href, kindNow)
  if ('toast' in plan) return $.ui.toast(plan.toast)
  await $.process.run(plan.argv, { timeoutMs: OPEN_TIMEOUT_MS })
}

const HELP = [
  'Commands:',
  `  /${NAME}                         this report`,
  `  /${NAME} paths whole|split|off   a path is one link · one link per folder · paths off`,
  `  /${NAME} blocks on|off           a clickable line under code blocks that name paths`,
  `  /${NAME} relative on|off         link relative paths (resolved against the working directory)`,
  'A plain click on a file reveals it in Finder, on a folder opens it; Cmd/Ctrl-click opens the file.',
]

const status = (p: Prefs) => `${NAME}: paths ${WORD_OF[p.mode]} · code blocks ${p.codeBlocks ? 'on' : 'off'} · relative ${p.relative ? 'on' : 'off'}`

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    prefs = prefsOf(options, await $.store.get('prefs').catch(() => undefined))
    await $.command.register({
      name: NAME,
      description: `${NAME}: clickable URLs, paths, #refs and SHAs (/${NAME} help)`,
      argumentHint: '[paths whole|split|off] [blocks on|off] [relative on|off]',
      immediate: true,
    })
    return next(e)
  })

  on('command.run', { command: NAME }, async ($, e) => {
    const [cmd = '', arg = ''] = e.args.trim().toLowerCase().split(WORDS)
    const save = async (p: Prefs) => {
      prefs = p
      await $.store.set('prefs', p).catch(() => undefined)
      $.ui.invalidate('ui.render')
      return { text: status(p) }
    }
    const flag = (v: boolean) => SWITCH[arg] ?? !v
    const mode = PATH_WORDS[arg]
    if (cmd === 'paths' && mode !== undefined) return save({ ...prefs, mode })
    if (cmd === 'blocks') return save({ ...prefs, codeBlocks: flag(prefs.codeBlocks) })
    if (cmd === 'relative') return save({ ...prefs, relative: flag(prefs.relative) })
    return { text: [status(prefs), '', ...HELP].join('\n') }
  })

  // The stored reply stays as written; only its drawing carries the links.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary) return next(e)
    const text = e.props.text
    let out = text
    let own = false
    try {
      const forge = await forgeOfSession($)
      const ctx = await ctxOf($)
      if (prefs.mode !== 'off') await lookUp($, probes(beforePaths(text, forge), ctx, prefs), await $.clock.now(), ctx)
      out = transform(text, forge, ctx, prefs, abs => cache.get(abs)?.kind ?? undefined)
      // Only the fullscreen terminal reports plain clicks; elsewhere the surface follows file:// itself.
      own = e.surface === 'terminal' && e.viewport?.isFullscreen !== false && fileHrefs(out).length > 0 && (await revealable($))
    } catch {
      return next(e) // never in the way of a reply
    }
    if (out === text) return next(e)
    if (!own) return next({ ...e, props: { ...e.props, text: out } })
    const hrefs = fileHrefs(out)
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
    let hrefs: string[]
    try {
      hrefs = findUrls(outputTexts(e.props.output))
    } catch {
      return row
    }
    if (hrefs.length === 0) return row
    const { Box, Text, Link } = $.ui.resolve(e)
    const rest = hrefs.length - MAX_URL_ROWS
    return (
      <Box flexDirection="column">
        {row}
        <Box key={`${NAME}-urls`} flexDirection="column">
          {hrefs.slice(0, MAX_URL_ROWS).map(href => (
            <Text key={href}>
              <Text dimColor>{'  ↗ '}</Text>
              <Link href={href} />
            </Text>
          ))}
          {rest > 0 ? <Text dimColor>{`  +${rest} more`}</Text> : null}
        </Box>
      </Box>
    ) as RenderElement
  })

  // Commit SHAs a git Bash call printed, listed under its row.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const row = await next(e)
    if (e.props.tool !== 'Bash') return row
    try {
      return shaRows(e, row, $.ui.resolve(e), await forgeOfSession($)) ?? row
    } catch {
      return row
    }
  })
}
