# Posted 2026-11-27 as anthropics/claude-code#112677 — https://github.com/anthropics/claude-code/issues/112677

Target: anthropics/claude-code issues. Title:

**[FEATURE] Mods: link hover for file:// links, modifier state on link presses, and Apple Terminal in the plain-click list**

## Context

I build a mod ([clickable-links](https://github.com/haiggoh/clickable-links)) that turns paths, URLs, `#123` refs and
commit SHAs in replies into links and answers plain clicks on them with `onLinkPress` (fullscreen renderer, macOS,
Claude Code 2.1.332). Three gaps can only be closed in Claude Code itself:

### 1. No hover underline on `file://` links

In a mod's own `<Markdown>` (and in the engine's), `https://` links get a hover underline; `file://` links get none.
`pressableLinks` is not the cause: web links in the same `pressableLinks` list keep their hover. A mod has no way to
style a link's hover (`MarkdownProps` has no hover prop; `TextHoverProps` needs a keyed Box or scope and applies to the
whole element, not one link). Without a hover cue, a reader cannot see what a file link would open.

**Ask:** draw the same hover underline on `file://` links as on `https://` links (or let `MarkdownProps` opt links
into hover styling).

### 2. Modifier state never reaches a mod

`PressedLink` is `{ href }` only, and per the `onLinkPress` doc "a ctrl, alt or terminal-kept cmd click opens it as
before", so a modifier click bypasses the mod entirely. A mod cannot offer "plain click = reveal in Finder, Cmd-click =
open the file", nor change a link's drawing while a modifier is held (no hover or key-state signal for Markdown links).

**Ask:** pass the modifiers the terminal reported (`shift`/`alt`/`ctrl`, and `meta` where known) on `PressedLink` /
`UiPressArgument`, and optionally deliver modifier clicks to `onLinkPress` when the mod lists the link in
`pressableLinks`.

### 3. Apple Terminal: no click opens a link

The fullscreen docs say Cmd-click opens links, and that "some macOS terminals forward Cmd+click to the running app …
In Ghostty, and in Warp on macOS, Claude Code detects this and lets a plain click on a link open it." Apple Terminal
(`TERM_PROGRAM=Apple_Terminal`) behaves the same way — Cmd-click arrives as a plain click — but is not detected, so in
Apple Terminal **no click opens a link** in a reply. Verified by hand on Apple Terminal 488.9 / macOS 27.2.

**Ask:** add Apple Terminal to the plain-click-opens list.

### Repro (gap 3)

1. Apple Terminal, `claude` with `/tui fullscreen`.
2. Ask for a reply containing `https://example.com`.
3. Plain click on the URL: nothing opens. (Observed: Cmd-click on a link a mod answers runs the mod's plain-click
   handler — Cmd arrives as a plain click, exactly as the docs describe for Ghostty/Warp.)
