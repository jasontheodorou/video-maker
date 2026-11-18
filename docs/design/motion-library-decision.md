# Decision draft: a closed motion library (extends dec-002)

Status: draft for the owner to file in the decision log (`.vellum/` is off limits to the build).
Date: 18 November 2026.

## Context

dec-002 fixed one house motion: 60 fps, transform and opacity only, no bounce or overshoot, rises of 24 px at most, text never on photos, photos pan instead of zoom, and every fade starting at `RASTER_FLOOR_OPACITY` so settled text never shimmers. Clients asked for more character: animations, transitions and text effects that are "simple, restrained but effective".

## Decision

A small, closed library of named presets. People and the brief interpreter choose names; the engine owns every duration, distance and curve.

- **Styles** (brand default, or per video): Calm (exactly the old house motion), Crisp, Lively, Still.
- **Entrances** (per scene): Rise, Fade, Slide (32 px from the reading side), Reveal (a block rising into view inside a mask), Settle (scale 0.96 to 1, never on body text).
- **Transitions** (into a scene): Cut, Crossfade, Wipe, Push, Colour sweep (a layer in the next scheme's colour).
- **Text effects** (one per scene): Word by word (12 words at most), Underline (bars draw under the key words), Highlight fade (key words turn to their colour), Count up (digit columns roll; a stat's single number only).
- **Shape motion** (icon circles): Grow (0.94 to 1), Drift (±6 px, linear).

One resolver (`resolveMotion` in `engine/motion-plan.ts`) feeds timing, the compiler, the contact sheet, lint and the checking scripts, so they always agree. Automatic choices never fail: a refused combination is made calmer and noted. Only a scene's own choice can fail lint.

## Rules added to dec-002

- Text is fully settled for at least 75% of its time on screen and for its reading time; timing lengthens the scene first.
- Slides at most 40 px; scale only within 0.94 to 1; all offsets whole pixels per format.
- Transition edges at most 212 px a frame at 60 fps (the house wipe peaks at 211). Push and sweep use an even ease-in-out, `cubic-bezier(0.65, 0, 0.35, 1)`.
- Next to photos or video: crossfade or cut only.
- No cut between two scenes with the same scheme. At most one colour sweep in any three transitions.
- Sideways moves (slides, drift) get no compositor layer. Measured on 18 November 2026: list items sliding in on a layer were rastered differently by different render workers, so settled text changed by 1 to 3 levels in about 0.3% of pixels every few frames. Painted in place, every worker draws the same pixels (the same reason photos pan without a layer).
- Count up is transform only: digit strips move by whole line heights measured in the page, with no text rewritten by callbacks, so parallel workers draw identical frames.

## Consequences

- Calm brands and every existing video are unchanged (same timelines, same animation arrays; checked on the demo jobs).
- The library is closed on purpose. A new preset needs an engine change, a rule in `engine/motion-rules.ts`, windows in `scripts/motion-schedule.ts`, and a clean `motion-check --lossless` at 60 fps in all three formats.
- Deferred: per-line text reveal (needs line measurement in the compiler), brand-level allow lists.
