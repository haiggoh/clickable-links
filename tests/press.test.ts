import { expect, test } from 'claude-code/testing'

import { fileUrl } from '../hooks/paths'
import { pathOfFileHref, pressPlan } from '../hooks/press'

// A neutral fake home folder: fixtures never name a real machine's paths.
const HOME = '/h/me'

test('a file press reveals the file in Finder', () => {
  expect(pressPlan(`file://${HOME}/a%23b/c.txt`, 'file')).toEqual({ argv: ['open', '-R', `${HOME}/a#b/c.txt`] })
})

test('a folder press opens the folder in Finder', () => {
  expect(pressPlan(`file://${HOME}/d/`, 'dir')).toEqual({ argv: ['open', `${HOME}/d`] })
})

test('a press on a path that is gone runs nothing and says so', () => {
  expect(pressPlan(`file://${HOME}/gone.txt`, undefined)).toEqual({ toast: `clickable-links: ${HOME}/gone.txt no longer exists` })
})

test('every name path-links can encode decodes back to itself', () => {
  const names = [`${HOME}/My Drive/a (1)/#x?.md`, `${HOME}/100%/ü.txt`, `${HOME}/semi;colon,comma.md`]
  expect(names.map(n => pathOfFileHref(fileUrl(n, 'file')))).toEqual(names)
})

test('anything but a file:// href is no path', () => {
  expect(pathOfFileHref('https://a.dev/x')).toBeUndefined()
  expect(pathOfFileHref('file://host/share/x')).toBeUndefined()
  expect(pathOfFileHref('file://%E0%A4%A')).toBeUndefined()
})
