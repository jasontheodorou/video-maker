# Engine contracts

This page is the reference for everyone building on the video engine: the web app, the brief interpreter, and anyone adding scenes or icons. If code and this page disagree, the Zod schemas in `engine/` win, and this page should be fixed.

The rule behind everything: the brief interpreter (or Claude) writes only a small JSON spec. The engine owns every colour, font, size, duration, easing, transition and crop. The compiler (`engine/compile.ts`) is the only code that writes HTML.

## Contents

1. Folder layout
2. The spec (`spec.json`)
3. Scene types and how to add one
4. Icons
5. The brand pack (`brand.json`)
6. Engine settings (`config/engine.json`)
7. Jobs and the pipeline commands
8. Programmatic API (for the web server)
9. Quality rules the engine enforces
10. Measurements

## 1. Folder layout

```
config/engine.json         every timing, target length, format and safe area
config/fps-measurement.json the render-speed measurement that chose 60 fps
engine/                    the engine (TypeScript, run with tsx)
  api.ts, index.ts         programmatic API for the web server
  schema.ts                Zod rules for brand, facts, decision, timeline
  spec.ts                  Zod rules for the spec, built from the scene registry
  motion.ts                the closed set of motion values
  transitions.ts           which transition each cut gets (crossfade or wipe), and the wipe's CSS
  media.ts                 photos and clips from brands/<id>/media: checks, crops, clip frame-rate conforming
  brand.ts, contrast.ts    brand loader, AAA contrast checks, brand tokens as CSS
  logocheck.ts             can the logo be seen on its background (draws it with resvg, 3 to 1 non-text contrast)
  compile.ts               spec + timeline + brand -> HyperFrames HTML (one page per format)
  scenes/                  scene registry (index.ts) and one file per scene type
  icons/                   icon library: Phosphor 2.1.1 (MIT), <weight>/<name>.svg, index.json, search; see section 4
  icons.ts                 icon resolver used by the compiler (brand icons first, then the library)
  brand/                   brand module: create, update, files, fonts, contrast, import, guidelines; see section 8
  size.ts voice.ts align.ts timing.ts captions.ts lint.ts sheet.ts render.ts pipeline.ts
brands/<id>/               one folder per brand: brand.json, fonts/, logo/, icons/, graphics/, media/ (photos, clips, assets.json), guidelines/, guidelines.md
jobs/<name>/               one folder per video; see section 7
scripts/                   command-line entry points (npm run ...)
.cache/                    voice, alignment and conformed-clip caches (safe to delete)
```

`brands/`, `jobs/` and `.cache/` live in the project folder unless `DATA_DIR` is set, in which case they live in that folder instead (for example a mounted disk on a server). A new `DATA_DIR` is seeded with `brands/demo` on first use. `engine/paths.ts` is the only place these folders are worked out. Hosting (Docker, sign-in with `APP_PASSWORD`, `/healthz`) is described in `docs/DEPLOY.md`.

## 2. The spec

The spec is the only thing written per video. It says what to show and say, never how it looks.

```json
{
  "version": 1,
  "brand": "demo",
  "title": "Garden waste collections are changing",
  "facts": { "keyMessages": 1, "purpose": "inform", "channel": "social", "audience": "Residents with a brown bin" },
  "scenes": [
    {
      "type": "title",
      "beat": "hook",
      "slots": { "eyebrow": "Waste and recycling", "title": "Garden waste collections are changing", "emphasis": ["changing"] },
      "voiceover": ["Garden waste collections in Northvale are changing."]
    },
    {
      "type": "statement",
      "beat": "message",
      "slots": {
        "kicker": "From 3 March",
        "text": "We will collect your brown bin every two weeks",
        "support": "On the same day as your recycling",
        "icon": { "icon": "calendar" },
        "emphasis": ["every two weeks"]
      },
      "voiceover": ["From 3 March, we will collect your brown bin every two weeks.", "It will be on the same day as your recycling."]
    },
    {
      "type": "end",
      "beat": "action",
      "slots": { "action": "Check your new collection day", "link": "northvale.example/bins", "detail": "Or call 0300 555 0199" },
      "voiceover": ["Check your new collection day at northvale.example/bins."]
    }
  ]
}
```

### Fields

| Field | Required | Rules |
| --- | --- | --- |
| `version` | yes | Always `1`. |
| `brand` | yes | A folder name in `brands/`. Every job names its brand. |
| `title` | yes | Up to 120 characters. Used for the job folder name and file titles. |
| `facts` | yes | Used only to choose the size. See below. |
| `scenes` | yes | 2 to 16 scenes. The first must be `title`, the last must be `end`, each only once. |
| `voice` | no | A Kokoro voice id to override the brand's voice. |
| `formats` | no | Any of `16x9`, `9x16`, `1x1`. Default: all three. |
| `language` | no | Only `en-GB` for now. |

Each scene:

| Field | Rules |
| --- | --- |
| `type` | A scene type from the registry (section 3). Unknown types are rejected. |
| `id` | Optional. Lower-case letters, numbers, hyphens. Default `s1`, `s2` and so on. |
| `beat` | One of `hook`, `problem`, `message`, `insight`, `proof`, `summary`, `action`. |
| `slots` | The scene's content. Each scene type has its own strict slots. |
| `voiceover` | 1 to 4 phrases, each up to 220 characters, one line each. Each phrase is spoken as one audio file and captioned word for word. |

`emphasis` (in slots that allow it) lists up to 3 exact phrases from the main text to show in the surface's accent colour. Each must appear in the text exactly, or the spec is rejected.

On-screen text is plain text. HTML, `<`, `>` and line breaks are rejected. Write dates as 3 March, phone numbers in full and web addresses without `https://`. The voice step says them naturally ("the 3rd of March", digit by digit, "dot"); captions show them as written.

### Facts

| Fact | Values |
| --- | --- |
| `keyMessages` | 1 to 8 |
| `purpose` | `announce`, `inform`, `explain`, `remind`, `recruit`, `consult`, `celebrate`, `warn` |
| `channel` | `social`, `website`, `email`, `screens`, `presentation`, `internal` |
| `steps` | optional, 0 to 12: steps the viewer must follow |
| `audience` | optional, free text up to 200 characters |
| `requestedSize` | optional, `short`, `medium` or `long`. Set only when the brief explicitly asks for a length ("a 60-second video", "keep it short"). It overrides the rule table and the channel caps, and `decision.json` says so. |
| `requestedSeconds` | optional, 5 to 600. Set only when the brief gives the length as a number ("around a minute and a half" is 90). For a limit ("under 20 seconds") it is a little under, such as 18. It wins over `requestedSize`: the size is the one whose range holds it, or the nearest (`sizeForSeconds` in `size.ts`). The brief interpreter sets its word target from it, and `decision.json` records it as `requestedSeconds` with a reason. The word budget and the size's range still apply, so a long video stays at most 90 seconds. |

The engine, not the spec, picks short, medium or long from these facts using the rule table in `config/engine.json` (`sizeRules`, then `channelCaps`). Since 6 November 2026: 4 or more steps, or 5 or more key messages, make a long video; 2 to 4 key messages make a medium one (4 short points had padded long videos with slow holds and repeats). The decision and its reasons are written to `decision.json`. Default targets: short 15 to 25 s, medium 30 to 50 s, long 60 to 90 s. The script must fit the word budget: max seconds x 2.6 words a second x 0.9 (short: 58 words, medium: 117, long: 210).

Suggested beats per size: short `hook, message, action`; medium `hook, problem, insight, proof, action`; long `hook, problem, insight, proof, insight, proof, summary, action`. Missing beats are warnings, not errors.

To get the spec's JSON Schema (for structured output): `specJsonSchema()` from the API.

## 3. Scene types

The registry is `engine/scenes/index.ts`. It is a closed list: a spec can only use types listed there. New scene types are engine releases, never something written during a job.

| Type | Label | Surface | Slots (max characters) | Beats |
| --- | --- | --- | --- | --- |
| `title` | Title | dark | `title` (42, required), `eyebrow` (40), `subtitle` (70), `emphasis` | hook |
| `statement` | Statement | light | `text` (88, required), `kicker` (30), `support` (64), `icon`, `emphasis` | message, problem, insight, proof, summary |
| `points` | Points | light | `heading` (48, required), `items` (2 to 4, each `{ text (40, or 24 when there are 4 items), icon? }`: every item has an icon or none does), `kicker` (28), `emphasis` | message, problem, insight, proof, summary, action |
| `stat` | Stat | tint | `value` (8, required, must contain a digit, such as `93%` or `1 in 4`), `label` (64, required), `kicker` (28), `source` (70) | proof, insight, problem, message, summary |
| `quote` | Quote | tint | `quote` (104, required, no quotation marks: the engine draws them), `name` (36, required), `role` (50), `emphasis` | proof, insight, problem, summary |
| `photo` | Full photo | dark | `photo` (required, see Media), `text` (48), `emphasis` | hook, problem, message, insight, proof, summary |
| `photo-text` | Photo with text | light | `photo` (required), `heading` (42, required), `text` (90), `emphasis` | problem, message, insight, proof, summary |
| `icons` | Icon row | light | `items` (2 to 4, each `{ icon (required), label (26, or 22 when there are 4 items) }`), `heading` (48), `emphasis` | message, insight, proof, summary, action |
| `video` | Video clip | dark | `clip` (required, see Media), `text` (48), `emphasis` | hook, problem, message, insight, proof, summary |
| `end` | End card | dark | `action` (54, required), `link` (30), `detail` (52), `emphasis` | action |

The schemas in `engine/scenes/*.ts` are the source of truth for these numbers.

#### How the limits are set, and what they promise

The character limits are measured, not guessed. `npx tsx scripts/limits-check.ts --calibrate` finds, for each text part, the longest realistic text that fits every format with the real brand fonts while the scene's other parts hold their sample content (optional parts included). The limits above come from that run (5 November 2026, demo brand). List items have a second, lower limit when the list has 4 items (`maxCharsWhenFull` in the scene's `text` list), checked by the schema.

What the limits promise: one part at its limit, next to typical text in the other parts, fits. They cannot promise that every part at its limit at once fits, or that a single very long word fits a narrow column. So the engine also measures the real text early:

- before the voice is recorded (`stepPreflight` in `pipeline.ts`), so a script that does not fit fails in seconds;
- when a person saves an edited script in the web app (the server returns each problem with its scene and part, and the editor shows it next to that box);
- in the brief interpreter, which sends problems back to the model;
- at lint, which also checks captions.

Every message names the part to shorten, for example "Scene 3 (Statement): together, the text is too tall for the square video. Shorten the main text, the supporting line or the small heading." Run `npx tsx scripts/limits-check.ts` (no flags) after changing a layout or the brand's type scale: it reports what no longer fits. Re-run `--calibrate` after changing a layout, and update the limits here and in the scene file.

Line limits per format are in each scene's `text` list. They are checked with the real font in Chrome by the lint step. Text that does not fit fails; the engine never shrinks text to make it fit. Some layouts use a fixed, smaller size in one format by design (the square quote and the square photo-with-text heading); that is a layout choice, never shrink-to-fit, and never below 42 px.

How each scene lays out:

- **Points**: heading over a list. Items with icons show the icon in a tint circle; items without show a small square marker. Landscape keeps the list to 1,400 px wide.
- **Stat**: a very large value (2 times the display size in landscape, 1.25 in portrait, 1.6 in square) in the surface accent, then the label in heading type, then the source in label type.
- **Quote**: an original vector quotation mark beside the quote in landscape, above it in portrait and square. Name in bold, role below.
- **Full photo**: the photo fills the frame; text, if any, sits on a solid panel in the dark surface colour. The panel goes to the side and edge away from where the photo's focal point falls (top when the subject is low, because captions sit at the bottom; right when the subject is on the left in landscape), and the crop then moves the focal point towards the opposite third as far as the photo allows (`panelComposition` in `photo.ts`). In portrait and square the panel goes to the top unless the subject is in the top 45% of the frame, because people extend below their focus point (legs, a dog); in square the aim is about a quarter of the way down under a bottom panel and 63% down under a top one. In landscape the panel is at most 1,000 px wide so it can sit to one side. Text is never placed straight on a photo.
- **Photo with text**: the photo fills the right 44% of a landscape frame, or a band across the top of portrait (28% of the height) and square (30%). Text sits on the light surface, never on the photo.
- **Icon row**: a row in landscape (labels up to 3 lines); a list in portrait; in square, two side by side, or a list for three or four.
- **Statement**: in portrait and square the icon sits beside the bar and small heading, not above everything, so the main text keeps its room. In square the main text is drawn at 0.9 of the heading size and the icon circle is 104 px (layout choices, never shrink-to-fit), so an ordinary message with a small heading, an icon and a supporting line fits.
- **Quote** (square): the quotation mark is 72 px and the name sits closer to the quote, for the same reason.
- **Title**: landscape uses the full content width. The title is drawn at 0.9 of the display size in portrait and 0.85 in square (both layout choices, never shrink-to-fit).
- **Video clip**: the clip fills the frame when that does not enlarge it more than 15%, with text on a solid panel placed away from the clip's focal point, as for Full photo. Otherwise (a landscape clip in portrait) it sits in a box across the top, 40% to 50% of the height, with the text below on the dark surface.

Every text element and number also keeps phone numbers (`0300 555 0199`), dates (`3 March 2027`), `1 in 4`, amounts of money and hyphenated words such as `Whitfield-Brown` on one line (`keepTogether` in `scenes/common.ts`, applied by the compiler to `ctx.esc` and `ctx.rich`).

`sceneCatalogue()` (API) returns every type with its description, slots, limits, sample content and whether it shows media.

### Media (photos and clips)

Photos and clips live in the brand's media folder: `brands/<id>/media/`. A spec names a file there:

```json
{ "photo": { "src": "park-trail.jpg", "focus": [0.16, 0.72] } }
{ "clip": { "src": "river-canyon.mp4", "start": 1, "focus": [0.5, 0.6] } }
```

| Field | Rules |
| --- | --- |
| `src` | A file in `brands/<id>/media/` (subfolders allowed). Photos: JPEG, PNG or WebP. Clips: MP4, MOV, M4V or WebM. |
| `focus` | Optional `[x, y]`, 0 to 1 from the top left: the point to keep in view when cropping. Default: the file's entry in `assets.json`, then the centre. |
| `start` | Clips only. Seconds into the clip to start from. Default 0. |

`brands/<id>/media/assets.json` is optional. It records per file `description`, `focus`, `licence`, `author`, `source` and `consent`:

```json
{ "files": { "park-trail.jpg": { "description": "People walking a dog by the water", "focus": [0.16, 0.72], "licence": "CC0 1.0", "author": "D Coetzee", "source": "https://..." } } }
```

`listMedia(brand)` (in `engine/media.ts`) lists a brand's photos and clips with their entries, for the web app and the brief interpreter.

What the engine checks and does (compile and lint report these; errors stop the render):

- A missing file, or one of the wrong type, is an error.
- Crops are computed exactly: the media covers its box, with the focal point as near the middle as the crop allows.
- Large photos are resized once per format (Lanczos, cached in `.cache/media/`) to just cover the frame at the drift scale. Chrome then draws each photo at almost exactly its own size. Without this, a large photo shrunk on the GPU was sometimes sampled slightly differently by one render worker (up to 3 levels on a few pixels), which broke frame-for-frame repeatability once encoded.
- Enlargement: a photo or clip shown above 115% of its real pixels is a warning ("may look a little soft"); above 160% it is an error. Photos allow for the 4% drift. For a full-frame 1080p photo, 2,000 px wide is plenty.
- Clips are muted. A clip must have at least as many seconds after its start point as its scene lasts, or it is an error.
- Clip frame rate: a clip whose frame rate does not divide evenly into the video's (for example 24, 25 or 50 at 60 fps) would judder. The engine makes a conformed copy once, cached in `.cache/media/`: every source frame kept, retimed to 30 or 60 frames a second, so a 25 fps clip plays 20% faster. This is reported as a warning.
- In stills (previews, lint, contact sheets) a clip shows a still frame from its start point.
- Renders extract clip frames as PNG (`--video-frame-format png` in `render.ts`). With JPEG frames, two renders of the same spec differed by up to 3 levels in a few frames where a clip was visible.

### Transitions

The engine picks the transition for each cut; a spec never chooses (`engine/transitions.ts`). Both use the house curve. A crossfade lasts `timing.crossfade` (0.5 s); a wipe lasts `timing.wipe` (0.8 s), because with an ease-out curve a full-width edge moves too fast in 0.5 s (about 330 px a frame at its fastest; 0.8 s brings that to about 210 px, inside a 576 px soft edge). The next scene starts one transition length before the last one ends, and the reading-time rule counts text as covered from that moment.

| Transition | When | How |
| --- | --- | --- |
| `crossfade` | Every cut by default: into or out of a photo or video scene, between scenes on the same kind of surface, and between dark and light text scenes | The next scene fades in over the last one. Opacity only. |
| `wipe` | Only when `timing.darkLightTransition` is `"wipe"`: between two text scenes of different brightness (dark and light or tint) | The next scene is revealed from left to right behind a wide soft edge (30% of the frame width). Nothing on screen moves: a masked wrapper slides in while the scene inside it slides the same distance back. Transform only. |

The default for dark and light cuts is `"crossfade"` (6 November 2026), as the motion rules ask. The wipe is kept as an option: it is smooth, but its visible edge crosses the frame in about 0.28 s (up to 209 px a frame), which reads as fast. The owner to confirm which they prefer.

`timeline.json` records each scene's `transitionIn` (`none`, `crossfade` or `wipe`) and `transitionSeconds`.

### How to add a scene

1. Create `engine/scenes/<name>.ts` that exports a `SceneDefinition` (see `engine/scenes/types.ts`). Copy `statement.ts` as a start, or `photo.ts` for a scene with a photo.
2. Add it to `SCENES` in `engine/scenes/index.ts`. That is the only registration step. The spec schema, the catalogue, previews and lint pick it up automatically.
3. Add a row to the table above.

A scene definition has:

| Part | Contract |
| --- | --- |
| `type` | Lower-case name used in specs. |
| `label`, `description` | Shown to people and to the brief interpreter. Say when to use it. |
| `beats` | Story beats it suits. |
| `surface` | `dark`, `light` or `tint`. The scene never picks colours itself. |
| `media` | Optional. True when the scene shows a photo or video. It then always crossfades. |
| `slots` | A strict Zod object. Use `textField(max)` from `scenes/common.ts` for text, `listField(item)` for 2 to 4 items, `IconRef` for icons, `PhotoRef` and `ClipRef` (from `media.ts`) for media, `emphasisField` plus `checkEmphasis` for emphasis. |
| `text` | For every text slot: `maxChars` and `maxLines` for each of `16x9`, `9x16`, `1x1`. List items share one entry (`items`), and the line limit applies to each item. A list may add `maxCharsWhenFull`, the lower limit with 4 items (enforce it in the slots schema with `checkFullList`). Set `maxChars` with `scripts/limits-check.ts --calibrate`. |
| `sample` | Realistic, brand-neutral sample slots. Used for brand previews. |
| `elements(slots)` | The elements that animate in, in entrance order (this order sets the 60 ms stagger). Each has an `id`, an `entrance` from `motion.ts`, and `slot` if it shows a text slot (that is how the reading-time rule finds it). For one item of a list, also give `text` (the item's words), because the slot is not a plain string. |
| `markup(ctx)` | HTML for the scene, the same in every format. Element ids are `${ctx.sceneId}-<element id>`. Text elements carry `class="anim"` and `data-fit="<slot>"`. Use `ctx.esc()` for text, `ctx.rich(text, emphasis)` for text with emphasis, `ctx.icon(ref)` for icons, `ctx.logo("onDark" or "onLight")` for the logo, `ctx.photo(ref)` and `ctx.clip(ref)` for media (each returns the resolved file with its size and focal point, or null after recording an error). `ctx.still` is true in previews and checks. Wrap content in `<div class="content">`, which the compiler places inside the safe area, above the caption band. Photos may sit outside `.content` (full bleed); give their `<img>` the class `drift` for the slow drift (`photoMarkup()` does this). |
| `layouts` | One hand-designed function per format (`16x9`, `9x16`, `1x1`) returning CSS scoped to `#${ctx.sceneId}`. Use `photoCss(ctx, media, box, name)` to crop a photo to its box; it also reports soft photos through `ctx.issue()`. A layout may move `.content` down (for example below a photo band); lint still checks against the full content area. |
| `clip(slots)`, `clipLayout(ctx)` | Video scenes only. The clip to play and where it sits: `{ rect, above }`. The compiler places the clip as a top-level timed `<video>` (HyperFrames only times video at the top level), under the see-through scene (`above: false`) or over the scene's background (`above: true`), and fades it with the scene. |

Rules for layout CSS (the compiler rejects a scene that breaks them):

- Colours only as `var(--...)` tokens: `--dark-bg`, `--dark-text`, `--dark-accent` (and `light-`, `tint-`), `--c-<colour name>`, `--caption-bg`, `--caption-text`. `transparent` and `currentColor` are fine.
- Fonts and sizes only through the type classes `t-display`, `t-heading`, `t-body`, `t-label`, or `var(--t-...)` (also as `calc(var(--t-...) * n)`), `var(--font-heading)`, `var(--font-body)`, `var(--weight-heading)`, `var(--weight-body)`.
- Spacing from `var(--sp-1)` to `var(--sp-16)` (multiples of the brand's unit), corners from `var(--radius)`, logo height from `var(--logo-h)`. Fixed pixel widths for layout boxes are fine.
- No CSS transitions or animations. Motion comes only from `elements()` and `motion.ts`.
- Keep text inside `.content`. Lint fails anything outside the safe area or overlapping the caption band.
- Never put text straight on a photo or video. Use the solid panel (`panelMarkup`, `panelCss` in `photo.ts`) or keep text off the picture.

### Motion

Values (`engine/motion.ts`):

- Curve `cubic-bezier(0.2, 0.8, 0.2, 1)`. Stagger 0.06 s.
- Entrances: `rise` (0.6 s, 18 px), `riseLarge` (0.8 s, 24 px), `riseSmall` (0.4 s, 12 px), `fade` (0.6 s), `fadeLong` (0.8 s). Rises scale with the format's type multiplier, are capped at 24 px and are rounded to whole pixels.
- Entrances start at opacity 0.002, not 0 (`RASTER_FLOOR_OPACITY`). This is invisible (under half of one 8-bit level), but it makes Chrome draw each text layer once at its whole-pixel start position. At 0, each parallel render worker drew it first at a different mid-movement position, so settled text shimmered by a fraction of a pixel from frame to frame.
- Transitions: `crossfade` (0.5 s), and `wipe` (0.8 s) only when configured (see Transitions).
- Photos: held 4% larger than their box and drifted sideways at an even speed over the whole scene, by a quarter of the spare width each way (about 19 px either side of centre on a full 16:9 frame). A pan, not a push-in: a slowly scaling photo is drawn unevenly by Chrome (measured), a pan moves the same amount every frame.
- Captions: a run of chunks (speech with no clear pause) fades in at its start and out at its end over 0.15 s (opacity only); inside a run, one chunk replaces the next in place with no gap, so a caption never blinks off and on. A thin line in the caption highlight colour shows under the word being spoken, fading in and out over 0.08 s and stepping straight to the next word when speech is continuous. The highlight colour is the first brand colour with 3 to 1 contrast against the caption box (non-text contrast): the dark surface accent, the accent, the light surface accent, the primary, then the caption text colour. Caption text itself never changes colour.
- Only opacity and transform are animated. Nothing bounces or overshoots.

After adding a scene: `npm run selftest`, then preview it with `previewBrand(..., { scenes: ["<type>"] })` and check all three formats by eye. Before a release, render the gallery (`npm run make -- jobs/gallery`) and run `npx tsx scripts/motion-check.ts jobs/gallery --lossless`.

### Captions and word timings

- Chunks: at most 6 words and 40 characters (`captions.maxWords`, `captions.maxChars`), so a chunk fits two lines in portrait. The chunker also measures each chunk with the brand's real caption font (`captionFitter` in `engine/captionfit.ts`, fontkit, words never broken, 3% margin) in every format of the spec, and splits a chunk that would need a third line. This matters for web addresses, which cannot break: "Visit northvale.example/summer for more." is 40 characters but 3 lines in portrait, so it becomes "Visit northvale.example/summer | for more.". `computeTimeline(..., { captionFits })` takes the test; the pipeline and the brief interpreter pass it. Without it, only the word and character limits apply. Breaks prefer punctuation and natural pauses, and avoid splitting names ("Direct Debit"), dates, numbers with their units and short noun phrases ("a council tax payment", "a free food caddy"). A chunk never ends on "the", "a" or "your" if it can be helped, nor splits "next to" or "need to". A clause may take one more chunk than the fewest possible when that avoids a bad break.
- Time on screen: every chunk is fully visible (after its fade in, before its fade out) for at least `captions.minSeconds` (1 s). When speech is quick, `fitCues` in `captions.ts` moves the chunk edges as little as possible to make room (a weighted least-squares fit, solved exactly). In the demo jobs no chunk moves more than 0.4 s from its words; lint warns above `captions.maxShift` (0.6 s). Gaps shorter than `captions.closeGap` (0.35 s) are closed.
- Decision: captions are paced to speech, not to the on-screen reading rule (`max(1.8, words / 2.5 + 0.8)`), which applies to scene text. A caption shows while its words are spoken, and the full words stay in the scene text and the .srt.
- Word timings (`align.ts`): whisper's time for a word is used only when it is believable: inside the audio, in order, not overlapping the next word, and not much longer than the word takes to say (from its spoken syllables). Whisper sometimes hears a long web address as one word lasting most of the phrase, which would push every later caption to the end. Words without believable times are timed from the real pauses in the recording (35 dB below the speech, at least 0.12 s), sharing the speaking time by syllables, with each clear pause given to the nearest word boundary (a comma or full stop is preferred). `matchedShare` counts only believable whisper times. Lint warns (`word-timing`) if any word is still stretched or squeezed.
- No word runs across a clear pause. Whisper sometimes gives believable but early times around a web address or phone number, so one word spans a real silence and its caption changes while earlier words are still spoken. Every pause of at least `CLEAR_PAUSE` (0.25 s) must fall between two words; when one does not, the few words around it are timed again from the recording, with the pause given to the nearest boundary (a comma or full stop preferred). Lint warns if a word still runs across a pause.

## 4. Icons

### The library

`engine/icons/` holds Phosphor Icons 2.1.1 (MIT licence, `engine/icons/LICENSE-phosphor.txt`): 1,512 icons in six weights, 9,072 SVG files. Videos use this one family only. Client icons replace library icons by name, but no other icon family is added.

```
engine/icons/
  index.json               every icon: name, alias (old name), weights, tags, categories, brandLogo
  thin/ light/ regular/ bold/ fill/ duotone/   <name>.svg, 256 x 256 viewBox, fill="currentColor"
  library.ts               searchIcons, checkIconName, suggestIconNames, iconInfo, colourIconSvg
  synonyms.ts              meanings for search ("money", "growth", "council tax"); add freely
  sheets/                  icon sheets made by npm run icons-sheet
```

`npm run icons-ingest` rebuilds the folder from the pinned npm package (downloaded with `npm pack`, not installed). Run it only to change the version on purpose. Company logos (Phosphor's "brands" category, such as social media logos) are in the library but left out of search.

### In a spec

A spec reserves an icon with an icon slot:

```json
{ "icon": "calendar", "weight": "regular" }
```

`weight` is optional (`thin`, `light`, `regular`, `bold`, `fill`, `duotone`). Leave it out: it defaults to the brand's `icons.weight`. Names are lower-case with hyphens. Old Phosphor names (aliases) still work.

`validateSpec` checks every icon name against the brand's client icons and the library, and rejects unknown names with a suggestion: `There is no icon called "calender". Did you mean "calendar", "cylinder"?`

### Finding icons by meaning

```ts
searchIcons("money", { limit?, weight?, category?, brand?, includeBrandLogos? })
// -> [{ name: "money", score, source: "library", weights, matched }, { name: "coins" ... }, { name: "currency-gbp" ... }]
```

Search uses icon names, Phosphor's tags and categories, British spellings (colour, centre, organisation), plain stems (bins, recycling) and a list of meanings for public sector topics in `synonyms.ts` (money, growth, security, team, council tax, bin collection, mental health and about 120 more). With `brand`, client icons are searched too and rank first. "Off" variants such as `wifi-x` rank low unless the query says "no" or "not". `iconBriefing(brandId)` gives the brief interpreter the default weight, the client icon names and how to search.

### How icons are resolved and coloured

The engine looks for the file in this order and uses the first it finds:

1. `brands/<id>/icons/<name>-<weight>.svg` (client icon at that weight)
2. `brands/<id>/icons/<name>.svg` (client icon; overrides the library icon of the same name)
3. `engine/icons/<weight>/<name>.svg` (library icon at that weight)
4. `engine/icons/<name>.svg` (library icon with one weight)

Icons draw with `currentColor`, so the scene's CSS colour (a surface token such as `var(--light-accent)`) sets their colour. Duotone icons have a light layer marked `data-layer="secondary"` in the library file; the resolver gives it the brand's `icons.duotoneOpacity` (default 0.2), and the colour token `icons.duotoneColour` if the brand names one (otherwise the icon's own colour). The engine strips scripts, event handlers, external links and fixed width and height, then inlines the SVG. A missing icon is a compile error with the same "did you mean" message, never a silent gap.

- `resolveIcon(ref, brand)` (engine/icons.ts): the compiler's resolver. Returns `{ name, weight, file, source, svg }` or null.
- `renderIcon(ref, brand, { colour?, size? })`: a standalone SVG with colour values written in, for previews, the web app and icon sheets. `colour` is a colour token name.
- `listIcons(brand)`: every icon a brand can use (client and library).

Client icons uploaded through the brand module are cleaned and, if they use one colour, that colour becomes `currentColor` so they take brand colours. Icons with several colours keep them, with a warning.

## 5. The brand pack

A brand is a folder `brands/<id>/` with `brand.json` and its files. Every path in `brand.json` is relative to the folder. Adding or changing a folder changes the look with no code changes.

```
brands/demo/
  brand.json
  guidelines.md            for people (optional)
  fonts/*.woff2            font files (WOFF2, WOFF, TTF or OTF)
  logo/*.svg               logos (SVG preferred, PNG accepted)
  icons/*.svg              client icons (override the library by name)
  graphics/                client graphics, available to scenes that use them
  guidelines/              uploaded guideline documents (PDF, Markdown, text), for people
```

`brand.json` fields (see `BrandSchema` in `engine/schema.ts` for exact limits):

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Always `1`. |
| `id`, `name` | Folder name and display name. |
| `fictional` | True for sample brands. |
| `provisional` | Token groups still to be confirmed, such as `["colours", "logo"]`. Shown as warnings. |
| `colours` | `primary`, `text`, `background`, `accent`, `tint` required; `accent2`, `line` optional. Each `{ "value": "#RRGGBB", "name": "Vale Blue" }`. |
| `surfaces` | `dark`, `light`, `tint`, each `{ background, text, accent }` naming colour tokens. Scenes use surfaces, never colours. |
| `fonts` | `heading` and `body` (`{ family, weight }`) and `faces`: one entry per file `{ family, weight, style, src, unicodeRange? }`. |
| `typeScale` | `display`, `heading`, `body`, `label`, `caption` in px for 1920 x 1080. Body, label and caption at least 42. |
| `lineHeight` | `display`, `heading`, `body`. |
| `letterSpacing` | `display`, `heading` in em (optional). |
| `spacing.unit` | Base spacing in px (4 to 16). |
| `radius` | Corner radius in px. |
| `logo` | `onLight`, `onDark` (file paths), `alt`, `minHeight` (px at 1080p). |
| `icons` | `weight` (default icon weight, default `regular`), `dir` (default `icons`), `duotoneOpacity` (0.1 to 0.6, default 0.2), `duotoneColour` (optional colour token for the light layer of duotone icons). |
| `graphics` | `dir` (default `graphics`). |
| `captions` | `background`, `text` (colour token names), `weight`. |
| `voice` | `id` (Kokoro voice), `speed` (0.8 to 1.2), `lang` (optional, such as `en-gb`). |
| `toneOfVoice` | Free text the brief interpreter reads. |
| `guidelines` | Free text (Markdown) the brief interpreter reads. |
| `guidelinesFile` | Optional longer guidelines file in the folder, for people. |
| `rules` | `{ "do": [...], "dont": [...] }`, read by the brief interpreter. |

Checks (from `loadBrand`, `validateBrand` and `npm run doctor`). Errors stop rendering; warnings do not:

- AAA contrast (7 to 1) for every pairing the engine can draw: each surface's text and accent on its background, and caption text on the caption box. Failing messages name the colours, the ratio and a suggested passing colour.
- A pair that passes but under `AAA_SAFE` (7.5 to 1) is a warning: players show video colours slightly differently (Chrome on a Mac showed the demo blue lighter, taking yellow on blue from 8.39 to 7.73 to 1).
- Videos show the dark-background logo (Title, End card). When `logo.onDark` is still the placeholder wordmark but `logo.onLight` is a real logo, a warning says the uploaded logo does not appear in videos.
- The dark-background logo must be seen on the dark surface: drawn with resvg, at least 30% of its pixels need 3 to 1 non-text contrast with the background, or it is an error that points to a white or reversed logo; under 60% is a warning. The light-background logo gets warnings only (it is not used in videos yet).
- Highlighted words must stand out from the text around them: a surface's accent and text colours must differ by at least 20 in CIE Lab (`colourDifference`, `MIN_HIGHLIGHT_DIFFERENCE` in `contrast.ts`). Closer is a warning. `proposeSurfaces` only picks highlight colours that pass both rules, and says so when no brand colour can.
- Every colour a surface, the captions or `icons.duotoneColour` names exists.
- Font files exist and are font files; the heading weight, body weight and caption weight each have a file.
- Logo files exist and are SVG or PNG (PNG gives a warning).
- Body and caption sizes stay at or above 42 px in every format, and two caption lines fit the caption band.

Voices available (Kokoro): `bf_emma`, `bf_isabella`, `bm_george` (British), and `af_heart`, `af_nova`, `af_sky`, `am_adam`, `am_michael` (American). See `KOKORO_VOICES`.

## 6. Engine settings

`config/engine.json` holds every number. Change it there, never in scene code.

- `fps` 60 (chosen by measurement, section 10), `draftFps` 30, `timeGrid` 30 (all times are whole frames at 30 and 60 fps).
- `sizes`: target seconds and beats for short, medium and long. `sizeRules` and `channelCaps`: the size rule table.
- `voice`: default voice, words a second used for the budget, budget factor, gap between phrases.
- `timing`: lead-in before speech, hold after speech, end hold, crossfade and wipe lengths, `darkLightTransition` (`crossfade`, the default, or `wipe`), entrance delays, minimum scene length.
- `reading`: the reading-time rule (`max(1.8, words / 2.5 + 0.8)` seconds).
- `captions`: max words, max characters, max lines, minimum fully visible seconds, fades, `closeGap` (gaps closed so captions never blink) and `maxShift` (how far a chunk may move from its words before lint warns).
- `formats`: size, type multiplier, safe-area margins, caption band for `16x9`, `9x16`, `1x1`.

## 7. Jobs and the pipeline

A job is a folder `jobs/<name>/`:

| Path | Written by | What it is |
| --- | --- | --- |
| `brief.md` | person or web app | The plain-English brief. |
| `spec.json` | brief interpreter | The spec (section 2). |
| `decision.json` | size | Size, target seconds, rule, reasons, word count, budget, warnings, and `requestedSeconds` when the brief gave a length in seconds. |
| `audio/phrases/*.wav`, `audio/phrases.json` | voice | One WAV per phrase. |
| `audio/alignment.json` | align | Word timings per phrase, matched to the script. |
| `audio/voice.wav` | timing | The full voice track. |
| `timeline.json` | timing | Scene starts and lengths, phrase and word times, caption cues. |
| `build/<format>/index.html` | compile | The HyperFrames page per format, with its assets. |
| `review/lint.json` | lint | Every finding. |
| `review/contact-sheet.png`, `review/stills/` | sheet | One still per scene per format. |
| `out/<name>-<format>.mp4` | render | Final 1080p videos, captions burned in. |
| `out/<name>.srt` | timing | Subtitles. |
| `out/draft/` | render `--draft` | Quick 30 fps drafts. |
| `out/renders.json` | render | What was rendered, with ffprobe details. |
| `review/verify.json`, `review/frames/` | verify | Verification results and frames. |
| `status.json` | every step | Latest progress, for the web app to poll. |
| `interpret.json` | brief interpreter | The facts it read, the size, attempts, the problems fed back on each retry, and notes for the person. |
| `job.json` | web app | The app's record of the job: brief, brand, voice, formats, state, stage, progress and errors. Jobs made from the command line have none. |
| `review/interpret/` | brief interpreter | Pages from the interpreter's text-fit check. |

Photos and clips uploaded with a brief in the web app are saved in the brand's media folder, at `brands/<id>/media/uploads/<job>/<file>`, and the spec names them as `uploads/<job>/<file>`.

Commands (run from the project folder):

| Command | Reads | Writes |
| --- | --- | --- |
| `npm run make -- jobs/<name>` | everything below | all of the above. Flags: `--draft`, `--no-final`, `--until=<step>`, `--from=<step>`, `--formats=16x9,1x1`, `--software-gpu` |
| `npm run size -- jobs/<name>` | spec | decision.json (fails if the script is over the word budget) |
| `npm run voice -- jobs/<name>` | spec, brand voice | audio/phrases (cached in `.cache/voice` by text, voice, speed and language) |
| `npm run align -- jobs/<name>` | audio/phrases | audio/alignment.json (cached in `.cache/align` by audio content) |
| `npm run timing -- jobs/<name>` | decision, alignment | timeline.json, audio/voice.wav, out/<name>.srt |
| `npm run compile -- jobs/<name>` | spec, timeline, brand | build/<format>/ |
| `npm run lint -- jobs/<name>` | build, spec, timeline | review/lint.json (fails on any error) |
| `npm run sheet -- jobs/<name>` | build, timeline | review/contact-sheet.png |
| `npm run render -- jobs/<name>` | build | out/*.mp4 (`--draft`, `--no-final`) |
| `npm run verify -- jobs/<name>` | out, timeline | review/verify.json, review/frames (`--determinism` renders again and compares every frame) |
| `npx tsx scripts/motion-check.ts jobs/<name>` | out, build | review/motion/ (per-frame differences as CSV, motion.json). Flags: `--lossless` renders a lossless copy first so compression noise is not mistaken for jitter, `--formats=16x9`, `--frames=12.5,30` saves 13 frames around each time |
| `npm run doctor` | | checks tools, models and brands (`--fix` downloads models) |
| `npm run selftest` | | fast checks of the engine's rules |
| `npx tsx scripts/day1-proof.ts` | | jobs/day1-proof: 5 s toolchain proof in three formats |
| `npx tsx scripts/fps-benchmark.ts jobs/<name>` | build | config/fps-measurement.json |
| `npm run brand-import -- <folder>` | a folder of client assets | brands/<id>/ and a report of gaps. Flags: `--name="Client"`, `--id=client`, `--from=demo`, `--overwrite`, `--offline`, `--preview`, `--json` |
| `npm run icons-ingest` | the pinned Phosphor package | engine/icons/ |
| `npm run icons-sheet` | the library, a brand | engine/icons/sheets/<brand>-light.png and -dark.png (`--brand=<id>`, `--weight=<weight>`) |
| `npm run icons-check` | | fast checks of the icon library and the brand module |
| `npx tsx scripts/limits-check.ts` | scenes, a brand | fills every text part to its limit and checks the fit in all formats. `--calibrate` proposes limits (see section 3). Flags: `--brand=`, `--scenes=title,points`, `--variants=6`, `--items=3`, `--json=<file>` |

The order is size, voice, align, timing, compile, lint, sheet, render. Before the voice step, `makeVideo` measures each scene's text with the real fonts (`stepPreflight`), so text that does not fit fails in seconds; `skipPreflight: true` turns this off. Each step only reads files, so any step can be re-run alone. To review before rendering, use `--until=sheet`, look at the contact sheet, then `--from=render`.

## 8. Programmatic API

```ts
import { makeVideo, validateSpec, previewBrand, validateBrand, saveBrand, scaffoldBrand, listBrands, loadBrand,
         checkContrast, suggestPassingColour, brandBriefing, sceneCatalogue, specJsonSchema, listIcons,
         KOKORO_VOICES, decideSize, jobStatus, listJobs, loadConfig, PipelineError,
         searchIcons, checkIconName, renderIcon, createBrand, updateBrand, addBrandFile, importBrandFromFolder,
         suggestTokensFromText, extractGuidelinesText, proposeSurfaces, useOpenFont } from "./engine";
```

### makeVideo(specOrJobDir, options?, onProgress?)

```ts
makeVideo(input: string | object, options?: MakeOptions, onProgress?: (e: ProgressEvent) => void): Promise<MakeResult>
```

- `input`: a job folder path (with `spec.json`), or a spec object. A spec object is validated and written to `options.jobDir` (default `jobs/<slug of title>`), with `options.brief` saved as `brief.md`.
- `options`: `{ jobDir?, brief?, formats?, draft?, final? (default true), until?, from?, softwareGpu?, signal?, skipPreflight? }`. `until: "sheet"` stops before rendering so a person can approve the contact sheet. `signal` (an AbortSignal) stops the job: every step checks it between its slow parts (each voice phrase, alignment phrase, lint format and scene, contact sheet format), and the Kokoro and render processes are killed. A stopped job throws `StoppedError` (a `PipelineError` with `stopped: true`).
- A render that fails (for example Chrome missing a frame capture when the machine is short of memory) is tried once more with one worker. If that fails too, the error says the computer may be short of memory.
- Renders take turns across processes (`withRenderLock` in `render.ts`, lock file `.cache/render.lock` holding the process id). Two renders at once on a 16 GB Mac slow each other about 40 times. A second render waits and reports "Waiting for another video to finish before making the ... video". A lock left by a process that has ended is taken over. If a render runs for more than 3 times the video's length, its progress message adds "This is taking longer than usual".
- The voice step says "This is taking longer than usual" when no new line has been recorded for 30 s (`VOICE_SLOW_SECONDS`). After 120 s with no new line (`VOICE_STALL_SECONDS`) it stops the Kokoro process and starts it again once for the lines still to record; anything left after that is recorded one line at a time with `hyperframes tts`. Both can be set with `VIDEO_VOICE_SLOW_SECONDS` and `VIDEO_VOICE_STALL_SECONDS`.
- `onProgress` receives `{ step, status: "start" | "progress" | "done" | "error", message, overall (0 to 1), fraction?, format? }`. The same information is written to `jobs/<name>/status.json` (with a history), so a server can also poll `jobStatus(jobDir)`.
- Returns `{ jobDir, decision, timeline, lint, sheet?, srt, outputs: [{ format, kind, file, seconds, probe }] }`.
- Throws `PipelineError` with `step` and a plain-English `message` (and `findings` for lint) when a step fails: script too long, text does not fit, brand fails contrast, and so on. Show the message to the person as it is.

Several jobs can run in one process. Rendering is the slow part (about 1 minute for a 30-second video in all three formats).

### Brands

- `listBrands()`: every brand folder with `ok` and its errors.
- `loadBrand(id)`: parsed brand with `issues`, `contrast` and `ok`.
- `validateBrand(raw, dir)`: check unsaved brand JSON against a folder of files. Never throws. Returns `{ ok, brand?, issues: [{ level, field, message }], contrast: [{ id, label, result: { ratio, ratioText, passesAAA, message, suggestion } }] }`. Use it for live checking as the person edits.
- `checkContrast(fg, bg, labels?)` and `suggestPassingColour(fg, bg)`: for checking one colour pair as it is typed.
- `saveBrand(raw, { dir? })`: validate and write `brands/<id>/brand.json`. Saves when the shape is valid even if contrast fails (so work is not lost); rendering stays blocked until `ok` is true.
- `scaffoldBrand(id, name, from = "demo")`: start a new brand by copying an existing one, everything marked provisional. Then replace files and tokens.
- `previewBrand(idOrDraft, { outDir, formats?, scenes?, samples?, caption?, png? })`: stills of Title, Statement and End card in all three formats. Pass `{ brand: rawJson, dir }` to preview unsaved edits. Returns `{ items: [{ scene, format, html, png, width, height, issues }], check }`. Each `html` is a self-contained still page with relative asset links: serve `outDir` and show it in a scaled iframe for instant updates; the PNGs take about 1 second for all nine.
- `brandBriefing(id)`: tone, guidelines, rules, colour names and icon guidance (default weight, client icon names, how to search) as text for the brief interpreter.

### Brand module (`engine/brand/`)

The web app's brand manager and `npm run brand-import` use these functions. They are exported from `./engine` as well as `./engine/brand/index`. Every function that changes a brand returns the same check as rendering (`check: { ok, brand?, issues, contrast }`), so the app can show problems straight away. Messages are plain English and can be shown as they are.

A `BrandRecord` is `{ id, dir, raw (brand.json as stored), check, files }`. `files` lists `fonts` (with what is inside each file and which faces use it), `logos` (with `usedAs`), `icons` (with `overridesLibrary`), `graphics` and `documents`.

Create, read, update, delete:

| Function | What it does |
| --- | --- |
| `createBrand({ name, id?, from = "demo", colours?, description?, blank? })` | New brand folder. Copies the starting brand's fonts and tokens, makes a plain placeholder wordmark from the name in the brand's heading font (never another organisation's logo), and marks every group provisional. The starting brand's colour names are replaced by role names (Primary, Text, Background, Accent, Tint), so messages never use another organisation's colour names. `blank: true` uses plain placeholder colours (`BLANK_COLOURS`) that pass every check; the Brands page offers it as "A blank brand", the default. With `colours` (a list of `{ value, name?, role? }`) it guesses roles and picks surfaces that pass AAA. Returns the record and `notes` on each choice. |
| `readBrand(id)` | The record. |
| `updateBrand(id, patch)` | Merges a patch into brand.json (objects merge, arrays and values replace, `null` removes). The id cannot change. Returns the record and `saved`. A patch with the wrong shape is not saved; one that fails contrast is saved, but rendering stays blocked until `check.ok`. |
| `setProvisional(id, groups, provisional)` | Confirms token groups (removes them from `provisional`) or marks them provisional again. |
| `duplicateBrand(fromId, name, id?)` | Copies a brand, files and all. |
| `deleteBrand(id)` | Deletes the folder. The sample brand (`PROTECTED_BRANDS`) cannot be deleted. |
| `checkBrand(raw, dir)` | Same checks as `validateBrand`, for unsaved edits. Never throws. |
| `brandIdFromName(name)`, `slugifyBrandName(name)`, `brandExists(id)`, `brandFolder(id)` | Ids and paths. |

Files:

| Function | What it does |
| --- | --- |
| `addBrandFile(id, kind, fileName, bytes, opts?)` | `kind` is `font`, `logo`, `icon`, `graphic` or `document`. Checks the file, stores it under a safe name and updates brand.json. Returns `{ file, warnings, brand, font? }`. Up to 25 MB. |
| | Fonts (WOFF2, WOFF, TTF, OTF): reads family, weight, style and missing characters from the file; adds `fonts.faces` entries (a variable font gets one face per weight, default 400 and 700). While the brand still has only its starting font, the first uploaded family becomes the heading and body font and the starting font is removed. A new weight of a family already in use moves headings to the nearest bold and body text to the nearest regular. `opts.useForRoles` forces either way. |
| | Logos (SVG or PNG): SVGs are cleaned (no scripts, event handlers or external links). `opts.logoFor` is `both` (default), `onLight` or `onDark`. With `both`, a logo that cannot be seen on the dark surface (under 30% standing out) is used on light backgrounds only, and the other way round, with a warning. Small PNGs and PNGs in general get warnings. The placeholder wordmark is deleted once real logos replace it on both backgrounds. |
| | Icons (SVG): `opts.iconName` (default: the file name) and `opts.iconWeight`. Cleaned, given a viewBox if missing, and a single colour becomes `currentColor`. A library name replaces that library icon for this brand. |
| | Graphics (SVG, PNG, JPEG, WebP) go in `graphics/`. Documents (PDF, Markdown, text) go in `guidelines/`. |
| `removeBrandFile(id, file)` | Deletes a file and any font faces that use it. A logo in use cannot be removed. |
| `makeReverseLogo(id, file?)` | Makes a white version of an SVG logo for dark backgrounds and uses it. Guidelines often forbid recolouring, so ask first. |
| `writePlaceholderLogo(id)` | Remakes the placeholder wordmark (for example after renaming). |

Fonts:

| Function | What it does |
| --- | --- |
| `inspectFontFile(pathOrBytes, fileName?)` | `{ family, weight, style, variable, weightRange?, missingCharacters, format }`. Throws a plain-English error for a file that is not a font. |
| `searchOpenFonts(query, limit?)`, `listOpenFonts()` | Open-licence fonts (Google Fonts and others, through Fontsource). The list is cached for a week in `.cache/fontsource/`. |
| `useOpenFont(id, family, { weights?, roles? })` | Downloads the font (WOFF2, latin and latin-ext, default 400 and 700) into `fonts/` with a licence note, adds the faces and, unless `roles: false`, uses it for headings and body text. Rendering never needs the network after this. |

Colour:

| Function | What it does |
| --- | --- |
| `contrastMatrix(colours)` | Every text-on-background pair with its AAA result, strongest first. |
| `legalTextColours(colours)` | For each background, the colour names that pass AAA as text on it. |
| `assignColourRoles(list)` | Gives a list of colours the roles primary, text, background, accent, tint (and accent2, line). Uses roles and names first ("Primary blue", "Charcoal"), then list order, lightness and saturation. Made-up roles are listed in `invented`. |
| `proposeSurfaces(colours)` | Text and accent colours for the dark, light and tint surfaces and the captions, using only pairs that pass AAA. Returns `{ surfaces, captions, pairs, ok, notes }`. A primary too light for white text is never used under white text; the notes suggest a darker one. |
| `checkContrast`, `suggestPassingColour` | One pair, as it is typed (section above). |
| `contrastFixes(draft)` | One-click fixes for each failing pair, keyed by pair id: point that part at another brand colour that passes (`kind: "use"`, `path`, `token`), or change the text or background colour's value (`kind: "recolour"`, `colour`, `value`). Every fix is tried on the whole brand first and offered only if no pair that passes now would fail. Ordered by `mends`, the number of failing pairs a fix mends. The server adds them to every check it returns as `check.fixes`. |

Guidelines:

| Function | What it does |
| --- | --- |
| `extractGuidelinesText(pathOrBytes, fileName?)` | Text from a PDF (pdfjs-dist 6.4.299), Markdown or plain text file. Returns `{ text, pages?, kind, warnings }`. A scanned PDF with no text gives a warning. Word and design files are refused with a message. |
| `suggestTokensFromText(text)` | Suggested tokens for the person to confirm, never applied by itself: `colours` (hex, RGB and CMYK values with the name and line they came from), `fonts` (with `openFont` when it can be downloaded), `toneOfVoice`, `rules.do` and `rules.dont`, `logo.minHeightPx` and notes, `iconWeight`, `voice`, a `guidelines` summary for the brief interpreter, and `gaps`. |

Import and preview:

| Function | What it does |
| --- | --- |
| `importBrandFromFolder(folder, { name?, id?, from?, overwrite?, network? })` | The whole import: sorts logos, fonts, icons, graphics, colour lists and guideline documents; reads the guidelines; creates the brand; assigns colour roles and AAA surfaces; uses the fonts (or downloads an open font the guidelines name); adds logos (names with white, reverse or negative are for dark backgrounds; a single logo is added for both backgrounds when it can be seen on the dark one); and fills tone, rules and guidelines. Returns `{ brand, found, suggestions, legalPairs, notes, gaps, warnings }`. Every group still to confirm is in `gaps` and in `provisional`. |
| `parseColourList(text)` | Colours from a colour list file: JSON, or lines such as `Vale Blue #0B3B60 primary`. |
| `renderBrandPreview(idOrDraft, opts?)` | `previewBrand` with a temporary output folder by default. Returns `{ items, check, outDir }`. |
| `inspectImage(bytes)`, `sanitiseUploadedSvg(svg)`, `prepareIconSvg(svg)` | Checks for uploads before saving. |

### Specs and scenes

- `validateSpec(raw)`: `{ ok, spec }` or `{ ok: false, issues: [{ path, message }] }`.
- `specJsonSchema()`: JSON Schema of the spec.
- `sceneCatalogue()`: scene types with descriptions, slots limits and samples.
- `listMedia(brand)` and `mediaManifest(brand)`: a brand's photos and clips (from `brands/<id>/media/`) with their `assets.json` entries. Uploaded photos and clips go in that folder; record focus, licence, author and source in `assets.json`. `MEDIA_DIR`, `PHOTO_EXT` and `CLIP_EXT` say where and which types.
- `decideSize(facts)`: the size the engine would choose, with reasons.

### Brief interpreter (engine/interpret/)

```ts
import { interpretBrief, InterpretError } from "./engine/interpret";
const r = await interpretBrief({ brief, brand: "demo", voice?, formats?, media?, onProgress?, signal? });
// r.spec is a valid spec; r.size, r.understanding, r.notes, r.attempts, r.retries
```

- Call 1 reads the facts (key messages, purpose, channel, audience, steps, any explicit length, and the length in seconds if one is given). It is told which photos and clips were uploaded, so it never lists them as missing; any "missing" note about photos is also dropped when media was uploaded. It says whether the brief has a real topic at all (`usable`). If not (nonsense words, a test, a greeting), the interpreter stops with a plain message asking for what is happening, who it is for and what they should do. It also says whether the brief says what is actually happening (`specific`). A brief that only names a topic ("need a video about the new recycling stuff") stops the same way, with 2 to 4 questions as `problems` (what is changing, when, what people should do). Both are `retryable: false`: no script is written and nothing is rendered. The engine then picks the size with `decideSize`, so the script is written to the right word budget and beats.
- Word target: the middle of the size's range, or, when the brief gives seconds, enough words for that length (about 0.355 s of video per word plus 1 s per scene), kept under 95% of the word budget.
- Call 2 writes the title and scenes only. Its rules forbid claims, benefits, advice and marketing lines the brief does not give, repeating a fact across scenes, and a call to action that points to "this page". The interpreter adds `version`, `brand`, `facts`, `voice` and `formats`, resolves icons by meaning (client icons first, then the library index), and fixes slots used for the wrong job: an end card `link` that is not a web address moves to `detail` (or is dropped, with a note), a Stat `source` that is an action ("Book now") is dropped, and an `emphasis` phrase that is not in the scene's main text (the one `checkEmphasis` reads, such as `action` on an end card) is dropped. Then it checks the spec with the Zod schema, the word budget, an estimated timeline and the text-fit check with the real fonts. Any problem is sent back to the model, up to two more times. It never writes HTML or CSS.
- The estimated timeline uses a speech rate measured from 275 Kokoro phrases (about 0.29 s per spoken word, after dates and numbers are expanded, plus 0.15 s a phrase), set slightly slow (0.30 and 0.25) so the length check errs long. When the brief gave seconds and the estimate is more than 12% off (or over a limit), that is a soft problem: it goes back to the model, but a script with only soft problems is still used after the last attempt, with a plain note. When the brief has too little to say for the length asked for, the note says so and suggests adding detail to the brief: the engine never pads with filler or long holds. The best rule-passing script so far is kept, so a later attempt that breaks a rule never loses it.
- Backends: the local Claude Code CLI (`claude -p`, no tools, no hooks, structured output) by default. A CLI call that times out is killed (SIGKILL if SIGTERM is ignored) and tried once more with a fresh process, because a stall is usually the Mac sleeping, not the brief; the Anthropic SDK when `ANTHROPIC_API_KEY` is set. Settings: `VIDEO_INTERPRETER_BACKEND` (`auto`, `cli`, `sdk`), `VIDEO_INTERPRETER_MODEL` (default `claude-sonnet-5-5`), `VIDEO_INTERPRETER_CLAUDE`, `VIDEO_INTERPRETER_TIMEOUT`.
- Command line: `npm run interpret -- jobs/<name> [--brand=demo]` reads `brief.md` and writes `spec.json` and `interpret.json`. The Claude Code skill is `skill/SKILL.md`.

### Web app (server/, ui/)

`npm run app` builds the pages and starts the server at http://localhost:3006 (port from `PORT`). The pages are React with Mantine 9.6.3 in `ui/`, built by Vite into `ui/dist` (`npm run app:build`; `npm run app:serve` starts the server without building; `npm run app:dev` gives live reload on port 5173 with the API passed to port 3006; `npm run app:typecheck` checks them). The server serves `ui/dist/index.html` at `/`, `ui/dist/brands.html` at `/brands` and the hashed files at `/assets/`. The first version of the pages (plain HTML in `web/`) stays at `/classic` and `/classic/brands` until it is retired. The look follows katsura's rules (one 12-column grid, warm paper and sand tints, hairlines, gaps in multiples of 8, Open Sans stored locally, Phosphor light icons) with WCAG AAA throughout: all text 7:1 or more, nothing under 16 px, body text 19 px. It runs one job at a time in a queue. Stop asks the person to confirm, then shows "Stopping" at once (`job.json` has `stopping: true`, and progress from the steps still finishing cannot overwrite that message); the job reaches `stopped` at the next safe point, within a few seconds. A waiting job's `queuePosition` counts the running job too, so the page says "Waiting for 1 other video to finish". A running step whose progress has not changed for 60 s shows "This step is taking longer than usual" on the page. An `InterpretError` with `retryable: false` (nonsense, too short or too long brief) is stored as `error.retryable: false`, and the page offers Change the brief but not Try again. Saving an edited script runs the text-fit check first and returns `{ problems, fields: [{ scene, slot, item?, message }] }` with status 400 when text does not fit. Try again also works for jobs made from the command line that have a spec. Result videos show the first contact-sheet still as a poster. Its JSON API is in `server/index.ts`; the brand routes call the brand module (`engine/brand/`). Brand checks from the server (`/check`, the brand detail and save) carry `fixes` from `contrastFixes`. Keyboard focus is never dropped to the page: the job heading is updated in place, Stop and Save use `aria-disabled` while busy, uploads move focus to their report, and a stopped job moves focus to Try again. Every page is one column, GOV.UK style: each element follows the one before at every width. The brand editor has a contents list of jump links, a Saving panel at the top (status, check result, Save brand), its sections in order with the live preview as its own section after Colours and the checks near the end, and a Save brand button at the end of every section, with no sticky bar. Questions (Stop, delete a brand or a file, make a white logo, leave without saving) are asked in the page, not in dialogs. Videos carry a captions track made from the subtitle file (`/job-files/<id>/out/<name>.vtt`). `npm run e2e` drives the real pages with Playwright (see `server/test/e2e.ts`).

## 9. Quality rules the engine enforces

| Rule | Where |
| --- | --- |
| Every text element is fully visible for at least `max(1.8, words / 2.5 + 0.8)` s and never longer than its scene. | timing.ts sets scene length; lint re-checks timeline.json. |
| Captions: about 6 words and 40 characters, 2 lines at most, fully visible for at least 1 s, never more than about 0.4 s from their words, script spelling. A chunk spoken in under 1 s joins a neighbour when the two fit. | captions.ts (`fitCues`), lint (real font, fully visible time, shift). |
| Captions in step with the voice: whisper times are used only when believable; other words are timed from pauses in the audio. | align.ts, lint `word-timing`. |
| Motion: house curve, 0.4 to 0.8 s entrances, 60 ms stagger, rises of 24 px or less in whole pixels, crossfade (soft wipe only if configured), opacity and transform only. | motion.ts, transitions.ts, compile.ts. |
| Smooth frames: no frozen frames inside a movement, no single-frame jumps, no change at all in frames where nothing is scheduled to move (no shimmer). | `npx tsx scripts/motion-check.ts jobs/<name> --lossless` (reads the schedule from the compiled page, compares every pair of frames). |
| Text never sits straight on a photo or video: it sits on a solid surface or panel, so photo text keeps AAA. | scene layouts (photo, photo-text, video). |
| Photos and clips sharp enough (warning above 115% enlargement, error above 160%), clips long enough, clip frame rates conformed. | media.ts, scenes/common.ts photoCss, compile.ts. |
| Fonts loaded before frame 0. | `@font-face` with `font-display: block`, preload links, a hidden warm-up line for every face, `document.fonts.load()`; lint checks each face loads. |
| Body text and captions at least 42 px; scaled per format. | brand.ts, config. |
| AAA contrast for all text. | brand.ts (render refuses a failing brand). |
| Nothing outside the safe area or over the caption band; nothing clipped; no text overflow. | lint (real fonts in Chrome). |
| Text never shrinks to fit: it fails, early (before the voice) and with the part to shorten named. | pipeline.ts `stepPreflight`, lint. |
| Character limits are measured with the real fonts. | `scripts/limits-check.ts`. |
| Same spec, same frames. | HyperFrames seeks a paused timeline; verified by `npm run verify -- jobs/<name> --determinism`. |
| Times on whole frames. | timing.ts (30 per second grid). The compiler writes times with 6 decimals, because HyperFrames rounds a duration up unless it is within 0.001 frames of a whole frame; verify demands the exact frame count. |

## 10. Measurements

Measured on 5 November 2026 on an Apple M1 Pro (16 GB), HyperFrames 0.9.8, quality `delivery`:

| Video | Formats | 60 fps | 30 fps |
| --- | --- | --- | --- |
| demo-medium, 31.9 s | 16:9, 9:16, 1:1 | 63 s in total | 41 s in total |

The rule was 60 fps if a 30-second video renders in all three formats in under 6 minutes. It took about 1 minute, so the engine renders at 60 fps. Details: `config/fps-measurement.json`. Re-run `npx tsx scripts/fps-benchmark.ts jobs/demo-medium` on a new machine.

Determinism: two renders of `demo-short` at 16:9 gave identical decoded frames (1,034 of 1,034) and identical audio.
