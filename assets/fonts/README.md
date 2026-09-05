# Bundled fonts

## Why this is here

The constellation cards draw their RA/Dec grid labels into a PNG, and that text
is rendered by librsvg inside `sharp`. librsvg finds fonts through fontconfig —
that is, through whatever is **installed on the machine doing the rendering**.

A developer machine has hundreds of fonts. A bare Node host has none. The result
was cards that came out labelled locally and silently unlabelled in production:
the ruling still drew, because lines are paths, but every glyph resolved to
nothing.

So the font travels with the app. `src/server/cards/fonts.ts` writes a
fontconfig file at runtime pointing at **this directory and nothing else**, which
means every machine renders from the same single family — and local output is a
true rehearsal of the server's, which it previously was not.

Two consequences worth knowing:

- The family name in the file must match `CARD_FONT_FAMILY` in
  `src/server/cards/fonts.ts`. Replacing the font means changing both.
- The deployment has to carry this directory. `scripts/build-server.mjs` copies
  it into `.next/standalone` beside `catalog`, and
  `scripts/package-hostinger.mjs` lists the file as required so packaging fails
  loudly rather than shipping a build that quietly loses its labels. If it goes
  missing anyway, the cards are drawn with a bare grid and the admin says so.

## What is here

`RobotoMono-Regular.ttf` — Roboto Mono, from Google Fonts
(<https://fonts.google.com/specimen/Roboto+Mono>), upstream at
<https://github.com/googlefonts/robotomono>.

Licensed under the SIL Open Font License 1.1. The full licence is in `OFL.txt`
in this directory, as redistribution requires. Copyright 2015 The Roboto Mono
Project Authors.

A monospace face because the design system asks for one on every technical
label, coordinate and number, and these labels are coordinates.
