# Changelog

## 0.1.2 — 2026-11-28

- Paths in your prompts are clickable: every existing path a prompt names (typed, or a handover's launch prompt
  such as `read ~/.local/state/…/handoff.md first`) is listed as a `↗ <path>` link row under it. A prompt is drawn
  as plain text, so the links go under it rather than into it; a `file://` link typed into the prompt is left alone.

## 0.1.1 — 2026-11-26

- Marketplace description and the 🖱️ mark (README title, GitHub About) for the haiggoh catalog. No code change.

## 0.1.0 — 2026-11-26

First release.

- Web URLs, file and folder paths, GitHub/GitLab `#123`/`PR#`/`MR#`/`repo#`/`owner/repo#` references and commit SHAs
  in Claude's replies become links; `↗` link rows under tool results (URLs) and `git` Bash calls (commit SHAs).
- Plain click on a file selects it in Finder, on a folder opens it (fullscreen renderer, macOS); `/clickable-links
  files reveal|open` and `folders open|reveal` choose the action.
- Apple Terminal: a plain click also opens web links and the `↗` rows (Claude Code opens links only on Cmd-click, which
  Apple Terminal never passes through).
- `/clickable-links` walks through the settings in AskUserQuestion dialogs; typed shortcuts and `/clickable-links help`.
- Paths are looked up by walking down from trusted local roots only, never stat-ed from reply text; clicks run `open`
  with argument lists after a fresh lookup, never launch anything (scripts, apps, installers and folders with an
  extension, which may be bundles, are only revealed), and only on links the mod itself created from a verified path.
- Built from babarot/claude-linkify, pepperonas/path-links, kiankhooban/open-paths and baselane-sh/mods (MIT); see
  README › Credits.
