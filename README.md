# clickable-links

A Claude Code mod that makes the links in Claude's replies and tool output clickable:

| Written in a reply | A plain click |
| --- | --- |
| a web URL, `https://example.com/x` | opens it in your browser |
| a file path, `~/project/README.md` | selects the file in Finder (or opens it, see Settings) |
| a folder path, `~/project/` | opens the folder in Finder (or selects it in its parent) |
| `#123`, `PR#4`, `MR#5`, `repo#6`, `owner/repo#7` | opens the issue or pull/merge request on GitHub or GitLab |
| a commit SHA, `e0497bd` | opens the commit on GitHub or GitLab |

Under tool rows it lists what the output named: `↗ <url>` under any tool result, and `↗ <sha>` commit links under a
`git` Bash call.

Only the drawing changes. The stored message, and what the model reads, stay exactly as written.

## Install

From the haiggoh marketplace:

```sh
claude plugin install clickable-links@haiggoh
```

Then start a new session, or run `/reload-plugins` in one. Needs Claude Code with mods (built and tested on 2.1.332).

## Settings

Type **`/clickable-links`** to walk through the settings in Claude Code's own question dialog: what a click on a file
does, what a click on a folder does, and how paths are linked. Each change returns you to the menu; **Done** or `Esc`
ends it and shows the current settings.

The same settings as typed shortcuts (`/clickable-links help` prints this list):

| Command | Effect |
| --- | --- |
| `/clickable-links files reveal\|open` | a click on a file: select it in Finder (default) · open it in its app (scripts and apps are still only revealed) |
| `/clickable-links folders open\|reveal` | a click on a folder: open it (default) · select it in its parent folder |
| `/clickable-links paths whole\|off` | link each path as one link (default) · leave paths as text |
| `/clickable-links blocks on\|off` | a clickable `↳` line under code blocks that name paths |
| `/clickable-links relative on\|off` | link relative paths, resolved against the session's working directory |

Settings are kept across sessions.

## What it links, in detail

- **Session repository.** `#123` points into the repository of the session's working directory, read from its
  `origin` remote (GitHub or GitLab, nested GitLab groups included), and read again when the directory changes. Outside
  a repository, or with another host, only URLs, `owner/repo#123` and paths are linked.
- **Reference forms.** `PR#`, `pull#` and `MR#` name a pull/merge request; `issue#` an issue; any other `name#123` a
  sibling repository of the same owner or group, except words no repository is named after (`step`, `line`,
  `version`, …).
- **Paths.** Absolute, `~/` and relative paths that **exist** become links; a made-up or deleted path stays text. A
  path is never looked up directly: the lookup walks down from a trusted local root (home, the working directory,
  system folders) one directory listing at a time, so text in a reply can never make the machine reach a network mount.
  Paths through a symlink are not linked.
- **Left alone:** fenced code blocks, inline code (unless the whole span is a path or SHA), existing markdown links and
  autolinks, a `#` inside a URL or a path, and SHA-like words that are colours, numbers or file names.
- **Clicks never run anything.** A plain click runs `open -R <file>` (select in Finder), `open -a Finder <folder>`
  (so an app bundle, which is a folder, shows its contents instead of launching), or with `files open` the file's own
  app — except scripts, apps, installers, location files and extensionless files, which are only revealed, with a
  note. Argument lists only, never a shell, after a fresh lookup: a path deleted since the reply was drawn opens
  nothing and says so.
- **Only links the mod made are clickable this way.** A `file://` link written into the reply itself is left to Claude
  Code; the mod answers clicks only on links it created from a path it verified. Credentials in a remote URL
  (`https://user:token@…`) never reach a link.

## Terminals

- **Fullscreen renderer on macOS** (`/tui fullscreen`): everything above.
- **Apple Terminal:** a plain click also opens web links and the `↗` rows. Claude Code only opens links on a
  Cmd-click, and Apple Terminal hands Cmd-click to the app as a plain click, so without this nothing would open there.
  Claude Code does the same for Ghostty and Warp itself; other terminals keep their own link handling.
- **Classic renderer, Linux, Windows, the desktop app and VS Code:** the links are drawn, but clicks are the
  terminal's or the app's own; there is no Finder handling.

## Known limits

- **No hover underline on file and folder links.** Claude Code draws a hover underline on web links, not on `file://`
  links, and a mod cannot style a link's hover. Requested upstream (see `docs/upstream-feature-request.md`).
- **No modifier click.** "Plain click reveals, Cmd-click opens" is not possible: a mod never sees which modifier was
  held, and in Apple Terminal Cmd never reaches Claude Code at all. The `files` and `folders` settings choose the plain
  click's action instead.
- **No per-folder links.** Linking each folder of a path separately was tried and dropped: without a hover underline you
  cannot tell which part of a path a click would open.

## Develop

```sh
claude plugin validate .
claude plugin test .     # 61 tests
tsc -p .                 # after the engine has laid .claude-plugin/types/
claude --plugin-dir .    # try it in a session
```

## Credits

clickable-links is built from the work of these MIT-licensed projects. Their copyright notices are in `LICENSE`.

- **[babarot/claude-linkify](https://github.com/babarot/claude-linkify)** by babarot (commit `99f52f2`): URL and
  GitHub reference linking (`hooks/refs.ts`), its test suite, and the reference forms (`PR#`, `repo#`, the words that
  are no repository).
- **[pepperonas/path-links](https://github.com/pepperonas/path-links)** by Martin Pfeffer (commit `67a0e96`): path
  detection and the safe lookup that never stats a path from a reply (`hooks/paths.ts`, the lookup in
  `hooks/register.tsx`), and the pattern of its engine tests.
- **[kiankhooban/open-paths](https://github.com/kiankhooban/open-paths)** by Kian Khooban (commit `dad28e2`): drawing a
  reply row the way the engine does, and answering link clicks only in the fullscreen terminal.
- **[baselane-sh/mods](https://github.com/baselane-sh/mods)** by Baselane, LLC (commit `4522510`): GitHub and GitLab
  remotes (`hooks/forge.ts`), link safety (`hooks/urls.ts`), the markdown token linker (`hooks/marks.ts`), commit SHA
  links (`hooks/shas.ts`) and the link rows under tool output, from its `issue-links`, `sha-links` and `url-links` mods.
