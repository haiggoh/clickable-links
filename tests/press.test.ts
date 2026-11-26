import { expect, test } from 'claude-code/testing'

import { fileUrl } from '../hooks/paths'
import { DEFAULT_CLICKS, pathOfFileHref, pressPlan } from '../hooks/press'

// A neutral fake home folder: fixtures never name a real machine's paths.
const HOME = '/h/me'

test('by default a file press reveals the file in Finder', () => {
  expect(pressPlan(`file://${HOME}/a%23b/c.txt`, 'file', DEFAULT_CLICKS)).toEqual({ argv: ['open', '-R', `${HOME}/a#b/c.txt`] })
})

test('by default a folder press opens the folder in Finder, never as an app', () => {
  expect(pressPlan(`file://${HOME}/d/`, 'dir', DEFAULT_CLICKS)).toEqual({ argv: ['open', '-a', 'Finder', `${HOME}/d`] })
  // an app bundle is a folder: Finder shows its contents instead of launching it
  expect(pressPlan('file:///Applications/Calculator.app/', 'dir', DEFAULT_CLICKS)).toEqual({ argv: ['open', '-a', 'Finder', '/Applications/Calculator.app'] })
})

test('files open opens a file in its app; folders reveal selects the folder in its parent', () => {
  const clicks = { files: 'open', folders: 'reveal' } as const
  expect(pressPlan(`file://${HOME}/a.md`, 'file', clicks)).toEqual({ argv: ['open', `${HOME}/a.md`] })
  expect(pressPlan(`file://${HOME}/d/`, 'dir', clicks)).toEqual({ argv: ['open', '-R', `${HOME}/d`] })
})

test('a press on a path that is gone runs nothing and says so', () => {
  expect(pressPlan(`file://${HOME}/gone.txt`, undefined, DEFAULT_CLICKS)).toEqual({ toast: `clickable-links: ${HOME}/gone.txt no longer exists` })
})

test('a web link press opens it in the browser', () => {
  expect(pressPlan('https://github.com/acme/web/issues/9', undefined, DEFAULT_CLICKS)).toEqual({ argv: ['open', 'https://github.com/acme/web/issues/9'] })
  expect(pressPlan('http://localhost:3000/x', undefined, DEFAULT_CLICKS)).toEqual({ argv: ['open', 'http://localhost:3000/x'] })
})

test('any other scheme is never handed to open', () => {
  expect(pressPlan('javascript:alert(1)', undefined, DEFAULT_CLICKS)).toEqual({ toast: 'clickable-links: javascript:alert(1) is not a link this mod opens' })
  expect(pressPlan('ftp://a.dev/x', undefined, DEFAULT_CLICKS)).toEqual({ toast: 'clickable-links: ftp://a.dev/x is not a link this mod opens' })
})

test('every name path-links can encode decodes back to itself', () => {
  const names = [`${HOME}/My Drive/a (1)/#x?.md`, `${HOME}/100%/ü.txt`, `${HOME}/semi;colon,comma.md`]
  expect(names.map(n => pathOfFileHref(fileUrl(n, 'file')))).toEqual(names)
})

test('anything but a local file:// href is no path', () => {
  expect(pathOfFileHref('https://a.dev/x')).toBeUndefined()
  expect(pathOfFileHref('file://host/share/x')).toBeUndefined()
  expect(pathOfFileHref('file://%E0%A4%A')).toBeUndefined()
})

test('files open never launches a script, app, installer or extensionless file: it reveals it instead', () => {
  const clicks = { files: 'open', folders: 'open' } as const
  const risky = ['run.command', 'x.sh', 'tool.py', 'Setup.pkg', 'Disk.dmg', 'a.terminal', 'Do.workflow', 'b.scpt', 'site.webloc', 'mybinary']
  expect(risky.map(n => pressPlan(`file://${HOME}/${n}`, 'file', clicks))).toEqual(
    risky.map(n => ({ argv: ['open', '-R', `${HOME}/${n}`], toast: `clickable-links: ${n} could run something, so it is shown in Finder instead` })),
  )
})
