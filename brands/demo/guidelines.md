# Northvale Council brand guidelines (sample)

Northvale Council is a fictional UK local council. These are sample guidelines for building and testing the video engine. They are not a real organisation's brand. Every token is provisional until a real client's guidelines replace it.

The machine-readable version is `brand.json` in this folder. The engine reads only `brand.json`. This page explains it for people.

## Who we are

We are the local council for the fictional borough of Northvale. We run bins and recycling, council tax, libraries, parks, planning and support for residents.

Our videos help residents do something: know about a change, get a service, or meet a deadline. They should feel calm, clear and trustworthy.

## Logo

The logo is a mark and a wordmark. The mark shows two hills meeting in a vale, with a small yellow chevron pointing north.

| File | Use it on |
| --- | --- |
| `logo/northvale-logo.svg` | White or Mist backgrounds |
| `logo/northvale-logo-white.svg` | Vale Blue backgrounds |
| `logo/northvale-mark.svg` | Small spaces, such as an app icon |

Rules:

- Keep the logo at least 64 px tall in a 1080p video.
- Leave clear space around it at least as wide as the mark.
- Do not stretch, recolour, rotate or redraw it.
- Do not put the logo on a photo without a solid Vale Blue panel behind it.

The words in the logo are vector outlines, so the logo stays sharp at any size and needs no font.

## Colour

We use a small set of colours. Most of every video is Vale Blue, white or Mist.

| Name | Hex | Use |
| --- | --- | --- |
| Vale Blue | #0B3B60 | Main brand colour. Backgrounds for openings and endings. Emphasis on white. |
| Ink | #0B0C0C | Text on white and Mist. Caption boxes. |
| White | #FFFFFF | Backgrounds for messages. Text on Vale Blue. |
| Beacon Yellow | #FFD84D | Emphasis and links on Vale Blue only. |
| Mist | #EEF2F6 | Quiet backgrounds and icon circles. |
| Moss Green | #00594C | Second accent. Not used for text by default. |
| Slate | #5A6670 | Thin lines and dividers only. Never for text. |

### Contrast

All text must meet WCAG AAA: a contrast ratio of at least 7 to 1, at every size. The engine checks this and will not render a brand that fails.

| Text | Background | Ratio |
| --- | --- | --- |
| White | Vale Blue | 11.6 to 1 |
| Beacon Yellow | Vale Blue | 8.4 to 1 |
| Ink | White | 19.6 to 1 |
| Vale Blue | White | 11.6 to 1 |
| Ink | Mist | 17.4 to 1 |
| Vale Blue | Mist | 10.3 to 1 |
| White | Ink (captions) | 19.6 to 1 |

Never put Beacon Yellow text on white or Mist. It fails badly (1.4 to 1).

### Surfaces

A surface is a background with its text and emphasis colours. Scenes choose a surface, never a colour.

| Surface | Background | Text | Emphasis |
| --- | --- | --- | --- |
| Dark | Vale Blue | White | Beacon Yellow |
| Light | White | Ink | Vale Blue |
| Tint | Mist | Ink | Vale Blue |

## Typography

We use Atkinson Hyperlegible Next, an open font (SIL Open Font License) designed by the Braille Institute for readers with low vision. Its letters are easy to tell apart: for example, a capital I, a lower case l and the number 1 all look different, and zero has a mark inside it.

The font files are in `fonts/`, with the licence in `fonts/OFL.txt`. We use two weights: Regular (400) for body text and captions, and Bold (700) for headings and labels. The files include Welsh characters such as ŵ and ŷ.

### Type scale

Sizes are in pixels for a 1920 x 1080 frame. The engine scales them for each format (portrait text is 20% larger, because it is watched on phones) and never lets body text or captions fall below 42 px.

| Style | Size | Line height | Use |
| --- | --- | --- | --- |
| Display | 116 px Bold | 1.08 | Titles |
| Heading | 84 px Bold | 1.15 | Statements and calls to action |
| Body | 56 px Regular | 1.3 | Supporting lines, links, phone numbers |
| Label | 46 px Bold | 1.15 | Small labels above a heading |
| Caption | 50 px Regular | 1.3 | Captions |

Write in sentence case. Do not use capitals for whole words, and do not use italics for emphasis. Emphasise a few words with colour instead.

## Spacing and shape

- The spacing unit is 8 px. Layouts use multiples of it.
- Corners have a 10 px radius.
- Leave plenty of space. One idea per scene.
- Keep everything inside the safe area. The engine does this for you.

## Icons

We use one icon family only: Phosphor (open licence, MIT), which the engine stores in `engine/icons/`. Never mix icons from different families in one video.

- Use the regular weight. It matches the weight of our body text. The engine uses it unless a scene asks for another.
- Show icons in Vale Blue inside a Mist circle on light scenes, and in Beacon Yellow or white on Vale Blue.
- Use at most one icon per scene. It should say the same thing as the words, such as a calendar for a date or a bin for waste.
- Icons are drawn as vector shapes, so they stay sharp at every size. Never use a picture of an icon.
- Duotone icons, if a scene uses them, show their light layer at 20% of the icon's colour.

Our own icons go in `icons/` as SVG files drawn in one colour. The engine turns that colour into the brand colour for each scene. An icon here with the same name as a library icon replaces it: our `bin.svg` and `calendar.svg` replace Phosphor's.

| Icon setting | Value |
| --- | --- |
| Library | Phosphor 2.1.1 |
| Default weight | Regular |
| Duotone light layer | 20% |
| Size on screen | Set by each scene |

## Captions

Every video has burned-in captions and a separate subtitle file.

- White text in an Ink box with 10 px corners.
- At most about 6 words and 2 lines at a time.
- Each caption stays on screen long enough to read. It never flashes.
- Captions use the words of the script exactly, so they are always spelled right.

## Motion

Motion is set by the engine, the same for every brand. It is calm and quiet:

- Things fade in and rise a little (no more than 24 px), over 0.4 to 0.8 seconds.
- Items arrive 60 ms apart.
- Scenes change with a short crossfade.
- No bounce, no spin, no zoom, no flashing.

## Photos

Photos come later. When they do:

- Use real Northvale people and places, with their consent.
- Text never sits straight on a photo. The engine puts a solid or graded Vale Blue panel behind it, so text still meets AAA.
- Do not use stock photos that look staged.

## Accessibility

- All text meets WCAG AAA contrast (7 to 1).
- Body text is never smaller than 42 px in a 1080p video. Portrait videos use larger text.
- Every video has captions and a subtitle file.
- Nothing flashes. Motion is slow and small.
- Words stay on screen long enough to read comfortably. The engine works this out from the number of words.

## Voice

- The default voice is Emma, a British English voice (Kokoro `bf_emma`), at normal speed.
- Other British voices: Isabella (`bf_isabella`) and George (`bm_george`).

## Tone of voice

Calm, clear and helpful. Talk to residents as neighbours, not customers.

- Use short sentences and everyday words. Aim for a reading age of 9.
- Say what is changing, when, and what the resident needs to do.
- Lead with the useful fact.
- Use "we" for the council and "you" for the resident.
- Be warm without being chatty.
- Never use jargon, slogans or exclamation marks.

Write dates as 3 March 2027, times as 9am or 5:30pm, and phone numbers in full, such as 0300 555 0199. The voice reads them naturally.

## Do

- Lead with what the resident needs to know or do.
- Keep each scene to one idea.
- Use Vale Blue, white and Mist as the main colours.
- Use Beacon Yellow only to emphasise a word or a link on Vale Blue.
- End every video with one action and a web address or phone number.

## Do not

- Do not put yellow text on white or Mist.
- Do not use exclamation marks, slogans or jargon.
- Do not stretch, recolour or redraw the logo.
- Do not use more than one icon per scene.
- Do not use photos without people's consent.

## What is still provisional

Everything. This is a sample brand. When a real client's guidelines arrive, add them as a new brand through the web app or as a new folder in `brands/`. No engine code changes are needed.
