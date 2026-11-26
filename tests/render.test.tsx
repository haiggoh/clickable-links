// Hook-level tests: the plugin loaded by the engine's own test host, with a
// stand-in for the engine beneath it (pattern from pepperonas/path-links
// hooks/render.test.tsx, MIT).
import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, FoundElement } from 'claude-code/testing'

import { prefsOf } from '../hooks/register'

// A neutral fake home folder: fixtures never name a real machine's paths.
const HOME = '/h/me'
const CWD = `${HOME}/src/shop`
const FILE = `${HOME}/notes/plan.md`
const DIR = `${HOME}/notes`
const ENGINE_KEY = 'engine'
const OUR_KEY = 'clickable-links'
// A roomy fullscreen terminal.
const COLUMNS = 120
const ROWS = 40
const VIEWPORT = { columns: COLUMNS, rows: ROWS }

type World = { files: Record<string, 'file' | 'dir'>; runs: string[][]; toasts: string[] }

/** Children of a folder in the pretend file system, as `$.fs.list` names them. */
function children(world: World, dir: string) {
  const names = new Map<string, 'file' | 'dir'>()
  Object.entries(world.files).forEach(([p, kind]) => {
    const parts = p.split('/')
    parts.slice(1).forEach((name, i) => {
      const parent = parts.slice(0, i + 1).join('/') || '/'
      if (parent === dir) names.set(name, i + 1 === parts.length - 1 ? kind : 'dir')
    })
  })
  return [...names].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false }))
}

/** The engine beneath the plugin: draws a reply as a Markdown keyed ENGINE_KEY. */
function engine(on: On, platform: 'macos' | 'linux' = 'macos', terminal: string | undefined = undefined): World {
  const world: World = { files: { [FILE]: 'file', [DIR]: 'dir' }, runs: [], toasts: [] }
  mock.clock(on)
  mock.store(on)
  on('ui.render', ($, e) => {
    const { Markdown, Text } = $.ui.resolve(e)
    return e.component === 'AssistantMessage' ? <Markdown key={ENGINE_KEY} text={e.props.text} /> : <Text key={ENGINE_KEY}>row</Text>
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.info', () => ({ value: { transcriptPath: `${HOME}/t.jsonl`, sysname: platform === 'macos' ? 'Darwin' : 'Linux', platform, isHosted: false } }))
  on('session.repo', () => ({ value: { root: CWD, remote: 'git@github.com:acme/web.git', internal: false, name: null } }))
  on('env.get', (_$, e) => ({ value: ({ HOME, TERM_PROGRAM: terminal } as Record<string, string | undefined>)[e.name] }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('fs.stat', (_$, e) => ({ value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('fs.list', (_$, e) => ({ value: children(world, e.path) }))
  on('process.run', (_$, e) => {
    world.runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', (_$, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  return world
}

type Surface = 'terminal' | 'desktop' | 'vscode'
type Drawn = { findAll: (q: { type: string }) => Promise<FoundElement[]> }
type Md = { key: string | undefined; text: unknown; pressableLinks: unknown }

// What a typed /clickable-links <args> in the fullscreen terminal sends.
const typed = (args: string) => ({
  command: OUR_KEY,
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: VIEWPORT.columns },
})

const start = ($: Engine) => $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
const reply = ($: Engine, text: string, surface: Surface = 'terminal') =>
  $.ui.mount({ plugin: OUR_KEY, component: 'AssistantMessage', requestId: 'm1', props: { text, isFirstOfReply: true }, surface, viewport: VIEWPORT })
const markdowns = async (ui: Drawn): Promise<Md[]> =>
  (await ui.findAll({ type: 'Markdown' })).map(m => ({ key: m.key, text: m.props.text, pressableLinks: m.props.pressableLinks }))
/** Draw one reply, read its Markdown, and unmount it, so the next drawing may reuse the id. */
const drawOnce = async ($: Engine, text: string): Promise<Md> => {
  const ui = await reply($, text)
  const md = await firstMd(ui)
  await ui.unmount()
  return md
}
const firstMd = async (ui: Drawn): Promise<Md> => {
  const [md] = await markdowns(ui)
  if (md === undefined) throw new Error('no Markdown drawn')
  return md
}

test('on the terminal a reply naming a file is our own Markdown whose pressable links are all file:', async ($, on) => {
  engine(on)
  await start($)
  const md = await firstMd(await reply($, `See ${FILE} and https://a.dev`))
  expect(md.key).toBe(OUR_KEY)
  expect(md.text).toBe(`See [${FILE}](file://${FILE}) and [https://a.dev](https://a.dev)`)
  expect(md.pressableLinks).toEqual([`file://${FILE}`])
})

const OTHER_SURFACES: readonly Surface[] = ['desktop', 'vscode']
OTHER_SURFACES.forEach(surface => {
  test(`on ${surface} the rewritten text goes on to the engine, with no tree of our own`, async ($, on) => {
    engine(on)
    await start($)
    const md = await firstMd(await reply($, `See ${FILE}`, surface))
    expect(md.key).toBe(ENGINE_KEY)
    expect(md.text).toBe(`See [${FILE}](file://${FILE})`)
  })
})

test('off macOS the rewritten text goes on to the engine, with no click handler', async ($, on) => {
  engine(on, 'linux')
  await start($)
  const md = await firstMd(await reply($, `See ${FILE}`))
  expect(md.key).toBe(ENGINE_KEY)
  expect(md.text).toBe(`See [${FILE}](file://${FILE})`)
})

test('a reply with only a URL and a ref goes on to the engine, linked', async ($, on) => {
  engine(on)
  await start($)
  const md = await firstMd(await reply($, 'Closed by #9, see https://a.dev'))
  expect(md.key).toBe(ENGINE_KEY)
  expect(md.text).toBe('Closed by [#9](https://github.com/acme/web/issues/9), see [https://a.dev](https://a.dev)')
})

test('a plain click on a file reveals it in Finder; on a folder opens it', async ($, on) => {
  const world = engine(on)
  await start($)
  const ui = await reply($, `See ${FILE} in ${DIR}`)
  await ui.press({ key: OUR_KEY, link: { href: `file://${FILE}` } })
  await ui.press({ key: OUR_KEY, link: { href: `file://${DIR}/` } })
  expect(world.runs).toEqual([
    ['open', '-R', FILE],
    ['open', DIR],
  ])
})

test('a click on a file deleted since the drawing runs nothing and says so', async ($, on) => {
  const world = engine(on)
  await start($)
  const ui = await reply($, `See ${FILE}`)
  delete world.files[FILE]
  await ui.press({ key: OUR_KEY, link: { href: `file://${FILE}` } })
  expect(world.runs).toEqual([])
  expect(world.toasts).toEqual([`clickable-links: ${FILE} no longer exists`])
})

test('/clickable-links paths split is no longer accepted: the help is shown and paths stay whole', async ($, on) => {
  engine(on)
  await start($)
  const { text } = await $.command.run(typed('paths split'))
  expect((text ?? '').includes('paths whole|off')).toBe(true)
  expect((await drawOnce($, FILE)).pressableLinks).toEqual([`file://${FILE}`])
})

test('a split mode stored by an earlier version is read as whole', () => {
  expect(prefsOf({}, { mode: 'segments', codeBlocks: true, relative: true }).mode).toBe('file')
})

test('/clickable-links paths whole and off switch paths on and off', async ($, on) => {
  engine(on)
  await start($)
  await $.command.run(typed('paths off'))
  expect((await drawOnce($, FILE)).text).toBe(FILE)
  await $.command.run(typed('paths whole'))
  expect((await drawOnce($, FILE)).pressableLinks).toEqual([`file://${FILE}`])
})

test('a summary block is drawn as the engine draws it', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount({ plugin: OUR_KEY, component: 'AssistantMessage', requestId: 'm2', props: { text: `See ${FILE}`, isFirstOfReply: true, isSummary: true }, surface: 'terminal' })
  const md = await firstMd(ui)
  expect([md.key, md.text]).toEqual([ENGINE_KEY, `See ${FILE}`])
})

test('URLs in a tool result are listed as links under the result', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount({
    plugin: OUR_KEY,
    component: 'ToolResult',
    requestId: 't1',
    props: { tool_use_id: 't1', tool: 'Bash', output: { stdout: 'deployed to https://a.dev/x.', stderr: '' }, isErrored: false },
    surface: 'terminal',
  })
  expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(['https://a.dev/x'])
})

test('SHAs printed by a git Bash call are listed as commit links under its row', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount({
    plugin: OUR_KEY,
    component: 'ToolUse',
    requestId: 't2',
    props: {
      tool_use_id: 't2',
      tool: 'Bash',
      input: { command: 'git log --oneline -1' },
      output: { stdout: '3f9e2a1 fix things', stderr: '' },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
    },
    surface: 'terminal',
  })
  expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(['https://github.com/acme/web/commit/3f9e2a1'])
})

// Apple Terminal forwards Cmd+click as a plain click and Claude Code opens no link on a plain
// click there, so web links are ours to answer in that terminal (as Claude Code does for Ghostty).
const APPLE = 'Apple_Terminal'
const ISSUE = 'https://github.com/acme/web/issues/9'

test('in Apple Terminal a reply with only web links is our own row and its web links are pressable', async ($, on) => {
  engine(on, 'macos', APPLE)
  await start($)
  const md = await firstMd(await reply($, 'Closed by #9'))
  expect(md.key).toBe(OUR_KEY)
  expect(md.pressableLinks).toEqual([ISSUE])
})

test('in Apple Terminal a plain click on a web link opens it in the browser', async ($, on) => {
  const world = engine(on, 'macos', APPLE)
  await start($)
  const ui = await reply($, 'Closed by #9')
  await ui.press({ key: OUR_KEY, link: { href: ISSUE } })
  expect(world.runs).toEqual([['open', ISSUE]])
})

test('in any other terminal web links stay the engine\'s, even beside a file link', async ($, on) => {
  engine(on, 'macos', 'ghostty')
  await start($)
  const md = await firstMd(await reply($, `See ${FILE}, closed by #9`))
  expect(md.key).toBe(OUR_KEY)
  expect(md.pressableLinks).toEqual([`file://${FILE}`])
})

test('/clickable-links files open and folders reveal change what a plain click does', async ($, on) => {
  const world = engine(on)
  await start($)
  await $.command.run(typed('files open'))
  await $.command.run(typed('folders reveal'))
  const ui = await reply($, `See ${FILE} in ${DIR}`)
  await ui.press({ key: OUR_KEY, link: { href: `file://${FILE}` } })
  await ui.press({ key: OUR_KEY, link: { href: `file://${DIR}/` } })
  expect(world.runs).toEqual([
    ['open', FILE],
    ['open', '-R', DIR],
  ])
})

const DEPLOY = 'https://a.dev/x'
const COMMIT = 'https://github.com/acme/web/commit/3f9e2a1'
const resultRow = ($: Engine) =>
  $.ui.mount({
    plugin: OUR_KEY,
    component: 'ToolResult',
    requestId: 't3',
    props: { tool_use_id: 't3', tool: 'Bash', output: { stdout: `deployed to ${DEPLOY}.`, stderr: '' }, isErrored: false },
    surface: 'terminal',
    viewport: VIEWPORT,
  })
const gitRow = ($: Engine) =>
  $.ui.mount({
    plugin: OUR_KEY,
    component: 'ToolUse',
    requestId: 't4',
    props: {
      tool_use_id: 't4',
      tool: 'Bash',
      input: { command: 'git log --oneline -1' },
      output: { stdout: '3f9e2a1 fix things', stderr: '' },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
    },
    surface: 'terminal',
    viewport: VIEWPORT,
  })

test('in Apple Terminal the URL rows under a tool result open on a plain click', async ($, on) => {
  const world = engine(on, 'macos', APPLE)
  await start($)
  const ui = await resultRow($)
  const [md] = await markdowns(ui)
  expect(md?.pressableLinks).toEqual([DEPLOY])
  await ui.press({ key: `${OUR_KEY}-urls`, link: { href: DEPLOY } })
  expect(world.runs).toEqual([['open', DEPLOY]])
})

test('in Apple Terminal the commit rows under a git Bash call open on a plain click', async ($, on) => {
  const world = engine(on, 'macos', APPLE)
  await start($)
  const ui = await gitRow($)
  const [md] = await markdowns(ui)
  expect(md?.pressableLinks).toEqual([COMMIT])
  await ui.press({ key: `${OUR_KEY}-shas`, link: { href: COMMIT } })
  expect(world.runs).toEqual([['open', COMMIT]])
})

test('in any other terminal the tool rows stay native links', async ($, on) => {
  engine(on, 'macos', 'ghostty')
  await start($)
  expect((await (await resultRow($)).findAll({ type: 'Link' })).map(l => l.props.href)).toEqual([DEPLOY])
  expect((await (await gitRow($)).findAll({ type: 'Link' })).map(l => l.props.href)).toEqual([COMMIT])
})

/** Answers the next `$.ui.ask` dialogs with these labels, in order; records each question asked. */
function answers(on: On, labels: string[]): string[] {
  const asked: string[] = []
  const queue = [...labels]
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const questions = e.questions
    const q = questions[0]?.question ?? ''
    asked.push(q)
    const label = queue.shift()
    if (label === undefined) return { deny: 'dismissed' }
    return { result: { questions, answers: { [q]: label } } } as never
  })
  return asked
}

// menu → File clicks → its choice → menu → Folder clicks → its choice → menu → Done: five dialogs.
const WALK_DIALOGS = 5

test('plain /clickable-links walks through the options and saves what is picked', async ($, on) => {
  const world = engine(on)
  const asked = answers(on, ['File clicks', 'Open in its app', 'Folder clicks', 'Reveal in its parent folder', 'Done'])
  await start($)
  const { text } = await $.command.run(typed(''))
  expect(asked.length).toBe(WALK_DIALOGS)
  expect((text ?? '').includes('files open · folders reveal')).toBe(true)
  const ui = await reply($, `See ${FILE} in ${DIR}`)
  await ui.press({ key: OUR_KEY, link: { href: `file://${FILE}` } })
  await ui.press({ key: OUR_KEY, link: { href: `file://${DIR}/` } })
  expect(world.runs).toEqual([
    ['open', FILE],
    ['open', '-R', DIR],
  ])
})

test('the walkthrough can turn path links off', async ($, on) => {
  engine(on)
  answers(on, ['Path links', 'Off', 'Done'])
  await start($)
  await $.command.run(typed(''))
  expect((await drawOnce($, FILE)).text).toBe(FILE)
})

test('dismissing the walkthrough changes nothing and still reports the settings', async ($, on) => {
  engine(on)
  answers(on, [])
  await start($)
  const { text } = await $.command.run(typed(''))
  expect((text ?? '').includes('paths whole · code blocks on · relative on · files reveal · folders open')).toBe(true)
})

test('/clickable-links help prints the command reference without asking anything', async ($, on) => {
  engine(on)
  const asked = answers(on, ['Done'])
  await start($)
  const { text } = await $.command.run(typed('help'))
  expect(asked.length).toBe(0)
  expect((text ?? '').includes('files reveal|open')).toBe(true)
})
