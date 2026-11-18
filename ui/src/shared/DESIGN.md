# Video maker design rules: Daylight Studio

**Feel:** a calm, light editing studio. Premiere's layout, run in daylight. **Verb:** describe a video, see it, adjust it.
**Signature:** the orange dot. It sits in the wordmark, caps the playhead, marks the playing scene, and breathes (`<PulseDot>`) while work is happening. Orange is only ever a mark. Never use it for text.

The full build spec is `docs/design/studio-spec.md`. This file is the short version you keep open while building.

## Hard rules
- **Text is 7:1 or more and 16px or more.** Body text is 18px. Use `--ink` for text and `--ink-2` for meta and hints. Nothing paler exists. No `opacity` on text, no faded placeholders, no faded disabled labels.
- **Workspace, not a document.** The old "one column, no side panels" rule is retired. Every workspace uses the same regions (below). On desktop the page does not scroll; panels scroll on their own.
- **Light studio.** White panels, near-black text. The only dark area is the monitor well, and it holds only video and white controls. No dark theme.
- **Show what is needed now.** Everything else goes behind a labelled group, tab or menu. Never hide something a person needs to finish the task.
- **Short copy.** Labels of three words or fewer. A hint only when it prevents a mistake, one line. Rules live in the control (counters, chips, disabled with a reason), not in paragraphs.
- **One primary action per view.** Make video, Remake or Save brand.
- **Keyboard and screen readers:** real `<label>`s, visible focus (styles.css draws it; don't override it), F6 between regions, `aria-live` through the status bar, `ErrorSummary` plus inline errors, focus moved after every action.
- **Meaning is never colour alone.** Always an icon plus a word ("Fails AAA: 4.2 to 1").

## Regions
| Region | Size | Job |
|---|---|---|
| Top bar | 56 tall | Wordmark, workspace tabs (Make, Videos, Brands, Settings), Keys, account |
| Bin | 280 wide, `[` | The list: videos, or a brand's areas plus the save footer |
| Monitor | flex | The thing you are looking at: composer, progress, video, area canvas |
| Strip | 168 tall, `\` | The scene timeline. Only on a job with a script |
| Inspector | 360 wide, `]` | Properties of the selection, in tabs. Absent when a view has nothing to inspect |
| Status bar | 32 tall | One line, `role="status"`. Job state and progress. Make workspace only |

- A region with nothing to show is absent, never empty chrome.
- Selection drives the inspector. Nothing selected shows the view's defaults (Video tab, or the brand Preview panel).
- Panels sit on `--app` with 8px gaps and a 1px `--rule` border. No panel shadows.
- **1024–1279:** the bin becomes a drawer. **768–1023:** the inspector becomes a drawer too. **Under 768:** monitor pinned at the top, tabs for Scenes / Edit / Video, bottom nav, 16px gutters, no horizontal page scroll (only the strip scrolls sideways, inside itself).
- Drawers and dialogs trap focus, close on Esc and return focus to the opener.

## Tokens (styles.css `:root`)
| Token | Value | Use | Contrast |
|---|---|---|---|
| `--app` | #E7EAEE | behind panels | ink 15.1 |
| `--panel` | #FFFFFF | panels, cards, inputs | ink 18.2 |
| `--panel-2` | #F3F4F6 | headers, toolbars, zebra | ink 16.5 |
| `--well` | #11161B | monitor surround only | white 18.2 |
| `--ink` | #11161B | all text and icons, primary buttons | |
| `--ink-2` | #2B3138 | meta and hints | 13.1 panel, 10.6 select |
| `--link` | #0A4A73 | links, selected tab underline | 9.4 panel, 7.6 select |
| `--select` | #DBE9F3 | selected row, clip, card (with a 2px ink edge) | ink 14.7 |
| `--hover` | #EEF3F7 | hover fill | ink 16.3 |
| `--edge` | #5C6670 | control borders (non-text 3:1+) | 5.9 panel |
| `--rule` | #C9CED4 | decorative dividers only | |
| `--mark` | #E8651A | the dot, playhead cap. Never text | |
| `--ok` / `--ok-tint` | #1D5236 / #E6F1E9 | pass | 7.8 |
| `--bad` / `--bad-tint` | #7A1A1A / #F9EAE7 | fail, delete | 9.0 |
| `--warn` / `--warn-tint` | #5A3D00 / #F8F0DA | to check | 8.8 |
| `--info-tint` | #E9EEF1 | preview banners, ink text | ink 15.6 |

Focus: 3px `--ink` outline with a 2px white inner ring; `#FFD84D` outline on the well (13.2:1). Never removed.

**Type:** Open Sans Variable. Composer h1 28/700. Workspace title 20/700. Area heading 22/700. Panel and group headings 18/700. Body and inputs 18/28 (brief box 20). Labels, tabs, status 16/600. Meta and hints 16/400. Tabular numbers for times, sizes, ratios. No uppercase micro-labels.

**Space:** 4, 8, 12, 16, 24, 32, 48. Panel padding 16 (inspector 20). Groups 24 apart, fields 16 apart. Pick from the scale; no magic numbers.

**Size:** controls 40 tall (44 on phone; primary buttons 44). Icon buttons 40 x 40 with `aria-label` and a tooltip. Preview tiles at least 160 x 90. Strip clips at least 120 x 112.

**Radius:** 6 inputs, buttons, chips. 10 cards, clips, popovers. 999 switches and tags.

**Depth:** panels are flat. Only floating layers (popovers, menus, drawers, dialogs) get `0 8px 24px rgba(17,22,27,.18)` plus a 1px `--edge` border.

## Shell API (built: `studio.tsx`, `router.tsx`, `studio.css`)
One React app (`ui/src/main.tsx`, one Vite entry `ui/index.html`). Each workspace renders one `<AppShell>`; it brings the providers, top bar, skip links, F6 region cycling, `[` `]` `\` panel toggles (stored in `va-panels`), the Keys sheet (`?`) and the toaster.

```tsx
<AppShell
  workspace="brands"                              // current top tab: make | videos | brands | settings
  bin={{ label: "Brand areas", content: <…/> }}   // <aside aria-label>, 280 wide; omit for none
  monitor={<…/>}                                  // <main id="main">, required; put the view's h1 here
  strip={<…/>}                                    // optional, full width under the row (Make only)
  inspector={{ label: "Inspector", content }}     // <aside id="inspector">, 360 wide
  status={<…/>}                                   // optional one-line footer, role="status"
  modals={<…/>}                                   // dialogs rendered after the frame
/>
```
- **Inside regions:** `Panel` (header with title and actions, scrolling body, optional footer), `Toolbar` (48px bar at the top of the monitor; its h1 is the workspace title), `InspectorTabs` (`tabs=[{id,label,badge,content}]`, `value`, `onChange`; manual activation), `Group` (h3 disclosure, kept mounted), `HidePanelButton` / `ShowPanelButtons`, `usePanels()`.
- **Keys:** `useShortcuts({ "mod+s": save, n: …, escape: … })`. Single keys skip text fields and obey the Keys sheet switch. Return `false` to let a key through.
- **Router:** `useRoute()` → `{ workspace, path, params: { jobId, brandId, area }, query }`; `navigate(to, { replace })`; `setQuery({ scene: "3" })` (replaceState); `<Link to>`; `addNavigationGuard(fn)` (return false to stay, for unsaved changes). `/?job=ID` is rewritten to `/v/ID` on load.
- **Below 1024 wide** the regions stack in one scrolling column (monitor, strip, status, inspector, bin). Drawers, the phone tab bar and bottom nav are not built yet.
- **Engine maths:** import `@engine-core/colour-core` or `@engine-core/motion-rules` (Vite alias and tsconfig path to `engine/`).
- `Shell` in `ui.tsx` is a document-style fallback (top bar plus one column) for pages not yet split into regions.

## Components
- **Shell (planned names from the spec):** `AppShell`, `WorkspaceTabs`, `Panel`, `StatusBar`, `Drawer`, `Dialog`, `Menu`, `ShortcutsSheet`, `useShortcuts`, `useRegions`.
- **Lists and selection:** `BinList` (listbox, roving tabindex, row More menu), `SceneStrip` with `Clip` and `TransitionMarker`, `InspectorTabs` (WAI-ARIA tabs, manual activation), `Group` (disclosure row; was `Disclosure`).
- **Media:** `Monitor`, `Transport`, `PreviewFrame` (scaled same-origin iframe, live scheme variables), `MotionTile` (settled still; plays on hover, focus or Play; never autoplays under reduced motion).
- **Colour:** `SwatchChip`, `ColourField`, `PalettePopover` (every option shows its ratio), `HslSliders` (native ranges, `aria-valuetext`), `ContrastRow`, `FixButton`, `SchemeCard`, `SchemeChip`.
- **Editing:** `ChipInput` (highlights), `ChangeTray` (staged edits, undo per change, Remake).
- **Kept from before:** `Field`, `ErrorSummary`, `InlineConfirm`, `Message`, `Tag`, `toast`/`Toaster`, `CharCount`, `Segmented`, `ProgressBar`, `PulseDot`, `SuccessCheck`, the api helpers.
- **Gone:** the 44px page h1 with the dot (`PageTitle`, `PageHeader`), save cards, floating save bars, the gliding nav pill, page-enter motion, hover lifts.
- Buttons are Mantine `<Button>`: primary (ink) is the default, secondary `variant="default"`, tertiary `variant="subtle"`. Use `loading` with a word for busy states ("Saving").

**States:** rest; hover `--hover`; selected `--select` + 2px ink edge + `aria-selected`/`aria-current`; focus ring; busy (spinner plus words); error (2px `--bad` edge, icon, message); disabled (ink text, dashed `--edge` border, a visible reason line); changed (pencil plus "Changed").

## Copy
- Plain, direct, colleague to colleague. No exclamation marks, no "please", no "simply", no brochure words.
- Labels: one to three words. Buttons: verb plus object ("Make video", "Remake", "Add colour").
- Hints: one line, 12 words at most, only to stop a mistake. Never repeat the label.
- Say a thing once, where it applies. Errors say what to do: "Use # and 6 characters, like #002D59."
- No internal words: surface, slot, token, spec, provisional.
- British spelling, digits for numbers, dates "18 Nov, 10:12" in lists.

## Keyboard
Single-key shortcuts fire only outside text fields and can be switched off in the Keys sheet. On by default: `?` sheet, `N` new video, Ctrl/Cmd+Enter make or remake, Ctrl/Cmd+S save brand, Space or `K` play, `1` `2` `3` formats, `,` `.` previous and next scene, Esc close, F6 regions, arrows in lists. Secondary (listed in the sheet): `[` `]` `\` panels, `J` `L` seek, `C` captions, `E` edit scene, Ctrl/Cmd+Z undo staged edits, F2 rename, Alt+Arrow reorder. Set `aria-keyshortcuts` on each control.

## App motion (motion.tsx): "Quiet-Clear"
- 120–200ms, ease-out, opacity and transform only. **No bounce.**
- Use it for drawers (200ms), popovers (150ms) and status text that changes (`Swap`). Panels collapse without animation.
- Loops only on working indicators (`PulseDot`, spinners, indeterminate `ProgressBar`).
- Motion never blocks input or delays focus. Move focus right away.
- Reduced motion is handled by `MotionRoot` (reducedMotion="user") and the CSS kill switch: everything becomes instant or a crossfade.
- Don't animate on scroll, on page enter, or on hover. Don't stagger lists. Don't glide nav pills.

Video motion (the engine's presets, styles and lint) is a separate system: see `docs/design/studio-spec.md` section 5. The app only previews it.

## Test hooks
Keep every id and accessible name listed in `docs/design/studio-spec.md` section 10.7. If you must change one, update `server/test/e2e.ts` in the same change. The e2e run includes a scan that fails on any visible text under 7:1 or under 16px.

## Don't
Grey-on-grey text, text under 16px, opacity on text, a dark workspace theme, gradients, coloured top borders on cards, icon-only buttons without labels, drag-only controls, `transition: all`, more than one primary action, long hint paragraphs, empty panels kept for symmetry, decorative pictures in empty space.
