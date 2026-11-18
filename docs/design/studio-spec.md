# Video maker studio: build spec

Status: final design spec for the build. Single source of truth. Date: 18 November 2026.
Owner: Jason (designer). Supersedes the three design proposals and the two judge reports it was made from.

Base: **Daylight Studio** (proposal 1) for the shell, the timeline and progressive disclosure, merged with **Brand Kit Studio** (proposal 3) for the engine fit, the colour model, live previews and test hooks, plus named grafts from **Brief to Screen** (proposal 2). Where this document disagrees with any proposal, this document wins.

Contrast figures here use the WCAG 2.x formula and were computed for this spec. CIE76 colour difference is written ΔE.

---

## 0. Decisions at a glance

| # | Topic | Decision |
|---|---|---|
| 1 | App | One React app, one Vite entry (`ui/index.html`), a hand-written history router (`ui/src/shared/router.tsx`, about 80 lines, no new dependency). Back and Forward work. `ui/brands.html` is retired. |
| 2 | Shell | Top bar with workspace tabs (Make, Videos, Brands, Settings). Under it, four regions: **Bin** (left), **Monitor** (centre), **Strip** (bottom, only where there is a sequence), **Inspector** (right). A one-line **Status bar** at the foot of the Make workspace. A region with nothing to show is absent, never empty chrome. |
| 3 | Theme | Light, calm, high contrast. White panels, near-black text. One dark area, the **monitor well**, which holds only video and white transport controls. No dark theme. |
| 4 | Type | Open Sans Variable (already installed). Body 18px. Nothing under 16px. Server pages use the system font stack (no auth allowlist change). |
| 5 | Colour model | `brand.json` `schemaVersion: 2`: a nested `palette` (named groups, unlimited colours, automatic 10% and 25% tints, exact tint overrides, colour rules) and unlimited ordered `schemes` (background, text, highlight, shape, name, on/off, key-word style, where it may be used, logo). v1 files migrate in code and render byte-identically. |
| 6 | Schemes in videos | The engine spreads schemes across a video by default (no two neighbours the same where possible; title and end on the same strong scheme). Options: one scheme for the whole video, or a per-scene override. A failing scheme is saved but **not used until fixed**. |
| 7 | Remake | Edits on a finished video are staged in a **change tray** and sent with one Remake through `PUT /api/jobs/:id/spec`. Look-only changes (scheme, motion, look, title) run as `relook` from the `timing` step: no brief, no voice, no alignment. |
| 8 | Live previews | Scheme cards compile one still per scene, format and type revision, with scheme colours as CSS variables. The app sets the variables in the same-origin iframe on every picker input: instant and identical to the render. |
| 9 | Shared maths | Pure `engine/colour-core.ts` (contrast, tints, ΔE, `suggestPassingColour`, ref resolving) and `engine/motion-rules.ts` (motion lint rules) are imported by both engine and UI through a Vite alias. The server stays the authority. |
| 10 | Motion | A closed library: 4 brand styles (Calm, Crisp, Lively, Still), 5 entrances, 5 transitions, 4 text effects, 2 shape motions. Everything is a named engine preset. Calm reproduces today's output exactly. Automatic choices never raise an error; only explicit overrides can. |
| 11 | Length | New choice on Make: Auto, Short, Medium, Long. Sent as `size`, stored as `facts.requestedSize` (already supported by `engine/size.ts`). |
| 12 | Copy | Labels of three words or fewer. One-line hints only where they prevent a mistake. Rules live in the control (counters, chips, disabled-with-reason), not in paragraphs. |
| 13 | Security | Settings, sign-in and setup keep every check exactly as now. Only `pageShell` markup, CSS and copy change. |

**Deferred to phase 2** (do not build now): per-line text reveal, a command palette, resizable panels, brand-level motion allow lists, axe-core if it cannot be added as a small dev dependency (the contrast and size scan in section 10 is required either way).

---

## 1. Information architecture and app shell

### 1.1 Routes

| URL | Workspace | Shows |
|---|---|---|
| `/` | Make | Same as `/make` (no redirect, so `page.goto(BASE)` keeps working) |
| `/make` | Make | Composer in the monitor area; settings, media and look in the inspector; recent videos in the bin |
| `/make?from=:jobId` | Make | Composer prefilled from that job's brief, brand, formats, voice, length and look |
| `/v/:jobId` | Make | Job workspace: progress, error, or the finished video with strip and inspector |
| `/v/:jobId?scene=3&format=9x16` | Make | Same, scene 3 selected, monitor on 9:16. Scene and format changes use `replaceState`. |
| `/videos` | Videos | Full library |
| `/brands` | Brands | Brand gallery; new brand form in the inspector |
| `/brands/:id` | Brands | Redirects (replace) to `/brands/:id/overview` |
| `/brands/:id/:area` | Brands | Brand studio. Areas: `overview, guidelines, colours, motion, type, logo, icons, voice, writing, checks` |
| `/brands/:id/colours?scheme=:schemeId` or `?colour=:colourId` | Brands | Colours with that scheme or colour selected |
| `/settings`, `/login`, `/setup`, `/logout` | Server HTML | Restyled only (section 3.8) |

Legacy links, handled on load with `replaceState`: `/?job=ID` → `/v/ID`; `/brands?brand=ID` → `/brands/ID/overview`. `/classic*` is untouched.

Navigation between views uses `pushState`. Area changes in the brand studio push. Scene, format and selection changes replace.

**Server:** add one GET route before the 404. If `Accept` contains `text/html` and the path matches `^/(make|v|videos|brands)(/.*)?$`, serve `ui/dist/index.html` with `no-cache`. `/` already serves it. Keep the `web/` fallback only when `ui/dist` is missing. Drop `brands.html` from `vite.config.ts`.

**API errors in the app** (`ui/src/shared/api.ts`): 401 → `location.assign('/login?next=' + encodeURIComponent(location.pathname + location.search))`. 503 with "Finish setting up first." → `location.assign('/setup')`. 403 → "That request was blocked. Reload the page and try again."

### 1.2 Desktop shell (1440 x 900)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐ 56
│ ● Video maker   Make  Videos  Brands  Settings                                   ? Keys  Jason│ top bar
├──────────────┬────────────────────────────────────────────────────────────┬──────────────────┤
│ BIN 280      │ MONITOR (flex)                                             │ INSPECTOR 360    │
│ Videos       │ toolbar 48: title · [16:9][9:16][1:1] · Ready              │ [Scene][Look]    │
│ [Search    ] │ ┌────────────────────────────────────────────────────────┐ │ [Video]          │
│ All Ready …  │ │                 well #11161B, video                    │ │                  │
│ ● Bin day    │ │                                                        │ │ property groups  │
│ ○ Library    │ └────────────────────────────────────────────────────────┘ │                  │
│              │ transport 48: ⏮ ▶ ⏭  00:12.4 / 00:41.0   CC                │ change tray      │
├──────────────┴────────────────────────────────────────────────────────────┴──────────────────┤
│ STRIP 168: ruler 0:00 … | [1 Title ▮] ⟋ [2 Statement ▮] · [3 Points ▮] …   playhead           │
├──────────────────────────────────────────────────────────────────────────────────────────────┤ 32
│ STATUS (role=status): Ready · 41 s · 3 formats · Northvale Council           Remake  Ctrl+↵  │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Top bar (56, `--panel`, 1px `--rule` bottom).** Wordmark (FilmSlate icon, "Video maker", orange dot) links to `/make`. Workspace tabs are links in a `nav aria-label="Main"`; current one has `aria-current="page"`, weight 700 and a 3px ink underline. No gliding pill. Right side: "Keys" (opens the shortcuts sheet) and the account menu (Settings, Sign out).
- **Bin (280).** The list for the workspace. Make: recent videos (newest 30, filter chips All / Ready / Busy / Problems, search, "All videos" link to `/videos`). Brands: brand switcher, then the area list, then the save footer. Collapsible with `[` and a header button "Hide list".
- **Monitor (flex).** The thing being looked at: composer, progress card, video, area canvas.
- **Strip (168).** Only on `/v/:id` once a script exists. Collapsible with `\`.
- **Inspector (360).** Properties of the selection, as WAI-ARIA tabs. One tab's content at a time. Long content scrolls inside the panel. Collapsible with `]`.
- **Status bar (32).** Only in the Make workspace. One line, `role="status"`, the single aria-live surface for job progress.
- **Scrolling.** On desktop (width ≥ 1024 and height ≥ 640) `html, body` do not scroll; each panel scrolls on its own with `overscroll-behavior: contain`. Below 640 tall, the page scrolls normally.
- Panel collapse state is stored in localStorage `va-panels` (wrapped in try/catch; the layout works without it).
- Panels are separated by 8px of `--app` and a 1px `--rule` border. No panel shadows.

Height budget at 900: 56 + 168 + 32 = 256 of chrome, 644 for the monitor row (toolbar 48, transport 48, well 548). At 1440 the well is 1440 − 280 − 360 − 32 = 768 wide: 16:9 shows at 768 x 432, 9:16 at 300 x 532, 1:1 at 532 x 532.

### 1.3 Breakpoints

| Width | Layout |
|---|---|
| ≥ 1280 | All regions |
| 1024–1279 | Bin closed by default; it opens as an overlay drawer from a "Videos" or "Areas" button in the toolbar. Inspector stays. |
| 768–1023 | Inspector becomes a right drawer, opened by selecting a scene or with `]`. Strip stays. |
| < 768 | Phone layout (1.4) |

Drawers are modal dialogs: focus trapped, Esc closes, focus returns to the opener.

### 1.4 Phone (390 wide)

```
┌──────────────────────────┐ 56  ☰  Bin day              ⋯
│ video 358 x 201 (sticky) │     the monitor stays pinned while you work
│ ▶ 00:12 / 00:41   16:9 ▾ │ 44
├──────────────────────────┤
│ [Scenes][Edit][Video]    │ 48  tabs: strip and inspector become these
│ scene cards, one per row │     scroll area
├──────────────────────────┤
│ 3 changes · Remake       │ 56  change tray, only when there are changes
├──────────────────────────┤
│ Make Videos Brands  ⚙    │ 64  bottom nav, 16px labels under 24px icons
└──────────────────────────┘
```

- The bin is a left drawer (☰).
- **Scenes** tab: vertical scene cards (thumbnail 96 x 54, number, type, scheme name, first line). Choosing a card selects the scene and switches to **Edit**.
- **Edit** holds the inspector's Scene and Look content for the selected scene, as two groups.
- **Video** holds the inspector's Video tab.
- Composer on phone: brief, brand, Make video (sticky above the bottom nav), then a "Settings" sheet button with a one-line summary.
- Brand studio on phone: the area list is the first screen; choosing an area pushes it. The inspector opens as a bottom sheet ("Edit" or "Preview").
- 16px side gutter. No horizontal page scroll; only the strip scrolls sideways, inside itself.

### 1.5 Visible by default versus revealed

| Shown by default | Revealed on demand |
|---|---|
| Brief, brand, Make video | Length, formats, voice, look, media (inspector tabs on desktop, a sheet on phone, with a one-line summary under the brief) |
| The video, format switch | Contact sheet (Video tab › Files), Steps (Video tab, closed), Brief (Video tab, closed) |
| Scene strip with scheme names and transition markers | Transition details (focus or hover; Enter edits it in Look) |
| The selected scene's words, highlights, spoken lines | Icon (closed), Motion (closed unless the scene has an override) |
| Downloads, "To check" count in the status bar and on the Video tab | Length reasons ("Why this length", closed) |
| Brand: palette and scheme cards on Colours | Captions colours, tint switches, colour rules, Sizes and spacing |
| Area problem badges in the brand bin | The full Checks area |

---

## 2. Every existing feature and its new home

| # | Feature today | New home |
|---|---|---|
| 1 | Brief, examples, 20,000 limit | `/make` composer, `#brief`. Examples show only while the box is empty and come from the brand: `brand.examples` (up to 3). For `demo` with no examples, the current three Northvale examples. Otherwise no chips. |
| 2 | Brand select, ready status, fix link | Composer, native `<select id="brand">` labelled "Brand". Status line: "Ready" or "2 problems · Fix the brand" (link to `/brands/:id/checks`). Remembered in `va-brand`. |
| 3 | Voice override | Inspector › Settings › "Voice" (`#voice`). First option "Brand voice: Emma". One hint, here only: "Stand-in voice. Replace it before you publish." |
| 4 | Formats, at least one | Inspector › Settings › "Formats": `#formats` group, checkboxes `#format-16x9` etc. with drawn shapes. The last one ticked cannot be unticked: `aria-disabled` plus the visible line "Keep at least one". |
| 4b | Length (new) | Inspector › Settings › "Length": segmented Auto / Short / Medium / Long, each with its range ("15 to 25 s"). Sends `size`. |
| 5 | Media up to 12, descriptions, drag and drop | Inspector › **Media** tab (badge with count). `#media` input inside an "Add photos or clips" drop zone; dropping anywhere on the composer also adds. Rows: thumbnail 64 x 36, name, size, "What it shows" (200), Remove (icon button with text label in its accessible name). 13th file refused: "12 files at most." |
| 6 | Submit, validation, ErrorSummary | "Make video" (`#make-button`, Ctrl/Cmd+Enter). ErrorSummary at the top of the composer. Links switch inspector tab when needed and focus the field. |
| 7 | Progress, queue, %, steps, slow note, tab title, notification, aria-live | `/v/:id` while busy: progress card in the monitor (`#progress-h`). Status bar is the live region. Tab title and "Tell me when it's ready" kept. |
| 8 | Stop with confirm | Progress card "Stop" → InlineConfirm "Stop making this video? The work so far will be lost." / "Yes, stop it" / "Keep going". |
| 9 | Try again | Error card and stopped card |
| 10 | Brief needs more detail | Error card "Edit brief" → `/make?from=:id` |
| 11 | Things to check | Video tab › "To check" (open when there are any). Count in the status bar ("3 to check", a button that opens it) and on the tab label. |
| 12 | One player, format switch keeping time, captions | Monitor. `#job-videos` wraps it; `.format-switch` radios named "Landscape 16:9", "Portrait 9:16", "Square 1:1"; `video[data-format]`. Keys 1/2/3. Captions on by default. |
| 13 | MP4 per format, SRT | Video tab › "Downloads" (open): "Download MP4 · Landscape 16:9 · 12.4 MB" for the current format (the link follows the format switch), "Download subtitles (SRT)" (`#job-subtitles`). The other formats are listed underneath as plain links "Other formats". |
| 14 | Length decision, story notes | Video tab › "Length" (closed): facts, "Why this length:" list, story notes. |
| 15 | Contact sheet | Video tab › "Files" (closed): `.sheet img` thumbnail plus "Open full size". The strip is the scene navigator now. |
| 16 | Script edit and remake | Select a scene; inspector **Scene** tab. Title in the Video tab (`#video-title`). Edits stage into the change tray. "Remake" (Ctrl/Cmd+Enter). `#script-form` wraps the Scene tab form. Field ids `s{n}-{slot}`, `s{n}-items-{k}`, `textarea[data-vo]` kept. |
| 16b | Per-scene scheme and motion (new) | Inspector **Look** tab for the selected scene |
| 17 | Delete video | Video tab footer "Delete video" (InlineConfirm). Bin row and library card "More" menu › Delete. Rows keep `data-delete` on the menu item. |
| 18 | History | Bin (`#history`, rows `data-job`) and `/videos`. Only one `#history` exists at a time. |
| 19 | Brands list, create, duplicate, delete | `/brands`: gallery; inspector holds "New brand"; card More menu: Duplicate, Delete (not the sample). |
| 20 | Brand editor | Brand studio areas (3.4–3.6). Save in the bin footer, Ctrl/Cmd+S, leave guard. |
| 21 | Settings, setup, sign-in | Server HTML, restyled (3.8) |

Nothing is removed. Two things merge: the stand-in voice warning appears once (Voice field on Make; a "Stand-in voice" tag beside Downloads), and the contact sheet moves into Files because the strip replaces it.

---

## 3. Screens

### 3.1 Make: composer (`/make`)

```
BIN: Videos            | MONITOR: composer (max 760, centred)              | INSPECTOR [Settings][Media 2][Look]
                       |  Make a video                         (h1 28/700) | Length  (Auto|Short|Medium|Long)
                       |  Brand [Northvale Council ▾]  Ready               | Formats [▭ 16:9][▯ 9:16][□ 1:1]
                       |  What is the video about?                (label)  | Voice   [Brand voice: Emma ▾]
                       |  ┌───────────────────────────────────────────┐   |   Stand-in voice. Replace it before
                       |  │ textarea 20px text, 10 rows, grows to 16  │   |   you publish.
                       |  └───────────────────────────────────────────┘   |
                       |  Who it's for, what's happening, what to do.      |
                       |  Try an example: [Bin day] [Library hours] …      |
                       |  Northvale · 3 formats · Auto · Mixed schemes · Calm   (summary, each part a button)
                       |                                  [ Make video ]   |
```

- h1 "Make a video" stays (the e2e reads it). No lede.
- Brief hint, one line: "Who it's for, what's happening, what to do. Write dates and links exactly." Character count shows within 1,000 of the limit.
- The summary line under the brief names every choice; each part is a button that opens the matching inspector tab and focuses its control.
- **Settings tab:** Length, Formats, Voice.
- **Media tab:** drop zone, list, "Use only files you have rights to." (one line).
- **Look tab:**
  - **Colour:** radios "Mix the brand's schemes" (default) / "One scheme". With One, a radiogroup of the brand's usable schemes as 160 x 90 mini cards.
  - **Motion:** radios "Brand style (Calm)" / Calm / Crisp / Lively / Still, each with a 160 x 90 preview tile (3.6 rules for playing).
- **Submit:** navigate to `/v/:id`, focus `#progress-h`.
- **Validation** (client, then server): "Describe the video in at least one sentence" (under 10 characters), "Keep the brief under 20,000 characters", "Choose at least one format", "Fix the brand first" (brand not ok), "12 files at most".

### 3.2 Make: job workspace (`/v/:id`)

**Toolbar (monitor, 48):** `h1#job-title` (20/700, truncated, full title in a tooltip and the accessible name), the format radiogroup, the state tag inside `#job-head` (`#job-head .tag`: Waiting, In progress, Ready, Problem, Stopped).

**State A: queued or running.** The monitor shows a white card (not the well):
- `h2#progress-h` "Making your video" or "Waiting to start".
- A 48px tabular percentage (`.progress-text`) and the ProgressBar (`role="progressbar"`, `aria-valuenow`).
- The live line with PulseDot: "Waiting for 2 other videos to finish.", "Starting", or the stage message. After 60 s with no movement: "Still working. This step is slower than usual."
- "Steps" list, open while busy: `.steps li` with classes `active` / `done` / `failed`; the label is the second span (the e2e reads it).
- "Tell me when it's ready" checkbox.
- "Stop" (secondary).
- Once `spec` exists, the strip fills with text-only scene cards so the person can read the script while it renders. Editing is unavailable while busy; the inspector shows "You can edit when it's finished."

**State B: error.** Monitor card `#job-error`:
- h2 "The brief needs more detail" (warn bar) or "The video could not be made".
- One-sentence message, then up to 12 problems; a problem that names a scene field links to it.
- Buttons in order: "Edit script" (when a spec exists; selects the first failing scene, focuses the field), "Edit brief" (`/make?from=:id`), "Try again".
- Strip cards with `fields` errors carry a problem badge.

**State C: stopped.** Card "Stopped" with the server message and "Try again" (when `fromApp` or a spec exists).

**State D: done.**
- **Monitor:** `<video>` in the well, poster, VTT track (en-GB), captions on. Switching format keeps time and play state.
- **Transport (48, on the well, white controls 18.2:1):** previous scene, play/pause, next scene, timecode `00:12.4 / 00:41.0` (tabular), CC toggle.
- **Strip (the timeline):**
  - A ruler with a mark every 5 s and a 2px ink playhead with a 10px `--mark` cap (decoration; the time is in the transport).
  - Clips proportional to duration (minimum 120 wide; the strip scrolls sideways inside itself). Each clip: still from `plan.scenes[i].stills[format]`, footer "3 · Points" (16/700) and the scheme name with an 16 x 16 swatch (background with an "A" in its text colour and a highlight bar), "Auto" when the engine chose it. Badges: "Changed" (pencil plus word) and problems ("!" plus count in words).
  - Between clips, a 24px **transition marker** with a glyph (cut, crossfade, wipe, push, sweep). Focusable; its name is "Transition into scene 3: Wipe". Enter selects scene 3 and opens Look › Motion.
  - `role="listbox"`, `aria-orientation="horizontal"`, roving focus. Options are named "Scene 3 of 8, Points, Golden 10%, 6.2 seconds". Arrow keys move, Home and End jump. Selecting seeks to the scene start + 0.1 s (uses `plan.scenes[i].start`) and writes `?scene=`. Enter plays from there.
  - While the video plays, the current clip gets `aria-current="true"` and a 4px `--mark` top bar, without moving focus.
- **Inspector tabs** (Scene selected → Scene; nothing selected → Video):

**Scene tab** (`#script-form`)
- Header: "Scene 3 · Points · 6.2 s", with Previous and Next buttons (`,` and `.`).
- **Words** (open): slot fields from `meta.scenes[type].text` with short labels (section 8). Count within 20 of the limit. List items "Point 1…4"; with 4 items the counter switches to `maxCharsWhenFull` with no sentence.
- **Highlights** (open): chip input, label "Highlights". Accepts only words or phrases found in the main text: "Not in the main text". A fourth is refused: "3 at most". Serialises to the existing comma list.
- **Spoken lines** (open): "Line 1…4" (`textarea[data-vo]`, 220), Remove (focus moves to the next line), "Add line". One fixed line above: "Captions match these words exactly." As you type, `https://` shows the inline fix button "Remove https://", and numeric dates like 03/03 show "Write dates as 3 March".
- **Icon** (closed): combobox with icon previews from `GET /api/icons?brand=`.

**Look tab** (for the selected scene)
- **Scheme:** radiogroup. First option "Auto (Golden 10%)", naming the engine's choice from `plan`. Then each usable scheme as a 160 x 90 card (the scene's own still with that scheme, via live variables; 3.5.4). Choosing one stages the change and shows a **preview still** of this scene with that scheme in the monitor, with a banner "Preview. Not remade yet." (ink on `--info-tint`) and a "Back to video" button (Esc). Schemes not allowed for this scene are shown with the reason under them, for example "Title and end need a scheme where the logo shows".
- **Motion** (closed unless the scene has an override): Entrance, Transition in, Text effect, Shape. Each is a select whose first option is "Video style (Rise)". Each has a "Preview" button that plays the option in a 320 x 180 tile in the monitor. Options that would be refused for this scene are disabled and the reason is shown as visible text under the select ("Word by word: the title is over 12 words"). The reasons come from `motion-rules` on the client and are confirmed by `POST /api/jobs/:id/look-check`.

**Video tab**
- **To check** (open when any): short notes on `--warn-tint`, each linking to its scene when it names one.
- **Downloads** (open, `h2#videos-title` "Downloads"): see feature 13. "Stand-in voice" tag.
- **Title** (`#video-title`, label "Title", hint "File names only.").
- **Look for the whole video:** Colour (Mix / One scheme + picker), Motion style. "Reset scenes to Auto".
- **Length** (closed): "Medium · 30 to 50 s", "This video: 41 s", "Spoken words: 98 of 120", "Why this length:" list, story notes fold.
- **Files** (closed): `.sheet img` thumbnail, "Open contact sheet".
- **Brief** (closed, read only): "Make a new video from this brief" → `/make?from=:id`.
- **Steps** (closed).
- **Delete video** at the bottom: InlineConfirm "Delete this video? It can't be undone." / "Yes, delete it" / "Cancel" (focus starts on Cancel).

**Change tray** (sticky at the foot of the inspector, only when something is staged)
- Line 1: "3 changes".
- Line 2, the consequence: "Look only: voice and timing stay." or "Words changed: unchanged lines keep their voice."
- "Show changes" toggle: one row per change ("Scene 3: scheme Golden 10%", "Scene 2: Title") with Undo per row.
- Buttons: "Undo all" (secondary) and **Remake** (primary, Ctrl/Cmd+Enter, busy "Checking it fits").
- Remake PUTs the full spec. On 4xx it maps `fields` to strip badges, an ErrorSummary at the top of the inspector (role alert, takes focus) and inline errors, and selects the first failing scene.
- Ctrl/Cmd+Z / Shift+Z undo and redo staged edits when focus is not in a text field.
- **Leave guard:** leaving with staged changes opens an in-app dialog "Discard 3 changes?" / "Discard" / "Keep editing", plus `beforeunload`.

**Focus after events:** submit → `#progress-h`; finish → `#videos-title` (if focus is still in the progress card; otherwise announce only); error → the error heading; delete → the next bin row; remake errors → ErrorSummary.

**Tab title:** "42% · Video maker" or "Waiting · Video maker"; then "Ready", "Problem" or "Stopped" until the person returns (cleared after 6 s if they are watching). No emoji or tick character.

### 3.3 Videos library (`/videos`)

- No bin (the library is the bin, full width). Inspector shows the selected video: poster, brand, date, length, formats, "Open", downloads, "Delete video".
- Monitor toolbar: search "Find a video", filter chips All / Ready / Busy / Problems / Stopped, brand filter, sort (Newest, Oldest, Title), Grid / List.
- Grid cards 256 wide: poster 16:9 (stage icon when not done), title (2 lines), "Northvale · 18 Nov, 10:12", state tag. List: Title, Brand, Made, Length, State.
- `#history` on the container, `data-job` on rows, `data-delete` on Delete menu items. Delete is an InlineConfirm inside the card or row; afterwards focus moves to the next item and a toast says "Video deleted".
- All jobs, windowed above 200.

### 3.4 Brands

**Gallery (`/brands`).**
- h1 "Brands" (e2e). Cards: logo on the brand's bookend scheme background, name as a heading, first 6 palette swatches, tag Ready / "2 problems" / Sample.
- Card More menu: Duplicate (inline "Name for the copy", Duplicate / Cancel), Delete (not the sample; InlineConfirm group named "Delete {name}": "Deletes the brand and its files. Videos already made stay, but can't be remade." / "Yes, delete this brand" / "Cancel").
- Inspector holds **New brand**: "Name of the organisation or brand" (80, hint "For example, Riverside District Council."), "Start from" (Blank / an existing brand, hint "Copies fonts and settings."), "Create brand". Opens `/brands/:id/overview` with any creation notes as "Next steps".

**Brand studio (`/brands/:id/:area`).**

```
BIN 280                       | MONITOR: area canvas                    | INSPECTOR 360: selection, or Preview
  All brands                  |  h2#sec-colours-h  Colours              |
  [Northvale Council ▾]       |                                         |
  Overview                    |                                         |
  Guidelines                  |                                         |
  Colours        1 problem    |                                         |
  Motion                      |                                         |
  Type                        |                                         |
  Logo                        |                                         |
  Icons and graphics          |                                         |
  Voice                       |                                         |
  Writing                     |                                         |
  Checks         2 problems   |                                         |
  ─────────────────────────   |                                         |
  Unsaved changes             |                                         |
  [ Save brand ]  Ctrl+S      |                                         |
```

- h1 "Edit {name}" sits at the top of the bin, visually 20/700 (the e2e reads it).
- Each area canvas is `section#sec-<area>` with `h2#sec-<area>-h`.
- **Save:** `#save-status` ("Unsaved changes", "Saving", "Saved", "Not saved: 2 problems", with a link to Checks) and `#save-button` "Save brand" in the bin footer, always visible. No save card, no floating bar. PUT `saved:false` shows an ErrorSummary at the top of the canvas. Uploads save on their own; their toast says what was saved ("Logo added and saved").
- **Live check:** `POST /check` 250 ms after an edit. Bin badges come from `issues[].field` through `sectionFor()`.
- **Inspector rule:** it shows the selected item's properties. With nothing selected it shows the **Preview** panel (`#live-preview`): scene (Title, Statement, Points, Stat, End), format and scheme selects, one still, its issues, "Open full size". It follows focus: focusing a scheme card switches the scheme; the Logo area switches to the Title scene. Areas with no visual result (Guidelines, Voice, Writing, Checks) have no inspector; their canvas is a 760 column.
- **Leave guard:** route change or `beforeunload` with unsaved changes asks "Leave without saving?" / "Leave" / "Stay".

**Areas**

1. **Overview**
   - Canvas: the kit at a glance (logo on each bookend-capable scheme, palette swatches, scheme cards, type specimen, motion style), each linking to its area. Then `#preview`: Title, Statement and End in 3 formats as 9 scaled iframes (e2e counts 9), in a "All formats" group, open.
   - Inspector (when nothing selected): Name (`#f-name`, 80), Description ("One sentence for the script writer.", 400), "Example briefs" (up to 3, 600 each), "Sample brand" switch, "Not confirmed yet" chips (hint "Mark anything the real guidelines haven't confirmed."), Details fold ("Folder: northvale (fixed)"), Delete brand (InlineConfirm, not the sample; e2e uses the last "Delete brand").
   - The sample brand shows a "Sample" tag and one line: "Duplicate it to make a real brand."
2. **Guidelines** (no inspector)
   - Drop zone `#guidelines-file` (PDF, Markdown or text, 25 MB) and "Read guidelines". While reading: "Reading. Long files take a minute." and an indeterminate bar.
   - `#suggestions` with `#suggestions-h`, a review list in sub-tabs Colours / Fonts / Writing / Other, each item with a checkbox and its quoted line:
     - Colours as swatch cards: name, hex, quote, **group** select (Core, Accent, Secondary, Neutral, Skip). Listed tints are folded into their parent (4.7). A suggested colour with a role (primary, text, background, accent, tint) **updates the palette colour with that id** when it exists, so `#c-primary-hex` shows it; others are added.
     - **Colour rules** ("Text: Navy or Black", "Never: white text on Golden") as checkbox chips with the quote.
     - Fonts, tone, do/don't, other guidelines, voice, icon weight, logo minimum height.
   - "Use the chosen suggestions" applies them, announces "Added 14 colours and 2 rules. Check the schemes, then save.", goes to Colours and opens Suggestions.
3. **Colours** (3.5)
4. **Motion** (3.6)
5. **Type**
   - Canvas: specimens in the brand fonts at real sizes (Heading, Body, Caption) on the first usable scheme.
   - Inspector groups: Headings (font, weight, "Bold key words" weight, used by schemes whose key words are bold), Body and captions (font, weight), Font files (Remove; delete unused), "Add fonts" (Upload: "WOFF2, WOFF, TTF or OTF. Licensed for video."; or "Find an open font"), "Sizes and spacing" (closed, "Sizes at 1080p. Most brands leave these.").
6. **Logo**
   - Canvas: the logo on **every enabled scheme** as tiles, each tagged "Shows" or "Can't see it on Navy". Light-toned schemes use the light-background logo.
   - Inspector: "For dark backgrounds" (`#logo-onDark`) and "For light backgrounds" (`#logo-onLight`) selects, Description, Smallest height (24–240), "Add a logo" (`#logo-upload`, radios `name="logo-for"` Both / Light only / Dark only, "Upload logo"), "Make a white version" (SVG only; InlineConfirm "Only if your guidelines allow a one-colour white logo."), "Not in use" with Delete.
7. **Icons and graphics**
   - Canvas: icon grid (`.icon-grid .name`) drawn in the chosen weight on the first usable scheme's shape colour.
   - Inspector: Weight, "Upload icons" (`#icon-upload`, name field when one file), graphics list and upload, upload reports.
8. **Voice** (no inspector): Voice, Speed (0.8–1.2, step 0.05, with output), sample text, "Play sample", audio. One line: "Stand-in voice to check timing."
9. **Writing** (no inspector): Tone of voice (4,000), Do and Don't (one per line, with rule counts), Other guidelines (20,000). One line: "The script writer reads this for every video." "Replace rules" where a rules import would overwrite.
10. **Checks** (no inspector): `#checks`. Problems (each linked to area and field), "Worth a look", "Not confirmed yet". Empty: "Passes every check, including AAA contrast."

### 3.5 Colours area

The canvas has three bands: Palette, Schemes, Captions. The inspector edits the selection; with nothing selected it shows Preview.

#### 3.5.1 Palette (`#palette`)

One row per group (Core, Accent, Secondary, Neutral, then custom), with "Add colour" per group and "Add group" at the end.

```
┌──────────────┐
│   (64px)     │  full colour
├──────┬───────┤
│ 25%  │  10%  │  32px tint bands (computed, or the exact guide value)
└──────┴───────┘
HMCTS blue        16/600
#0096D6           16 tabular
```

- Chips are buttons named "HMCTS blue, #0096D6, used in 3 schemes". Arrow keys move within and between groups. Bands are hidden when tints are off.
- **Colour inspector:** Name (40), Hex `#c-<id>-hex` (validated: "Use # and 6 characters, like #002D59"), three native range sliders Hue / Saturation / Lightness with value outputs and `aria-valuetext` ("Lightness 42%"), the native colour input as an extra, Group, "Make 10% and 25% tints" switch, the tint rows (hex, navy and white text ratios on each, and "Use the guide's value" when a `tintValues` override exists), "Used in" (links), Delete. Delete of a colour in use is refused: "Used by 2 schemes. Change those first." plus "Replace with [colour] everywhere".
- Reorder: "Move up / Move down" in a menu and Alt+Arrow. No drag-only control.

#### 3.5.2 Schemes (`#schemes`, which also carries `id="surface-selects"` until the e2e is rewritten)

Header: "Schemes · 5 in use", "Suggest schemes" (`#propose-button`), "New scheme". If colour rules exist: "Following your guide: text in Navy or Black." with a switch "Use these rules".

Grid of cards: 3 per row in a 1000+ canvas, 1 per row on phone.

```
┌───────────────────────────────────────┐
│ live still (Statement scene, 16:9)    │  iframe, live variables
├───────────────────────────────────────┤
│ Golden 10%                [In use ●]  │  name (F2 or Rename to edit), switch
│ [■ Background] [■ Text] [■ Key words] [● Shape]   four swatch buttons
│ Text: Passes AAA 12.9 to 1            │  words plus ratio, ink text
│ Key words: Bold, navy                 │
│ [Use Navy for text]   (only on fail)  │
└───────────────────────────────────────┘
```

- **Contrast line** text is exactly "Passes AAA: 12.9 to 1" or "Fails AAA: 4.2 to 1" for each of text and key words (the e2e reads "Fails AAA"). Under 7.5 adds "Close to the limit". An icon sits beside the words; meaning never rests on colour.
- **Swatch buttons** are named "Change text of Golden 10%. Now Navy, 12.9 to 1". They open a palette popover: groups with tint rows, each option showing its ratio against the counterpart ("Navy 12.9 to 1"). Options below the requirement sit under a "Too low for text" divider and stay choosable. "Custom colour" adds a hex to the palette in group "Extra".
- **Fixes:** up to 3 buttons from `fixes["schemes.<id>.<part>"]`. Labels: "Use Navy for text (12.9 to 1)" for kind `use`, "Change text of Golden 10% to #6B4A00" for kind `recolour` (the e2e regex `^Change .* to #`). A fix never breaks another pair (the existing simulation in fixes.ts, extended). No fix: "No single fix. Try Suggest schemes." with the button inline.
- **Failing scheme:** a 4px `--bad` left bar and "Not used until fixed". It stays saved and stays switched on, but the engine leaves it out. The brand is blocked only if no usable scheme remains, or none can open and close a video.
- **Card menu:** Duplicate, Move earlier, Move later (order is the priority for Mix), Use to open and close videos, Delete.
- **Scheme inspector:** large preview (scene and format selects), Name, "In use" switch, the four colour fields, "Key words" segmented (Colour / Bold / Colour and bold; Bold is preselected when key words equal the text colour), the contrast panel (text, key words, key words vs text difference, shape visibility, icon on shape; each with words, ratio and Fix), "Where it's used" (Anywhere / Open and close only / Middle scenes only), "Logo" (Automatic / Light-background logo / Dark-background logo), Duplicate, Delete.
- **Suggestions** (`#suggestions-band`, under the header, shown after "Suggest schemes" or after a guidelines import): mini cards with a still, a reason ("Pale golden, navy text, bold key words: matches your guide") and "Add". "Add all" when the brand has no schemes of its own (fresh import). Suggestions identical to existing schemes are hidden.
- **Defaults** (inspector with nothing selected, under Preview): "Videos: Mix schemes / One scheme" and "Open and close on: Auto / <scheme>". For migrated brands in `by-type` mode, a single line with a button: "Videos use one scheme per scene type, as before. Mix schemes for more variety." / "Mix schemes".
- **All pairs** (`#contrast`): compact table under the grid, closed: Scheme · Pair · Ratio · Result.

#### 3.5.3 Captions (closed group)

Caption box colour, caption text colour (palette popovers), weight, a live caption sample with its ratio, and the spoken-word line colour the engine picks, with its 3:1 result.

#### 3.5.4 Live previews (how they stay instant)

- `POST /api/brands/:id/schemes/preview` compiles one still per (scene, format, type revision, logo revision) with `compileStill(scene, brand, format, {live: true})`. In live mode the scheme values are custom properties on `:root`: `--bg --fg --hl --shape --icon --hl-weight --underline` (no `.scheme-<id>` class). The response includes `vars` for the requested scheme.
- The app keeps the iframe same-origin (`/previews/...`) and, on every colour input, sets those variables on `iframe.contentDocument.documentElement`. The derived values (`--icon`, `--hl-weight`, `--underline`) are computed by `colour-core.schemeVars(scheme, palette, fonts)`, the same function `brandCss` uses.
- The logo variant depends on scheme tone. When a change flips the tone, the app re-fetches the still (debounced 400 ms). Text, font and logo changes also re-fetch.
- Cache: `/previews/<brandId>-s-<hash>/`. Keep the 40 newest per brand, pruned separately from the 4-folder full preview pruning. Only cards in view load (IntersectionObserver), at most 4 requests in flight.

### 3.6 Motion area

- Canvas: four style tiles (Calm, Crisp, Lively, Still), each a 320 x 180 preview of a Statement then Points pair in this brand's fonts and first two schemes, with one line each:
  - Calm: "Gentle fades and rises. Crossfades." (default)
  - Crisp: "Clean slides, wipes and drawn underlines."
  - Lively: "Word by word titles and colour sweeps. Still no bounce."
  - Still: "Fades only. For sensitive subjects."
- Below: "In this style", the entrance, transition, text effect and shape motion it uses, each with a 160 x 90 tile.
- Inspector: the style radiogroup; "Adjust" fold with brand-level overrides (Transition, Text effect, Shape), each a select with Preview; a lint line when a combination is refused.
- **Preview playing rules:** tiles show the settled last frame when idle. They play on hover, on focus, or with their "Play" button, and loop until hover or focus leaves. Under `prefers-reduced-motion` they never autoplay; "Play" plays once. Nothing on the page moves while someone is reading.

### 3.7 Phone specifics

Covered in 1.4. Scheme cards stack one per row, palette chips wrap, the scheme inspector opens as a bottom sheet with its preview at the top.

### 3.8 Settings, sign-in, setup (server HTML; restyle only)

- `pageShell()` in `server/auth.ts` and `server/settings-pages.ts` emits the same top bar markup (wordmark plus plain `<a>` workspace links, Settings with `aria-current="page"`) on signed-in pages, an `--app` background, and a 640 white panel. Tokens are inlined from a new `server/shell-css.ts` string whose values match `ui/src/shared/styles.css` (a selftest compares the two).
- Font: system stack `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. No font route, no auth allowlist change.
- Settings layout: an in-page index (Team link · API key · Team password · Admin password · This browser) as anchor links, then each section as a card. "Saved" notices on `--ok-tint`.
- Sign-in and setup: no workspace links (not signed in). Centred 480 panel with the wordmark.
- Buttons: ink with white text (18.2:1). Links `--link`. Focus: the app's ring (3px ink outline, 2px white inner ring), replacing the yellow. Error summary keeps the GOV.UK structure on `--bad-tint`.
- Password fields allow paste and autofill.
- **Unchanged:** form actions, field names, the inline focus and refresh scripts, `crossSite`, `safeNext`, lockouts, cookie flags, `isAdmin`, the fail-closed rule, CSP. A review checklist in the PR confirms only template strings and CSS changed.

---

## 4. Colour data model

### 4.1 `brand.json` schemaVersion 2

```jsonc
{
  "schemaVersion": 2,
  "id": "hmcts", "name": "HM Courts & Tribunals Service", "description": "...",
  "fictional": false, "provisional": [],
  "palette": {
    "groups": [
      { "id": "core", "name": "Core" }, { "id": "accent", "name": "Accent" },
      { "id": "secondary", "name": "Secondary" }, { "id": "neutral", "name": "Neutral" }
    ],
    "colours": [
      { "id": "blue",   "name": "HMCTS blue", "value": "#0096D6", "group": "core",      "tints": true },
      { "id": "navy",   "name": "Navy",       "value": "#002D59", "group": "core",      "tints": true },
      { "id": "black",  "name": "Black",      "value": "#0B0C0C", "group": "core",      "tints": false },
      { "id": "golden", "name": "Golden",     "value": "#F9AE00", "group": "accent",    "tints": true,
        "tintValues": { "t10": "#FEF7E6", "t25": "#FEEBBF" } },
      { "id": "teal",   "name": "Teal",       "value": "#008C9D", "group": "secondary", "tints": true },
      { "id": "grey",   "name": "Grey",       "value": "#878787", "group": "secondary", "tints": true },
      { "id": "white",  "name": "White",      "value": "#FFFFFF", "group": "neutral",   "tints": false }
    ],
    "rules": {
      "text": ["navy", "black", "white"],
      "never": [ { "text": "white", "background": "golden" } ],
      "source": "Text must be navy or black on light backgrounds, white on dark. (page 4)"
    }
  },
  "schemes": [
    { "id": "golden-10", "name": "Golden 10%", "enabled": true,
      "background": "golden.t10", "text": "navy", "highlight": "navy", "emphasis": "weight",
      "shape": "golden.t25", "fit": "any", "logo": "auto", "source": "suggested" },
    { "id": "navy", "name": "Navy", "enabled": true,
      "background": "navy", "text": "white", "highlight": "golden", "emphasis": "colour",
      "shape": "blue", "fit": "any", "logo": "auto", "source": "suggested" }
  ],
  "schemeUse": { "mode": "spread", "single": null, "bookends": null },
  "captions": { "background": "navy", "text": "white", "weight": 600 },
  "motion": { "style": "calm" },
  "examples": ["From 1 March you can ..."],
  "icons": { "weight": "regular", "duotoneColour": "blue.t25" },
  "fonts": { "heading": { "family": "...", "weight": 700, "emphasisWeight": 700 } }
  // logo, type, voice, writing: unchanged from v1
}
```

**Zod (engine/schema.ts, all `.strict()`):**

```ts
const ColourId  = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);           // v1 role keys (accent2) stay valid
const ColourRef = z.string().regex(/^[a-z][a-z0-9-]{0,39}(\.t(10|25))?$/); // "navy", "golden.t10"
const SchemeId  = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);
const PaletteColour = z.object({
  id: ColourId, name: z.string().min(1).max(40), value: HEX, group: ColourId,
  tints: z.boolean().default(true),
  tintValues: z.object({ t10: HEX.optional(), t25: HEX.optional() }).strict().optional(),
}).strict();
const Scheme = z.object({
  id: SchemeId, name: z.string().min(1).max(40), enabled: z.boolean().default(true),
  background: ColourRef, text: ColourRef, highlight: ColourRef, shape: ColourRef,
  emphasis: z.enum(["colour", "weight", "both"]).default("colour"),
  fit: z.enum(["any", "bookends", "middle"]).default("any"),
  logo: z.enum(["auto", "onLight", "onDark"]).default("auto"),
  source: z.enum(["you", "suggested", "migrated"]).default("you"),
}).strict();
BrandSchemaV2 = z.object({
  schemaVersion: z.literal(2),
  /* id, name, description, fictional, provisional, fonts, type, logo, icons, voice, writing: as v1 */
  palette: z.object({
    groups: z.array(z.object({ id: ColourId, name: z.string().min(1).max(30) }).strict()).min(1).max(12),
    colours: z.array(PaletteColour).min(2).max(48),
    rules: z.object({
      text: z.array(ColourId).max(6).optional(),
      never: z.array(z.object({ text: ColourRef, background: ColourRef }).strict()).max(24).optional(),
      source: z.string().max(400).optional(),
    }).strict().optional(),
  }).strict(),
  schemes: z.array(Scheme).min(1).max(24),
  schemeUse: z.object({
    mode: z.enum(["spread", "single", "by-type"]).default("spread"),
    single: SchemeId.nullable().optional(),
    bookends: SchemeId.nullable().optional(),
  }).strict().default({ mode: "spread" }),
  captions: z.object({ background: ColourRef, text: ColourRef, weight: CaptionWeight }).strict(),
  motion: z.object({
    style: z.enum(["calm", "crisp", "lively", "still"]).default("calm"),
    entrance: EntranceName.optional(), transition: TransitionName.optional(),
    textEffect: TextEffectName.optional(), shape: ShapeMotionName.optional(),
  }).strict().default({ style: "calm" }),
  examples: z.array(z.string().min(10).max(600)).max(3).optional(),
}).strict();
BrandSchema = z.union([BrandSchemaV1, BrandSchemaV2]); // only at the parse boundary
```

Refinements: palette ids unique; a `.t10`/`.t25` ref is valid only when its base has `tints: true`; scheme ids unique; at least one scheme enabled; `schemeUse.single` and `bookends` name existing schemes; `rules.text` names existing colours; `fonts.heading.emphasisWeight` (optional, defaults to the heading weight's bold file, else 700).

**Derived, never stored** (`engine/colour-core.ts`):
- `resolveRef(ref, palette)`: base value; `.t10` = `tintValues.t10 ?? mixWithWhite(v, 0.9)`; `.t25` = `tintValues.t25 ?? mixWithWhite(v, 0.75)`.
- `tone(scheme)`: `"dark"` when white reaches a higher contrast on the background than `#0B0C0C`, else `"light"`.
- `strong(scheme)`: tone dark, or a full-strength (non-tint) background with HSL saturation ≥ 0.45.
- `schemeVars(scheme, palette, fonts)`: `--bg --fg --hl --shape`; `--icon` = highlight if highlight on shape ≥ 3:1, else text; `--hl-weight` = `emphasisWeight` when emphasis is `weight` or `both`, else `inherit`; `--underline` = highlight when emphasis includes colour, else the first of shape or text with ≥ 3:1 on the background.
- `logoVariant(scheme)`: `logo` if set, else `onDark` for dark tone, `onLight` for light.

**CSS emitted by `brandCss`:** `--c-<id>` for every colour, `--c-<id>-t10` and `--c-<id>-t25` where tints are on; a class per scheme `.scheme-<id>{--bg;--fg;--hl;--shape;--icon;--hl-weight;--underline}`; the legacy `--dark-*`, `--light-*`, `--tint-*` variables keep pointing at schemes `dark`, `light`, `tint` when they exist (else the first strong and the first two light schemes) until every scene file is migrated in the same change, then they are removed and `checkSceneCss` forbids them.

### 4.2 Checks (`inspectBrand`, per enabled scheme)

| Check | Result |
|---|---|
| Every ref resolves | error on `schemes.<id>.<part>` (scheme unusable) |
| Text on background ≥ 7.0 | error (unusable); < 7.5 warning "Close to the limit" |
| Key words on background ≥ 7.0 (emphasis `colour` or `both`) | error (unusable) |
| Key words vs text ΔE ≥ 20 (emphasis `colour`) | warning with fix "Use Bold" |
| Bold key words need a heading font file at `emphasisWeight` (emphasis `weight` or `both`) | error (unusable) |
| Shape vs background ΔE ≥ 5 | warning "The shape barely shows" (golden t10 to t25 is 15.2, grey 6.3) |
| Icon on shape ≥ 3:1 (WCAG 1.4.11) | error (unusable) |
| Text colour outside `palette.rules.text` | warning "Your guide limits text to Navy, Black, White" |
| A `rules.never` pair used | warning |
| Logo variant visible (`logoVisibility`) | warning; the scheme cannot open or close videos |

"Unusable" means the scheme is saved but left out of videos. **Brand-level errors** (block rendering): no usable scheme; no usable scheme that can open and close a video (fit ≠ middle and logo visible); captions below AAA; the v1 font, file and size checks.

Text fit: `textFitCheck` (preflight) and lint measure `.em` at the heaviest `--hl-weight` among the brand's usable schemes, so a later scheme change never breaks fit. Captions are checked as today; `captionHighlight` tries each usable scheme's highlight in rank order, then palette colours, for ≥ 3:1 on the caption box.

### 4.3 Migration v1 → v2 (`engine/brand/migrate.ts`)

`migrateBrand(raw): { raw: V2, migrated: boolean, notes: string[] }`. Pure and deterministic. Runs before validation in `parseBrand`, `validateBrand`, `checkBrand`, `readRaw`/`readBrand`, `updateBrand` and `loadBrandIconsOnly`. Everything past the parse boundary sees v2 only.

| v1 | v2 |
|---|---|
| `colours.<role>` | palette colour with `id = role`, same value and name (else title-cased role, "Accent 2"), `tints: false` (nothing new appears unasked) |
| groups | `primary`, `text` → core; `accent`, `accent2` → accent; `tint`, `line` → secondary; `background` → neutral |
| `surfaces.dark/light/tint` | schemes `dark` "Dark", `light` "Light", `tint` "Soft": background and text from the surface, `highlight = accent`, `emphasis: "colour"`, `shape: "tint"` (today's `--tint-bg` circle), `fit: "any"`, `logo: "auto"`, `source: "migrated"` |
| (none) | `schemeUse: { mode: "by-type" }`: each scene type uses its old surface id |
| `captions`, `icons.duotoneColour` | unchanged (role names are now palette ids) |
| (none) | `motion: { style: "calm" }` |

The `tint` scheme's shape equals its background; that gives the warning "The shape barely shows" with the fix "Use Tint 25%" (which also switches on tints for that colour). This is a warning, so the brand still renders.

**Write-back:** `readRaw` returns the migrated object; `patchFor` diffs against it; when the stored file is v1, the first save writes the whole migrated-plus-patched document atomically. `brands/demo/brand.json` stays v1 in the repo as the migration fixture. New brands (`createBrand`) are written as v2 with `mode: "spread"`.

**Gate:** demo v1 compiles string-identical scene HTML for every scene and format before and after migration (comments excluded), and a re-make of a stored demo job produces an identical `timeline.json`.

### 4.4 Recommendation (`engine/brand/recommend.ts`, `recommendSchemes(palette, opts)`)

`opts = { rules?: PaletteRules, useRules = true, emphasisWeightAvailable: boolean, limit = 6 }`. Deterministic: ties break by palette order, then id.

1. **Expand.** Every colour, plus `.t25` and `.t10` where tints are on. Each entry: `ref, value, base, step (100|25|10), group, L (relative luminance), S (HSL saturation), H`. White `#FFFFFF` and black `#0B0C0C` are added as text candidates if absent (flagged `added`, so the UI can offer to add them).
2. **Backgrounds.** All expanded entries except full-strength colours where neither white nor black text reaches 7:1, and full-strength light saturated colours (L > 0.6 and S > 0.6, such as full golden or lime) unless `rules` names them as backgrounds. Classify each as pale (L > 0.75), deep (white text ≥ 7:1), or mid.
3. **Text.** Candidates: `rules.text` if set and `useRules`, else core and neutral colours plus white and black. Keep those ≥ 7.0 and not in a `never` pair. Pick by: rules order, then core group, then ratio ≥ 7.5, then highest ratio. If none passes and the best is ≥ 6.0, record a near miss with `fix = suggestPassingColour(best, bg)`.
4. **Key words.** (a) A colour (not the text) at full strength with ≥ 7.0 on the background and ΔE ≥ 20 from the text, preferring accent then core → `emphasis: "colour"`. (b) Otherwise the text colour → `"weight"` (only if `emphasisWeightAvailable`, else the candidate is dropped). On pale tints (a) almost never reaches 7:1, so (b) wins: navy bold on a pale tint, the HMCTS look. On navy, golden passes at 7.29 → "colour", with "Close to the limit".
5. **Shape.** Pale `c.t10` → `c.t25`, else `c`; pale `c.t25` → `c`; deep → the brightest core colour where the icon colour reaches ≥ 3:1 (navy → blue, 4.17), else `c.t25`; white or neutral → the first core colour's `.t25`. The icon colour (`--icon`) must reach ≥ 3:1 on the shape, else try the next step deeper, then any accent or secondary colour at full strength that passes, nearest hue first.
6. **Score (0–100).**
   - Readability: `30 × clamp((min(textRatio, keyRatio) − 7) / 5, 0, 1)`.
   - Tone: pale tint +15, white +10, deep (only the best deep candidate) +15.
   - Background group: core +12, accent +9, secondary +6, neutral +8.
   - Shape: same hue +10, related hue +6.
   - Rules honoured +10; each `never` hit −10.
   - Below 7.5 on any text pair −20, except the single strong scheme.
7. **Select with diversity** (greedy, maximal marginal relevance): repeatedly take the candidate maximising `score − 30 × similarity` (similarity 1 for the same base colour, 0.5 for the same tone with background ΔE < 25, else 0). Guarantee exactly one strong scheme (the best deep candidate), at least two pale ones when available, at most two deep. Return `limit` (max 12).
8. **Names:** base name plus step ("Golden 10%", "Blue 25%", "Navy"). `reasons[]` in plain English ("Pale golden, navy text, bold key words"). Output order is the order of the chosen set: pale schemes by score, then the strong one.

**HMCTS fixture** (`scripts/recommend-check.ts`, rules.text = navy, black, white), computed for this spec:

| Scheme | Background | Text | Key words | Shape | Ratios |
|---|---|---|---|---|---|
| Golden 10% | #FEF7E6 | Navy | Navy, bold | Golden 25% #FEEBBF | text 12.94 |
| Blue 25% | #BFE5F5 | Navy | Navy, bold | Blue #0096D6 | text 10.36, icon on shape 4.17 |
| Grey 10% | #F3F3F3 | Navy | Navy, bold | Grey 25% #E1E1E1 | text 12.45 |
| Navy (strong) | #002D59 | White | Golden, colour | Blue #0096D6 | text 13.82, key words 7.29 ("Close to the limit"; fix offered: Golden 25%, 11.75) |
| Orange 10% | #FDEEE8 | Navy | Navy, bold | Orange 25% | text 12.22 |
| Teal 10% | #E6F4F5 | Navy | Navy, bold | Teal 25% | text 12.26 |

Acceptance: the first four suggestions are exactly these four (as a set), Navy is the only strong one, and schemes 5–6 are pale tints of different hues. The demo brand's suggestions must include schemes equivalent to its migrated dark and light schemes.

### 4.5 Guideline extraction

`engine/brand/guidelines.ts` gains `extractColourStructure(lines, colours)`:
- Headings matching `/core|primary|accent|secondary|neutral|supporting/i` set the group of the colours listed under them.
- Lines matching `/\b(text|type|copy|headlines?|body)\b.{0,60}\b(must|should|only|always)\b/i` that name palette colours or values give `rules.text`; the line is kept as `rules.source`.
- Lines with "never" or "avoid" and two colour names joined by "on" give `rules.never`.
- A value labelled "10%" or "25%" next to a parent's name is folded into that parent: dropped if within ΔE 3 of the computed tint, otherwise kept as `tintValues.t10/t25`.
- The model pass in `server/guidelines.ts` replaces the role enum with `group` and adds `tintOf` and `colourRules` to its JSON schema. The scan remains the fallback.

### 4.6 Scheme assignment across a video (`engine/schemes.ts`, `assignSchemes(spec, brand)`)

Usable = enabled schemes that pass, in brand order (order is priority). Bookend-capable = usable, `fit ≠ "middle"`, and `logoVariant` visible on it.

Mode = `spec.look.schemes` ?? `brand.schemeUse.mode`.

1. **Overrides.** A scene's `scheme` wins when usable (and bookend-capable for title and end). Otherwise validation fails before rendering: "Scene 3: the scheme Blue 25% is not in use in this brand."
2. **by-type** (migrated brands): each scene type uses its `legacyScheme` (`dark`, `light`, `tint`) if usable; any scene whose legacy scheme is unusable falls through to spread for that scene.
3. **single:** every scene uses `spec.look.scheme ?? brand.schemeUse.single ?? first usable`. If that scheme is not bookend-capable, title and end use the bookend scheme from step 4 and a note says so.
4. **spread:**
   - **Bookends:** `brand.schemeUse.bookends` if bookend-capable, else the first bookend-capable strong scheme, else the first bookend-capable scheme. Title and end use the same one.
   - **Middle scenes**, in order. Candidates M = usable schemes with `fit ≠ "bookends"`, excluding the bookend scheme when 3 or more usable schemes exist. For each scene, remove: the previous scene's scheme; the next scene's explicitly chosen scheme; for the last middle scene, the end card's scheme. Scene needs: `stat` and `quote` prefer pale schemes; `photo`, `video`, `phototext` need a panel that passes text contrast (every scheme does). Pick the **least used so far**, ties by rank.
   - If nothing is left, relax in this order: the end-card rule, the next-scene rule, the previous-scene rule (note: "Two scenes in a row share a scheme").
5. **Output:** `[{ sceneId, scheme, auto: boolean }]`, written to `timeline.json` (`SceneTiming.scheme`, `SceneTiming.schemeAuto`) and returned in JobView `plan`. Compile, sheet, verify, lint and the UI all read it from there.

**Scene definitions** gain `legacyScheme: "dark" | "light" | "tint"` (today's surface) and `schemeNeed: "bookends" | "prefer-pale" | "any"`. `sceneCatalogue()` exposes both; `surface` is renamed `legacyScheme` in `/api/meta`.

**Compile:** `.scene-inner` gets `scheme-<id>`. Every scene's CSS uses only `--bg --fg --hl --shape --icon --hl-weight --underline`: bars, kickers, eyebrows, the stat value → `--hl`; icon circles → `background: var(--shape); color: var(--icon)`; `.em { color: var(--hl); font-weight: var(--hl-weight) }`; `photo.panelCss` → the scene scheme, solid. The body background is the first scene's background. `ctx.logo()` uses `logoVariant(scheme)`. `transitions.chooseTransition` uses scheme tones.

### 4.7 Spec additions (`engine/spec.ts`; `version` stays 1; all optional)

```jsonc
{
  "version": 1, "brand": "hmcts", "title": "...", "facts": { "requestedSize": "medium" },
  "look": { "schemes": "spread", "scheme": "golden-10", "motionStyle": "crisp" },
  "scenes": [
    { "type": "statement", "beat": "problem", "slots": { }, "voiceover": ["..."],
      "scheme": "blue-25",
      "motion": { "entrance": "slide", "transition": "wipe", "text": "underline", "shape": "grow" } }
  ]
}
```

- `look.schemes`: `"spread" | "single"`; `look.scheme`: SchemeId; `look.motionStyle`: `"calm" | "crisp" | "lively" | "still"`.
- `validateSpec(spec, brand?)`: with a brand, scheme ids must be usable; motion names come from closed enums and must be allowed for the scene type (5.7).
- **Interpreter:** `writeSchema` strips `scenes[].scheme`, `scenes[].motion` and `look`, then adds back only `look.motionStyle` as an optional enum. Prompt line: "Set look.motionStyle only if the brief asks for a feel: still or calm for serious or sensitive subjects, crisp for practical how-to, lively for events. Otherwise leave it out. The engine owns all timing." The model never sees scheme ids. After interpretation, the server sets `facts.requestedSize` from the Make page's Length (unless Auto) and `look` from the Look tab.
- `ScriptEditor`'s replacement (Scene tab) clones the spec and keeps `scheme`, `motion` and `look`.

### 4.8 Remake paths (`server/jobs.ts`)

`PUT /api/jobs/:id/spec` diffs the new spec against `spec.json`:
- **Only** `scenes[].scheme`, `scenes[].motion`, `look` or `title` changed → `mode = "relook"`, `stagesDone = ["understand", "write", "voice"]`, run `makeVideo(dir, { from: "timing" })`. Preflight already runs only inside the voice step, so it is skipped; text fit stays safe because it measures key words at the heaviest weight (4.2) and lint runs after compile. Timing is rerun because entrances feed `visibleFrom` and transitions feed overlap.
- Otherwise → today's `rerender`.
- `retry()` keeps the mode. The 409 guard while queued or running is kept.
- Response adds `remake: "look" | "words"`. The busy message for relook: "Remaking the look. Voice and timing are kept."

---

## 5. Motion library

### 5.1 Principles (extends dec-002)

- 60 fps. Transform and opacity only. Masks use an `overflow: hidden` wrapper with a transformed inner element, never clip-path.
- No bounce, no overshoot. House curve `cubic-bezier(.2,.8,.2,1)`; push and sweep use `cubic-bezier(.65,0,.35,1)`.
- Rises ≤ 24 px, slides ≤ 40 px, scale only within 0.94–1. Offsets are whole pixels × `typeMultiplier`, rounded per format.
- Every fade starts at `RASTER_FLOOR_OPACITY`. `force3D` is consistent per array. Slow linear moves get no layer (`force3D: false`).
- Text never sits on photos; photos pan, never zoom.
- Every preset is a pure function of time on the paused GSAP timeline: no rAF, no CSS animation, no text written by callbacks.
- **Text is fully settled for at least 75% of its time on screen, and for at least its reading time.** Timing pads the scene first; lint fails only if padding cannot fix it.
- Automatic choices (style, brand defaults, scene defaults) never raise an error: the resolver downgrades a combination the rules refuse (for example, a sweep next to a photo becomes a crossfade) and records a note. Only explicit per-scene or brand overrides can fail lint.

### 5.2 Entrances (by element role)

Element roles replace concrete presets in `SceneElement`: `logo | accent | eyebrow | headline | body | item | media | shape | value`. The Calm table maps each scene's elements to today's presets exactly.

| id | Label | Motion | Duration (s) | Allowed on |
|---|---|---|---|---|
| `rise` | Rise | fade + y 18 (headline 24, small 12) | 0.6 / 0.8 / 0.4 | all (today) |
| `fade` | Fade | opacity | 0.6 (logo long 0.8) | all |
| `slide` | Slide | fade + x −32 → 0 from the reading start side | 0.6 | headline, body, item, accent, eyebrow |
| `mask` | Reveal | inner block y 100% → 0 inside an overflow-hidden wrapper (`padding-bottom: .12em; margin-bottom: -.12em` so descenders show); opacity from floor to 1 over the first 0.1 s | 0.6 | headline, body (whole block in phase 1) |
| `settle` | Settle | fade + scale 0.96 → 1 | 0.7 | logo, media, shape, value (never body text) |

Phase 2: `lines` (per-line reveal) once line measurement is done in compile, not read from preflight output.

### 5.3 Transitions (into a scene)

| id | Label | Length (s) | Overlap | Mechanics | Rules |
|---|---|---|---|---|---|
| `cut` | Cut | 0 | 0 | none | not between two scenes with the same scheme |
| `crossfade` | Crossfade | 0.5 | 0.5 | today's X array | always allowed; the only option next to photo or video scenes |
| `wipe` | Wipe | 0.8 | 0.8 | today's W array with feather | |
| `push` | Push | 0.7 | 0.7 | new P array: outgoing inner x 0 → −w, incoming x w → 0 (the outgoing scene animates for the first time) | not next to media; peak edge about 120 px a frame at 1920 |
| `sweep` | Colour sweep | 1.0 | 0.5 | new S array: a full-frame `div.sweep` in the next scheme's shape colour (or its background if the shape is within 1.3:1 of both backgrounds) slides −w → 0 over 0.5 s, the next scene starts underneath at the midpoint, then the layer slides 0 → +w over 0.5 s | not next to media; not when both backgrounds are the same; at most one sweep in any three transitions |

Config: `timing.transitions { cut: 0, crossfade: 0.5, wipe: 0.8, push: 0.7, sweep: 1.0 }`. The old `crossfade` and `wipe` keys stay as fallbacks. `SceneTiming.transitionIn` widens to `none | cut | crossfade | wipe | push | sweep`; old timelines still parse. Sweep layers are top-level elements with `data-start`/`data-duration` at a z-index above both scenes. Check before shipping push: HyperFrames keeps the outgoing scene visible through the overlap (its duration already includes `overlapOut`).

### 5.4 Text effects (one per scene, on the headline or main slot)

| id | Label | Mechanics | Settled at | Rules |
|---|---|---|---|---|
| `none` | None | | entrance end | |
| `words` | Word by word | `ctx.rich()` emits `<span class="w">` per word (inline, no padding, so line breaks are unchanged); each word fades + y 8, 0.4 s, 0.06 s stagger (new T array) | last word + 0.4 | ≤ 12 words; one slot per scene; not with `mask`; not with an incoming push or sweep |
| `underline` | Underline | a bar under each `.em` run, height max(4px, 0.08em), colour `--underline`, scaleX 0 → 1 from the start edge, 0.5 s, starting 0.15 s after the headline settles, 0.12 s between runs (T array) | headline entrance end (the bar is decorative) | needs at least one highlight; the HMCTS look |
| `emphasis` | Highlight fade | each `.em` rendered twice, stacked: text-colour copy over highlight copy; the top copy fades to 0 over 0.5 s after settle (T array) | headline entrance end | only when emphasis includes colour; on a weight-only scheme it is dropped with a note |
| `count` | Count up | digit roll: each digit is a column `<span class="dg"><span class="dg-i">0…9</span></span>` in an overflow-hidden box one line tall; the inner strip translates y from digit 0 to the target digit over 1.2 s with the house curve (new K array, `force3D: true`). Prefix, separators and suffix are static. `tabular-nums` | value end + 1.2 | `stat` value only; a single number with an optional £/$ prefix, thousands commas, up to 2 decimals and an optional `%` or `k` suffix. "1 in 4" and ranges refused: "Count up needs a single number, like 45%." |

`count` is transform-only by design. It needs no `onUpdate` and no text rewriting, so parallel workers seeking the paused timeline get identical frames. Compile check: the value box with digit columns must match the plain-text box within 1 px in every format; otherwise the resolver falls back to `settle` with a note.

### 5.5 Shape motion (illustration and icon circles)

| id | Label | Mechanics | Rules |
|---|---|---|---|
| `none` | None | appears with its element | |
| `grow` | Grow | circle scale 0.94 → 1 + fade, 0.8 s, from the scene's enter time (G array, `force3D: true`) | circles and icon tiles only |
| `drift` | Drift | circle translates x by ±6 px × typeMultiplier, linear over the scene (G array, `force3D: false`) | never on text; not in a scene with a photo pan |

### 5.6 Brand styles

| Role | Calm (default = today) | Crisp | Lively | Still |
|---|---|---|---|---|
| headline | rise (24) | slide | rise + `words` on title and statement | fade |
| body, items | rise, stagger 0.06 | fade; items slide, stagger 0.05 | slide, stagger 0.06 | fade, stagger 0.06 |
| accent, eyebrow | fade / rise small | fade | fade | fade |
| logo | fade (long) | fade | settle | fade (long) |
| media | rise | fade | settle | fade |
| transition, same tone | crossfade | cut (crossfade when the scheme is the same) | push | crossfade |
| transition, tone change | crossfade (`darkLightTransition` from config) | wipe | sweep (max one in three; else push) | crossfade |
| text effect | none | underline (stat: count) | words on title and statement, underline on points, count on stat | none |
| shape | none | grow | grow | none |
| duration scale | 1.0 | 0.85 (never under 0.4) | 1.0 | 1.0 |

Next to photo or video scenes every style uses crossfade.

**Resolution order** (one function, `resolveMotion(spec, sceneIndex, brand, plan)` in `engine/motion.ts`): scene `motion.*` → `spec.look.motionStyle` → brand `motion` overrides → brand style → scene defaults. It returns `{ entrances: Record<selector, preset>, transition, textEffect, shape, notes }` and is the only resolver used by `timing.ts` (`visibleFrom`, overlap), `compile.ts` (arrays), `sheet.ts` (`settledTimes`), `scripts/verify.ts` and `scripts/motion-check.ts`.

**Timeline:** `SceneTiming` gains `scheme`, `schemeAuto`, `entrance` (headline), `textEffect`, `shape`, `transitionColour`. `visibleFrom` = entrance end, or the text effect's settle time for the effect's slot.

### 5.7 Lint (`motionCheck(spec, timeline, brand)` in `engine/lint.ts`, run in preflight and lint; rules shared from `engine/motion-rules.ts`)

The rules the person sees are plain: **one text effect and one shape motion per scene; word by word only on short titles; no push or sweep next to photos or video; no cut between matching scenes.**

| # | Rule | Result |
|---|---|---|
| 1 | Every name is in the registry and allowed for the scene type and role | error |
| 2 | Text settled ≥ 75% of its on-screen time and ≥ its reading time, after padding | error: "Scene 3: the title is still moving for too long. Pick a calmer text effect or shorten it." |
| 3 | Peak transition edge speed ≤ 210 px a frame at 60 fps in every format | error |
| 4 | Rise ≤ 24, slide ≤ 40, scale within 0.94–1 after the type multiplier | error |
| 5 | `words` on more than 12 words or more than one slot | error: "Word by word works on short titles only." |
| 6 | `words` or `mask` on a headline together with an incoming push or sweep | error: "Too much moving at once." |
| 7 | More than one text effect or more than one shape motion in a scene | error |
| 8 | push or sweep into or out of a photo, photo-text or video scene | error |
| 9 | cut between two scenes with the same scheme | error: "A cut between matching scenes looks like a glitch." |
| 10 | `count` on a value that is not a single number | error |
| 11 | More than one sweep in any three transitions | error |
| 12 | `emphasis` on a weight-only scheme | warning; effect dropped |
| 13 | Any text effect in a scene shorter than 2.5 s | error |
| 14 | Lively on a video over 60 s | warning "Lively suits short videos." |

`scripts/motion-check.ts` and `scripts/verify.ts` learn the new arrays (P, S, T, K, G) with smooth, steady and edge windows. New arrays are added one at a time, each with its windows, before the next.

### 5.8 Compiled arrays

| Array | Shape | Notes |
|---|---|---|
| E | `[sel, dx, dy, scale, dur, at, ease]` | replaces `[sel, rise, dur, at]`; Calm output must produce the same frames |
| M | `[sel, dur, at]` | mask inner |
| X, W, D, C, H | unchanged | |
| P | `[outSel, inSel, w, dur, at]` | push |
| S | `[layerSel, dur, at, w]` | sweep; colour set in CSS by `--sweep` on the layer |
| T | `[sel, kind, dur, at, stagger]` | words, underline, emphasis |
| K | `[colSel, fromY, toY, dur, at]` | count digit columns, whole pixels |
| G | `[sel, kind, dur, at, dist]` | grow, drift |

### 5.9 Motion previews

- `POST /api/brands/:id/motion/preview { brand?, kind: "style"|"entrance"|"transition"|"text"|"shape", id, scheme?, format?: "16x9" }` → `{ url, seconds }`. `engine/motion-preview.ts` compiles a mini page with the same compiler: a 3 s Statement scene (6 s Statement → Points pair for styles and transitions), unpauses `window.__timelines.main`, loops with `repeat: -1, repeatDelay: 0.8`, and responds to `postMessage({ play })` / `({ pause })`. Cached in `CACHE_DIR/motion-previews/<brand>-<hash>/`, served at `/previews/motion/...` (same-origin, already served under `/previews/*`).
- Tiles are at least 160 x 90 and follow the playing rules in 3.6.

---

## 6. Visual design system (Daylight Studio)

### 6.1 Colour tokens (`ui/src/shared/styles.css` `:root`)

| Token | Value | Use | Contrast (computed) |
|---|---|---|---|
| `--app` | #E7EAEE | app background, gaps between panels | ink 15.07 |
| `--panel` | #FFFFFF | panels, cards, inputs, top bar | ink 18.19 |
| `--panel-2` | #F3F4F6 | panel headers, toolbars, zebra | ink 16.53 |
| `--well` | #11161B | monitor surround only | white 18.19 |
| `--ink` | #11161B | all primary text and icons; primary button fill | 18.19 on panel; white on it 18.19 |
| `--ink-2` | #2B3138 | secondary text: meta, hints. Nothing lighter exists | 13.13 panel, 11.93 panel-2, 10.88 app, 10.61 select |
| `--on-well` | #FFFFFF | text and icons on the well | 18.19 |
| `--link` | #0A4A73 | links, the selected tab underline | 9.38 panel, 8.52 panel-2, 7.77 app, 7.57 select |
| `--select` | #DBE9F3 | selected row, clip, card (with a 2px ink edge) | ink 14.69 |
| `--hover` | #EEF3F7 | hover fill | ink 16.28 |
| `--edge` | #5C6670 | control borders, meaningful dividers (non-text ≥ 3) | 5.85 panel, 5.32 panel-2, 4.73 select |
| `--rule` | #C9CED4 | decorative panel dividers only | decorative |
| `--mark` | #E8651A | signature dot, playhead cap, playing clip bar. Never text | 3.33 panel, 5.46 well |
| `--focus` | ink outline + 2px white inner ring; `#FFD84D` outline on the well | focus | yellow on well 13.15 |
| `--ok` / `--ok-tint` | #1D5236 / #E6F1E9 | pass | 7.84 on tint, 9.08 on panel |
| `--bad` / `--bad-tint` | #7A1A1A / #F9EAE7 | fail, delete | 9.02 on tint, 10.55 on panel; white on bad 10.55 |
| `--warn` / `--warn-tint` | #5A3D00 / #F8F0DA | to check | 8.78 on tint, 9.99 on panel |
| `--info-tint` | #E9EEF1 | preview banners (ink text) | ink 15.56 |

Rules: no other text colours. No opacity on text, ever. Placeholders are `--ink-2` at full opacity and never replace a label. Disabled controls keep ink text with a dashed `--edge` border and a visible reason line. Meaning is always an icon plus a word.

### 6.2 Type (Open Sans Variable, fallback system-ui)

| Role | Size / line height / weight |
|---|---|
| Composer h1 ("Make a video"), empty states | 28 / 36 / 700 |
| Workspace title (monitor toolbar h1, brand studio h1) | 20 / 28 / 700 |
| Area canvas heading (h2) | 22 / 30 / 700 |
| Panel and group headings | 18 / 26 / 700 |
| Body, inputs, list rows | 18 / 28 / 400; the brief textarea 20 / 30 |
| Labels, tabs, strip labels, status bar | 16 / 24 / 600 |
| Meta, hints, timecode | 16 / 24 / 400 |
| Minimum anywhere | 16 |

Tabular numbers for times, sizes, percentages and ratios. Letter spacing 0. No uppercase micro-labels.

### 6.3 Space, size, radius, depth

- Space scale: 4, 8, 12, 16, 24, 32, 48. Panel padding 16; inspector 20; gap between groups 24; between fields 16.
- Fixed sizes: top bar 56, bin 280, inspector 360, strip 168, status bar 32, monitor toolbar 48, transport 48.
- Controls 40 tall (44 on phone; primary buttons always 44). Icon buttons 40 x 40 with `aria-label` and a tooltip; important ones also show text. Strip clips at least 120 x 112. Preview tiles at least 160 x 90.
- Radius: 6 (inputs, buttons, chips), 10 (cards, clips, popovers), 999 (switches, tags).
- Depth: panels flat. Popovers, menus, drawers and dialogs: `0 8px 24px rgba(17,22,27,.18)` plus a 1px `--edge` border. The well has no shadow. Selected clip: 2px ink outline plus the 4px `--mark` top bar when playing.

### 6.4 Components (`ui/src/shared`)

| Component | Notes |
|---|---|
| `AppShell` | top bar, regions, F6 region cycling, collapse state |
| `WorkspaceTabs` | links with `aria-current` |
| `Panel` | header (title, actions, collapse), scroll body |
| `BinList` | listbox, roving tabindex, row More menu |
| `Monitor`, `Transport` | well, video, timecode, format radiogroup |
| `SceneStrip`, `Clip`, `TransitionMarker` | listbox timeline |
| `InspectorTabs` | WAI-ARIA tabs, manual activation |
| `Group` | disclosure row header (was `Disclosure`) |
| `ChangeTray`, `StatusBar` | staged edits; the one live region |
| `ChipInput` | highlights |
| `SwatchChip`, `ColourField`, `PalettePopover`, `HslSliders`, `ContrastRow`, `FixButton` | colour work, used by Make and Brands |
| `SchemeCard`, `SchemeChip`, `PreviewFrame` | `PreviewFrame` scales a same-origin iframe and sets live variables |
| `MotionTile` | preview with still, hover/focus/Play rules |
| `Dialog`, `Drawer`, `Menu`, `ShortcutsSheet`, `useShortcuts` | |
| Kept | `Field`, `ErrorSummary`, `InlineConfirm`, `Message`, `Tag`, `Toaster`, `CharCount`, `Segmented`, `ProgressBar`, `PulseDot`, `SuccessCheck`, api helpers |
| Removed | `PageTitle` / `PageHeader` with the large orange-dot h1, floating save bars, save card, gliding nav `Pill`, `PageEnter`, page-level `Reveal`/`Stagger`, `hoverLift` |

**States:** rest; hover (`--hover`); selected (`--select` + 2px ink edge, `aria-selected` or `aria-current`); focus (ring); pressed (translateY 1px); busy (spinner plus words, "Saving"); error (2px `--bad` edge + icon + message); disabled (ink text, dashed edge, reason line); changed (pencil + "Changed").

### 6.5 App motion (chrome, not videos)

120–200 ms, ease-out, opacity and transform only. Drawers slide 200 ms; popovers 150 ms; status text crossfades (`Swap`). Panels collapse without animation. No page-enter motion, no hover lifts, no staggered lists, no gliding pills. Loops only on working indicators. Reduced motion: everything instant except crossfades.

---

## 7. Keyboard shortcuts

Single-key shortcuts fire only when focus is not in a text field, and can be switched off in the Keys sheet (stored per browser; WCAG 2.1.4). Ctrl on Windows and Linux, Cmd on Mac. Each control with a shortcut has `aria-keyshortcuts`.

**On by default**

| Keys | Action | Where |
|---|---|---|
| ? | Shortcuts sheet | everywhere |
| N | New video (`/make`, focus the brief) | everywhere |
| Ctrl/Cmd + Enter | Make video, or Remake | composer; job with staged changes |
| Ctrl/Cmd + S | Save brand | brand studio |
| Space or K | Play or pause | job |
| 1 / 2 / 3 | 16:9 / 9:16 / 1:1 | job |
| , / . | Previous or next scene (selects and seeks) | job |
| Esc | Close popover, drawer, preview; cancel an inline confirm | everywhere |
| F6 / Shift + F6 | Next or previous region | everywhere |
| Arrow keys, Home, End | Move in strip, bin, palette, scheme grid | lists |

**Listed in the sheet, also on by default but secondary:** `[` `]` `\` (bin, inspector, strip), J / L (back or forward 5 s), C (captions), E (edit selected scene: focus its first field), Ctrl/Cmd + Z and Shift + Z (undo and redo staged edits), F2 (rename scheme or colour), Alt + Arrow (move scheme or colour).

---

## 8. Copy

### 8.1 Rules

1. Plain, direct, colleague to colleague. No exclamation marks, no "please", no "simply", no brochure words.
2. Labels: one to three words. Fields are nouns, buttons are verb plus object ("Make video", "Remake", "Save brand", "Add colour").
3. Hints: one line, at most 12 words, only to prevent a mistake. Never repeat the label.
4. Rules live in the control (counters, chips, disabled with a reason), not in paragraphs.
5. Say a thing once, where it applies.
6. Errors name the thing and the fix, under 15 words: "Use # and 6 characters, like #002D59."
7. No internal words: surface, slot, token, spec, provisional, render queue.
8. British spelling. Digits for numbers. Dates "18 Nov, 10:12" in lists; full `formatDate` in details.

### 8.2 Rewrites

| Today | New |
|---|---|
| "A stand-in voice for checking timing. Replace it with your own commentary before you publish. British voices first, and each video can still pick another." | Brand Voice area: "Stand-in voice to check timing." |
| Make voice hint plus the player warning (twice) | Make Voice field only: "Stand-in voice. Replace it before you publish." Downloads: a "Stand-in voice" tag. |
| "WOFF2 is best; WOFF, TTF and OTF work. Regular and bold at least. Only fonts licensed for video." | "WOFF2, WOFF, TTF or OTF. Licensed for video." |
| "Pixels for a 1080p video; portrait is 20% larger. Text never goes under 42px. Most brands leave these alone." | "Sizes at 1080p. Most brands leave these." |
| "Only if the guidelines allow a one-colour white logo. If there is an official reversed logo, upload that instead." | "Only if your guidelines allow a one-colour white logo." |
| "No single change fixes this. Let the video maker pick each surface's colours, or change the colours above." | "No single fix. Try Suggest schemes." |
| "Tick placeholders the real guidelines have not confirmed yet." | Label "Not confirmed yet", hint "Mark anything the real guidelines haven't confirmed." |
| "Brand id: X. It names the folder and cannot change." | Details fold: "Folder: northvale (fixed)" |
| "Voiceover is captioned word for word. Write dates as 3 March and web addresses without https." | "Captions match these words exactly." plus inline fixes ("Remove https://", "Write dates as 3 March") only when they apply |
| "Words to highlight: up to 3, separated by commas, each exactly as in the main text." | Chip input "Highlights" with "Not in the main text" and "3 at most" |
| "With 4 points, each can have up to N characters…" | The counter shows the shorter limit; no sentence |
| Logo "On light: Not used in videos yet." | "For light backgrounds" (now used by light schemes) |
| "The sample brand. You can change it but not delete it. For a real organisation, add or duplicate a brand." | Tag "Sample" plus "Duplicate it to make a real brand." |
| "The brief does not say enough to make a useful video. It names a topic, but not what is happening…" | Heading "The brief needs more detail", line "Say what's happening and what people should do.", button "Edit brief" |
| "Save script and make the video again" | "Remake" |
| "Use these rules (replaces the current ones)" | "Replace rules" |
| "Temporary voice track" (section) | "Voice" |
| "This step is taking longer than usual. It is still working." | "Still working. This step is slower than usual." |
| "Could not reach the Video maker. Check it is still running (npm run app)." | "Can't reach the video maker. Check it's running." |
| "This brand has problems that stop videos being made. Fix the brand" | "2 problems · Fix the brand" |
| "Show the script" / "Hide the script" | Removed: select a scene |

**Slot labels** (`SLOT_LABELS`): title "Title"; eyebrow "Above title"; subtitle "Under title"; kicker "Small heading"; text "Main text"; support "Supporting line"; action "What to do"; link "Web address"; detail "Extra detail"; heading "Heading"; value "Number"; label "Meaning"; source "Source"; quote "Quote"; name "Name"; role "Role"; items "Points"; emphasis "Highlights"; icon "Icon"; photo "Photo"; clip "Video clip". Where a short label could be ambiguous (Meaning, Source), its field has `aria-describedby` pointing at a visually hidden "What the number means" / "Where the number comes from".

---

## 9. Accessibility (WCAG 2.2 AA minimum, AAA contrast for all text)

- **Contrast:** every text token ≥ 7:1 on every surface it sits on (6.1). Non-text UI ≥ 3:1 (`--edge`). Focus ring ≥ 3:1 against both neighbours (ink plus white ring; yellow on the well).
- **Text:** 16px minimum, 18px body, no opacity on text, no text over imagery outside the video itself. Reflow at 320 CSS px without horizontal page scroll; the strip scrolls inside itself and the Scenes tab is its list alternative.
- **Landmarks:** `header` (top bar), `nav aria-label="Main"`, `aside aria-label="Videos"` or `"Brand areas"` (bin), `main` (monitor), `section aria-label="Scenes"` (strip), `aside aria-label="Inspector"`, `footer role="status"` (status bar). Skip links "Skip to main content" and "Skip to inspector". F6 cycles regions.
- **Headings:** one h1 per view, h2 per region or area, h3 per inspector group. Route changes move focus to the view's h1 (`tabindex="-1"`, no ring).
- **Live regions:** the status bar announces stage changes, every 10% of progress (not every tick), "Your video is ready.", "There was a problem making the video.", "Remake started. Look only." Save status is polite. ErrorSummary is `role="alert"` and takes focus. Toasts are polite and never hold the only copy of anything.
- **Focus management:** as in 3.2 and the existing rules (submit, finish, error, delete, field errors). Drawers and dialogs trap focus and return it. Popovers return focus to their trigger. Sticky bars never cover the focused element (`scroll-padding`, WCAG 2.4.11).
- **Widgets:** tabs (manual activation), listboxes (bin, strip, palette), radiogroups (scheme picker, style picker), switches (`role="switch"`), menu buttons, the HSL sliders as native ranges with `aria-valuetext`, the hex field as the precise path.
- **Media:** captions on by default, VTT track (en-GB), labelled transport buttons, timecode exposed as `aria-valuetext` on the scrubber ("12 seconds of 41").
- **Motion:** previews never autoplay under reduced motion; app motion collapses to instant or crossfade.
- **Dragging alternatives (2.5.7):** every reorder has Move earlier/later and Alt+Arrow; file drop has a button.
- **Targets (2.5.8):** 40 x 40 minimum (24 is the floor).
- **Authentication (3.3.8):** paste and autofill allowed on every password field.
- **Testing (required):**
  - A Playwright scan on every route at 1440 x 900 and 390 x 844: for every visible text node, the computed colour against its effective background is ≥ 7:1, the computed font size is ≥ 16px, and no ancestor has opacity < 1 (outside motion). Fails the e2e run.
  - A unit test that parses `styles.css` and `server/shell-css.ts` tokens and asserts the 6.1 ratios.
  - axe-core in e2e (serious or critical fail) when `@axe-core/playwright` can be added as a small dev dependency.
  - Keyboard-only journeys: make a video, change scene 2's scheme and remake, fix a failing scheme, save a brand.

---

## 10. Implementation plan

No commits, pushes or ssh. Do not edit `packaging/`, `.github/`, `.vellum/`, `home-server/` or `web/`. HyperFrames stays at 0.9.8; no `npm audit fix`. Each owner uses their own port for servers and stops them when done.

### 10.1 Order, with a gate after each step

1. **Colour core, schema v2, migration, scheme CSS** (A). Gate: demo compiled scene HTML is string-identical before and after migration; `npm run typecheck`, `selftest`.
2. **Recommender and `assignSchemes`** (A). Gate: HMCTS fixture (4.4); no equal neighbours where avoidable; same scheme on title and end.
3. **Relook mode and JobView `plan`** (A). Gate: a scheme-only PUT runs from `timing`, skips voice, and produces new MP4s.
4. **Shell and router** (B), then **Make** (C) and **Brands** (D) in parallel against the contract in 10.6. Gate: `app:typecheck`, `app:build`, `e2e -- --no-video`, contrast scan.
5. **Motion** (A engine, C and D tiles): resolver with Calm = today (E arrays equal for the demo), then one new array at a time, each with motion-check and verify windows. Gate: a Crisp, a Lively and a Still job on demo and on a local `brands/hmcts` pass lint, motion-check and verify at 60 fps in all three formats.
6. Full `npm run e2e` once, then screenshots at 1440 x 900 and 390 x 844 of `/make`, `/v/:id` (busy, error, done, Look tab), `/videos`, `/brands`, `/brands/demo/colours`, `/brands/hmcts/colours`, `/brands/demo/motion`, `/settings`, `/login`, looked at by eye: no page scroll on desktop, all text dark.

### 10.2 Owner A: engine and server

| File | Change |
|---|---|
| `engine/colour-core.ts` (new, pure, no imports) | `contrastRatio`, `luminance`, `parseHex`, `toHex`, `colourDifference`, `mixWithWhite`, `suggestPassingColour`, `AAA`, `AAA_SAFE`, `MIN_HIGHLIGHT_DIFFERENCE`, `resolveRef`, `tone`, `strong`, `schemeVars`, `logoVariant`, `expandPalette` |
| `engine/contrast.ts` | re-exports from colour-core |
| `engine/motion-rules.ts` (new, pure) | preset registry data, allowed-on tables, the lint predicates used by both lint.ts and the UI |
| `engine/schema.ts` | V1 kept, V2 added (4.1), union at the boundary; motion enums; `SceneTiming` widened (`transitionIn`, `scheme`, `schemeAuto`, `entrance`, `textEffect`, `shape`, `transitionColour`) |
| `engine/brand/migrate.ts` (new) | 4.3 |
| `engine/brand.ts` | `parseBrand` via migrate; `LoadedBrand.colour(ref)`, `scheme(id)`, `schemes()`, `usableSchemes()`, `bookendSchemes()`; checks 4.2; `brandCss` 4.1 |
| `engine/brand/recommend.ts` (new) | 4.4 |
| `engine/brand/palette.ts` | keep `assignColourRoles`/`proposeSurfaces` for v1 import and the classic page |
| `engine/brand/fixes.ts` | pairs over `schemes[]` and captions; paths `schemes.<id>.text|highlight|shape`; recolouring a tint converts the ref to an explicit new colour ("Navy (darker)") unless recolouring the base breaks nothing |
| `engine/brand/store.ts` | `createBrand` writes v2 (palette from input colours; blank palette ids `primary, text, background, accent, tint`; schemes from `recommendSchemes`, top 4; `mode: "spread"`); logo "both" check per scheme tone; placeholder and reverse logo use the darkest and lightest palette colours |
| `engine/brand/guidelines.ts`, `engine/brand/import.ts` | 4.5 |
| `engine/schemes.ts` (new) | `assignSchemes` (4.6) |
| `engine/scenes/*.ts`, `types.ts` | scheme-local variables only; element roles; `legacyScheme`, `schemeNeed`, `hasShape` |
| `engine/compile.ts` | scheme classes, body background, logo by tone, `captionHighlight` over schemes, arrays M P S T K G, word and digit markup, `compileStill(scene, brand, format, { scheme?, live? })`; `checkSceneCss` allowed list |
| `engine/motion.ts` | registry, styles, `resolveMotion` |
| `engine/motion-preview.ts` (new) | 5.9 |
| `engine/transitions.ts`, `engine/timing.ts`, `engine/sheet.ts`, `engine/lint.ts` | 5.3, 5.6, 5.7 |
| `engine/spec.ts` | 4.7 |
| `engine/interpret/prompt.ts`, `engine/interpret/index.ts` | strip fields; `motionStyle` line |
| `engine/api.ts` | `brandBriefing` lists palette names ("for reference only"); `previewBrand` takes `scenes`, `formats`, `scheme`; exports |
| `engine/pipeline.ts` | nothing new beyond reading the plan; `from: "timing"` already exists |
| `config/engine.json` | `timing.transitions` |
| `server/index.ts` | SPA fallback route; routes in 10.6 |
| `server/jobs.ts` | `size`, `look` on create; `relook` mode and `STAGE_OF`; `retry` keeps mode; JobView `plan`, `look`, `mode`; scene preview; look check |
| `server/brands.ts` | swatch from the first core colour; recommend, scheme preview, motion preview routes; preview cache pruning |
| `server/guidelines.ts` | model schema: `group`, `tintOf`, `colourRules` |
| `scripts/selftest.ts`, `icons-check.ts`, `icons-sheet.ts`, `motion-check.ts`, `verify.ts` | scheme paths; recommender for demo; new arrays |
| `scripts/migrate-check.ts`, `scripts/recommend-check.ts`, `scripts/motion-lint-check.ts` (new) | gates in 10.1 |
| `docs/CONTRACTS.md` | scheme variables, brand v2 table, motion, transitions, API |
| `docs/design/motion-library-decision.md` (new) | draft decision record extending dec-002, for the owner to file (`.vellum/` is off limits) |

Test brand: create the local `brands/hmcts` (gitignored) from `~/Desktop/aa/brand-guidelines-colour (2).pdf` through the import path (copy the PDF to a temp folder first; never write to `~/Desktop/aa`).

### 10.3 Owner B: shared UI, shell and server pages

| File | Change |
|---|---|
| `ui/index.html`, `ui/vite.config.ts` | single entry; drop `brands.html`; alias `@engine-core` → `engine/colour-core.ts` and `engine/motion-rules.ts` |
| `ui/src/main.tsx` (new) | router plus shell; replaces `make/main.tsx` and `brands/main.tsx` |
| `ui/src/shared/router.tsx` (new) | `useRoute`, `navigate`, `Link`, legacy redirects |
| `ui/src/shared/shell/*` (new) | `AppShell`, `WorkspaceTabs`, `Panel`, `StatusBar`, `Drawer`, `Dialog`, `Menu`, `ShortcutsSheet`, `useShortcuts`, `useRegions` |
| `ui/src/shared/colour/*` (new) | `SwatchChip`, `ColourField`, `PalettePopover`, `HslSliders`, `ContrastRow`, `FixButton`, `SchemeChip`, `SchemeCard`, `PreviewFrame` |
| `ui/src/shared/MotionTile.tsx` (new) | |
| `ui/src/shared/styles.css` | tokens 6.1–6.3; remove the 720 measure and page-column layout |
| `ui/src/shared/theme.ts` | ink primary, radii 6/10, 18px body, Button radius 6 |
| `ui/src/shared/motion.tsx` | trimmed (6.5) |
| `ui/src/shared/ui.tsx` | keep the listed components; `Disclosure` → `Group`; remove `PageTitle`, `PageHeader`, `Pill` |
| `ui/src/shared/api.ts` | 401, 403, 503 handling; new copy; new types |
| `ui/src/shared/DESIGN.md` | rewritten (done with this spec) |
| `server/auth.ts`, `server/settings-pages.ts`, `server/shell-css.ts` (new) | `pageShell` markup, CSS and copy only (3.8) |
| `server/test/e2e.ts` | contrast and size scan; shared route helpers |

### 10.4 Owner C: Make

| File | Change |
|---|---|
| `ui/src/make/MakeWorkspace.tsx` | route component for `/make` and `/v/:id`; owns polling (1 s, 3 s after an error), tab title, notification |
| `Composer.tsx`, `SettingsTab.tsx`, `MediaTab.tsx`, `LookTab.tsx` | 3.1 |
| `JobMonitor.tsx`, `ProgressCard.tsx`, `ErrorCard.tsx` | 3.2 states A–D |
| `SceneStrip.tsx` | timeline |
| `Inspector.tsx`, `SceneTab.tsx` (from `ScriptEditor.tsx`: draft model and `collect()` keep `scheme`, `motion`, `look`), `SceneLookTab.tsx`, `VideoTab.tsx`, `ChangeTray.tsx` | |
| `useJob.ts`, `useStagedSpec.ts` | undo stack; diff to "look" or "words" |
| `BinVideos.tsx`, `ui/src/videos/Library.tsx` | bin and `/videos` |
| Kept | `Segmented.tsx`, `ConfirmDelete.tsx`, `types.ts` (extended with `plan`, `look`, `mode`) |
| `make.css` | replaced by scoped styles for the workspace |

### 10.5 Owner D: Brands

| File | Change |
|---|---|
| `ui/src/brands/BrandsWorkspace.tsx` | `/brands`, `/brands/:id/:area`; bin with areas and save footer; Ctrl/Cmd+S; leave guard; live check; Preview panel |
| `BrandGallery.tsx`, `NewBrandForm.tsx` | |
| `context.ts` | area routing and selection; `sectionFor`: `^palette|^schemes|^schemeUse|^captions` → colours, `^motion` → motion |
| `areas/Overview.tsx`, `Guidelines.tsx`, `Colours/{Palette,ColourInspector,SchemeGrid,SchemeInspector,Suggestions,Captions,ContrastTable}.tsx`, `Motion.tsx`, `Type.tsx` (from fonts.tsx), `Logo.tsx`, `Icons.tsx`, `Voice.tsx`, `Writing.tsx`, `Checks.tsx` | 3.4–3.6 |
| Removed | the 7 role rows and surface selects in `colours.tsx`; `brands.css` replaced by scoped styles |

### 10.6 API contract (JSON; errors keep `{ error, ...extra }`; nothing saves unless stated)

**Meta and motion**

```jsonc
// GET /api/meta  (adds to today's shape)
{
  "lengths": [{ "id": "auto", "label": "Auto" }, { "id": "short", "label": "Short", "min": 15, "max": 25 }, ...],
  "scenes": [{ "type": "stat", "legacyScheme": "tint", "schemeNeed": "prefer-pale", "hasShape": false, ... }],
  "motion": {
    "styles":      [{ "id": "calm", "label": "Calm", "line": "Gentle fades and rises. Crossfades." }],
    "entrances":   [{ "id": "slide", "label": "Slide", "roles": ["headline", "body", "item", "accent", "eyebrow"] }],
    "transitions": [{ "id": "sweep", "label": "Colour sweep", "seconds": 1.0, "nextToMedia": false }],
    "textEffects": [{ "id": "count", "label": "Count up", "scenes": ["stat"] }],
    "shapes":      [{ "id": "grow", "label": "Grow" }]
  }
}
```

**Jobs**

```jsonc
// POST /api/jobs  multipart, adds fields:
//   size = auto|short|medium|long, look = '{"schemes":"single","scheme":"navy","motionStyle":"calm"}'
// → 201 JobView

// GET /api/jobs/:id → JobView, adds:
{
  "job": { "mode": "full" | "rerender" | "relook", ... },
  "look": { "schemes": "spread", "scheme": null, "motionStyle": "calm" },
  "plan": {
    "scenes": [{
      "index": 2, "id": "s3", "type": "points", "label": "Points", "beat": "problem",
      "start": 9.4, "duration": 6.2,
      "scheme": "golden-10", "schemeAuto": true,
      "transitionIn": "crossfade", "transitionSeconds": 0.5,
      "motion": { "entrance": "rise", "text": "none", "shape": "none" },
      "stills": { "16x9": "/job-files/ID/review/stills/16x9/s3.png", "9x16": null, "1x1": null },
      "problems": []
    }],
    "schemes": [{ "id": "golden-10", "name": "Golden 10%", "usable": true, "bookends": false,
                  "vars": { "--bg": "#FEF7E6", "--fg": "#002D59", "--hl": "#002D59", "--shape": "#FEEBBF",
                            "--icon": "#002D59", "--hl-weight": "700", "--underline": "#002D59" } }]
  } // null until timeline.json exists
}

// PUT /api/jobs/:id/spec  { "spec": {...} }  (shape unchanged)
// → 200 JobView + { "remake": "look" | "words" }
// → 400 { "error": "...", "problems": ["Scene 3: ..."],
//         "fields": [{ "scene": 3, "slot": "scheme" | "motion.text" | "text", "item": 0, "message": "..." }] }
// → 409 while queued or running

// POST /api/jobs/:id/scene-preview  { "scene": 3, "scheme": "blue-25", "format": "16x9" }
// → { "url": "/previews/<jobId>-scene-<hash>/s3-16x9.html", "width": 1920, "height": 1080, "issues": [] }

// POST /api/jobs/:id/look-check  { "spec": {...} }
// → { "problems": [{ "scene": 3, "field": "motion.text", "message": "Word by word works on short titles only." }] }
```

**Brands**

```jsonc
// GET /api/brands → [{ ..., "primary": "#0096D6" /* first core colour */, "schemes": 6 }]

// GET /api/brands/:id → today's shape, with:
{
  "raw": { "schemaVersion": 2, ... },          // always migrated
  "migrated": true,
  "palette": [{ "id": "golden", "name": "Golden", "value": "#F9AE00", "group": "accent",
                "tints": { "t10": "#FEF7E6", "t25": "#FEEBBF" } }],
  "check": {
    "ok": true,
    "issues": [{ "level": "warning", "field": "schemes.navy.highlight", "message": "Close to the limit" }],
    "contrast": [{ "id": "schemes.navy.highlight", "label": "Navy: key words", "result": { "ratio": 7.29, "ratioText": "7.3 to 1", "passesAAA": true, ... } }],
    "fixes": { "schemes.navy.highlight": [{ "kind": "use", "label": "Use Golden 25% for key words (11.8 to 1)", "path": "schemes.1.highlight", "colour": "golden.t25", "mends": ["schemes.navy.highlight"] }] },
    "schemes": [{ "id": "navy", "usable": true, "bookends": true, "tone": "dark" }]
  }
}

// PUT /api/brands/:id  { "brand": v2 draft } → { "saved": boolean, "raw", "check", "files" }  (unchanged shape)

// POST /api/brands/:id/schemes/recommend  { "brand"?: draft, "useRules"?: true, "limit"?: 6 }
// → { "schemes": [{ "id": "golden-10", "name": "Golden 10%", "background": "golden.t10", "text": "navy",
//                   "highlight": "navy", "emphasis": "weight", "shape": "golden.t25", "fit": "any", "logo": "auto",
//                   "score": 82, "reasons": ["Pale golden, navy text, bold key words"],
//                   "contrast": { "text": 12.94, "highlight": 12.94, "icon": 11.75 } }],
//     "nearMisses": [{ "scheme": {...}, "problem": "Text 6.4 to 1", "fix": { "path": "text", "value": "#..." } }],
//     "rules": { "text": ["navy", "black", "white"] }, "notes": [] }

// POST /api/brands/:id/schemes/preview  { "brand": draft, "scheme": "navy" | {Scheme}, "scene"?: "statement", "format"?: "16x9" }
// → { "url": "/previews/<id>-s-<hash>/statement-16x9.html", "width": 1920, "height": 1080,
//     "vars": { "--bg": "#002D59", ... }, "logo": "onDark", "issues": [] }

// POST /api/brands/:id/motion/preview  { "brand"?: draft, "kind": "style", "id": "crisp", "scheme"?: "navy", "format"?: "16x9" }
// → { "url": "/previews/motion/<id>-<hash>/style-crisp.html", "seconds": 6 }

// POST /api/brands/:id/preview  { "brand", "scenes"?, "formats"?, "scheme"?, "caption"? }  (passes options through)

// POST /api/brands/:id/guidelines → suggestions add:
//   "colours": [{ "value", "name", "role"?, "group": "accent", "tintOf"?: "golden", "context" }],
//   "colourRules": { "text": ["navy", "black"], "never": [...], "source": "..." }

// POST /api/brands/:id/propose-surfaces  kept for /classic (returns v1 surfaces); the new UI does not call it.
```

All other routes keep their current shape.

### 10.7 e2e hooks (`server/test/e2e.ts`)

**Kept exactly:** `#brief`, label "What is the video about?", native select labelled "Brand", `#make-button` ("Make video"), alert text "Describe the video in at least one sentence", h1 "Make a video", `#formats`, `#format-*`, `#media`, `#job-title`, `#job-head .tag`, `#progress-h`, `.progress-text`, `[role=progressbar]` with `aria-valuenow`, `.steps li` with `active`/`done` and the label in the second span, `#job-error`, `#job-videos .format-switch` radios named Landscape 16:9 / Portrait 9:16 / Square 1:1, `video[data-format]` (exactly one), links named "Download MP4…" (current format) and "Download subtitles…", `#videos-title`, `#job-subtitles`, `#script-form`, `s{n}-{slot}`, `textarea[data-vo]`, `#history a`, `data-job`, `data-delete`; h1 "Brands", brand card heading "Northvale Council", label "Name of the organisation or brand", "Create brand", h1 "Edit {name}", `#preview` with 9 iframes, text "Fails AAA", buttons `^Change .* to #`, `#sec-colours`, `#sec-*-h`, `#f-name`, "Save brand", status text starting "Saved", `#icon-upload`, "Upload icons", `.icon-grid .name`, `#logo-upload`, `input[name="logo-for"]`, "Upload logo", `#logo-onDark`, `#guidelines-file`, "Read guidelines", `#suggestions`, `#suggestions-h`, "Use the chosen suggestions", "Delete brand", group `^Delete `, "Yes, delete this brand", text "has been deleted", `#propose-button`, `#surface-selects` (on the scheme grid), `#contrast`, `#checks`, `#save-button`, `#save-status`.

**Test edits in the same change:**
- Brand id: read it from the path (`/brands/:id/...`) instead of `searchParams.get("brand")`.
- Before filling `#c-accent-hex` and before reading `#c-primary-hex`, click the palette chip for that colour to open the colour inspector.
- Before checking "Why this length:" and `.sheet img`, open the Video tab's "Length" and "Files" groups.
- Remake: replace "Show the script" with selecting scene 1 in the strip, and "Save script and make the video again" with "Remake".
- `--rerender` gains a step: change scene 2's scheme in Look, Remake, assert `job.mode === "relook"` and that the voice stage was not run again.
- Add the contrast and size scan (9) on each route visited.

### 10.8 Risks to settle during the build

1. Push makes the outgoing scene animate: confirm z-order and that HyperFrames keeps it visible through the overlap (5.3).
2. Count up's digit columns must match the plain value's box within 1 px in every format; otherwise the resolver falls back to `settle` (5.4).
3. The live-variable preview must use `colour-core.schemeVars`, the same function `brandCss` uses, or cards and renders drift. Tone flips re-fetch the still.
4. `ColourId` is lowercase; the import must slugify guide names ("HMCTS blue" → `hmcts-blue`) and avoid clashes.
5. Length forcing must stay small: the interpreter gets the target size as a hint; `facts.requestedSize` is set after interpretation; `makeDecision` already honours it.
6. Settings restyle: template strings and CSS only; a reviewer checks the diff against the list in 3.8.

---

## Decisions made during build

### Engine and server (owner A)

1. **"Byte-identical" gate.** Scene CSS now uses scheme variables, so compiled HTML cannot be byte-identical to the old code. The gate is instead: (a) the demo compiles to the same HTML from its version 1 file and from its migrated version 2 file (selftest), (b) all 30 demo scene stills (10 types × 3 formats) are pixel-identical to the pre-change build, and (c) the demo jobs (demo-short, demo-medium, standup-medium) produce identical timelines and identical entrance, crossfade, wipe, drift and caption arrays under Calm.
2. **Migrated scheme shapes.** Version 1 drew icon circles in the tint colour. On the migrated Dark scheme the icon colour (the highlight) cannot be seen on that tint, which would make Dark unusable, so its shape becomes its own background (the icon sits on the background). Light keeps the tint; Soft's shape equals its background and gets the spec's "The shape barely shows" warning.
3. **Scheme problems are errors with `blocking: false`.** A failing scheme is reported at level `error` (it must be fixed to be used) with `blocking: false`; `check.ok` ignores those. Brand-level problems stay blocking.
4. **`--hl-weight` is always a number** (the heading weight for colour-only key words), never `inherit`, so a live preview on `:root` behaves like a scheme class.
5. **Bold key words need lighter headings.** `emphasisWeightAvailable` is true only when a heading face at least 200 heavier than the heading weight exists; otherwise the recommender uses coloured key words. The HMCTS test brand uses heading weight 400 and `emphasisWeight` 700, which is HMCTS's own look (regular headline, bold key words).
6. **Recommender tuning (4.4).** Within the spec's method: readability counts up to 10 to 1 (beyond that more contrast is not visible); core colours prefer their 25% tint and other colours their 10% (presence without loudness); pale tints of the strong scheme's key-word and shape colours get a coherence bonus, and one neutral grey tint a calm bonus; variety is measured by hue (pale tints of different hues are not alike); key words on deep backgrounds prefer an accent, on light backgrounds a core colour; the strong scheme is chosen core first, then chromatic, black and grey last; on deep backgrounds white text is always allowed (a guide's text rule is about light backgrounds). Output order: the first three pale schemes, then the strong one, then the rest, so the first four are a complete set and `createBrand` takes them. The HMCTS fixture passes with the guide's own tints and with computed tints.
7. **Brand-level motion choices are defaults, not explicit choices.** They apply to every video, so a refused combination is made calmer (with a note) rather than failing a video. Only `scenes[].motion` can fail lint.
8. **Resolver file.** `resolveMotion` lives in `engine/motion-plan.ts` (not `motion.ts`) to avoid an import cycle between the motion presets and the scene registry.
9. **Edge speed limit 212.** The house wipe (0.8 s, unchanged) peaks at 211 px a frame in its first frame, so the limit is 212 ("about 210", dec-002), not 210.
10. **Underline draws one bar per key word** (each word an inline-block). A bar joined across the space hangs past the end of a line when a run wraps.
11. **Sideways moves have no compositor layer** (Slide, Drift): measured shimmer otherwise. See `docs/design/motion-library-decision.md`.
12. **Count up** measures the line height in the page (rounded to whole pixels) and moves each digit strip by whole lines: `K` is `[column, digit, duration, at]`. Stills show the plain number (the settled state).
13. **Scene numbers in the API are 0-based indexes** everywhere (`plan.scenes[].index`, `fields[].scene`, `scene-preview`, `look-check`); messages say "Scene 3" for people. `scene-preview` also accepts a scene id.
14. **Relook** happens only when the spec is unchanged apart from `scenes[].scheme`, `scenes[].motion`, `look` and `title`, and the job still has its voice and alignment files; otherwise it is a normal remake.
15. **Previews.** Scheme cards are cached by page content (`<brand>.s-<hash>`, 40 newest kept); full previews are `<brand>.full-<stamp>` (4 newest), job scene previews `job.<id>.<hash>` (30 newest), motion previews under `/previews/motion/<brand>-<hash>/` (60 newest). Motion preview scenes hold 3.2 s each (a 3 s tile, 6 s for pairs) rather than their reading time.
16. **Guide colour structure.** PDF guides named for colours are now read as guidelines. Groups come from short headings ("Core colours", "Design colour palette" with "secondary colours" in its first line); in a core section, colours not named in its first sentence become accents (HMCTS: blue, navy and black core; green, magenta, golden, purple accent). Listed tints within ΔE 3 of the computed mix are dropped, others kept as `tintValues`. A text rule plus a mention of white text for titles adds White to `rules.text`.
17. **Long placeholder wordmarks** (HM Courts & Tribunals Service) overflowed portrait end cards. Title and end-card logos now have `max-width: 100%` with `object-fit: contain`; logos that fit are unchanged (demo stills identical).
18. **Tints for new palettes.** Every colour except white and black gets 10% and 25% tints (a grey's 10% tint is a calm background).
19. **Push moves whole scenes by whole pixels, with no compositor layer.** Scenes that came in with a Push kept a slight shimmer on their settled text (191 of 192 settled frames changed); after the fix at most 14 change, all captions or highlights.

### Shell, Make and Videos (owners B and C, MVP)

1. **Shell API.** `AppShell` lives in `ui/src/shared/studio.tsx` (with `Panel`, `Toolbar`, `InspectorTabs`, `Group`, `useShortcuts`, `usePanels`); the router in `ui/src/shared/router.tsx`. DESIGN.md "Shell API" is the reference. `Shell` in `ui.tsx` stays as a document-style fallback.
2. **Narrow screens.** Below 1024 wide (or 640 tall) the regions stack in one scrolling column: monitor, strip, status, inspector, bin. Drawers, the phone Scenes / Edit / Video tabs and the bottom nav are not built yet.
3. **Staged edits** (`useStaged`) compare the built spec with the script as the editor would write it back, so whitespace tidying is never a change. Undo and redo (Ctrl/Cmd+Z, Shift+Z) step through staged edits.
4. **Leave guard** is an in-app dialog through `addNavigationGuard`, plus `beforeunload`.
5. **Highlights** stay a comma-separated text field with inline checks ("3 at most", "Not in the main text"); the chip input is not built yet.
6. **Server pages.** `pageShell(title, body, focusId, { nav })` gains an optional fourth argument that only adds the top bar links; the CSS is inline in `pageShell` (no `server/shell-css.ts` yet). No form, check, cookie or script changed.

### Integration (MVP, 18 November)

1. **Regions are positioned** (`.region { position: relative }`), so visually-hidden text (absolute) stays inside its scrolling region. Before, it made the whole page scroll by up to 1,500 px on Make and Colours, and scrolling a field into view nudged the top bar off screen.
2. **Scene preview in the monitor** is measured against the space it has and drawn whole and centred (`PreviewFrame` in `JobWorkspace.tsx`); it was cut off at the bottom.
3. **Scene strip stills** show one still at its own shape on the scene's background colour, not a cropped sliver.
4. **The scheme panel's Scene and Format selects stack** in the narrow inspector (`.region--inspector .two-up`), so "Statement" is not cut off.
