# Video maker design rules

**Feel:** warm like good stationery, calm like a quiet studio. **Verb:** describe a video, get it.
**Signature:** the orange dot. It comes after each page title, sits in the wordmark, and breathes (`<PulseDot>`) while work is happening. Orange is only ever a mark. Never use it for text.

## Hard rules
- **One column**, about 720px (`.container` in `<Shell>`). One thing after another. No side-by-side panels, no sidebars, no sticky side previews.
- **Text is 7:1 or more**, and **16px or more**. Use `--ink` for text and `--text-2` for hints. Nothing paler, no `opacity` on text, and no grey placeholders or disabled labels.
- **Keep copy short.** One-line ledes. Hints only when they stop a mistake. Labels stay clear.
- **One primary button per view.**
- **Keyboard and screen readers:** use real `<label>`s, keep visible focus (styles.css draws it, so don't override it), use `aria-live` for status and progress, and use `ErrorSummary` plus inline errors.

## Tokens (styles.css `:root`)
| Group | Tokens |
|---|---|
| Surfaces | `--paper` page, `--surface` cards and inputs, `--tint` / `--tint-2` soft fills, `--hairline` borders, `--track` bars |
| Text | `--ink` (16:1), `--text-2` (9:1+), `--slate` links and progress (7.5:1+) |
| Meaning | `--ok`/`--ok-tint`, `--bad`/`--bad-tint`, `--warn`/`--warn-tint`, `--info-tint` |
| Space | `--s-1`…`--s-9` = 4 8 12 16 24 32 48 64 96; `--gap-field` 32, `--gap-block` 64 (48 on phones), `--gap-page`, `--gap-intro` |
| Radius | `--r-sm` 8, `--r-md` 12 (inputs, messages), `--r-lg` 16 (cards), `--r-pill` (buttons, tags) |
| Depth | `--shadow-1` rest, `--shadow-2` hover, `--shadow-3` floating (toasts, dialogs). Cards use a hairline ring plus `--shadow-1`. Don't add more |
| Type | 16 small / 18 body / 20 lede, h4 / 24 h3 / 30 h2 / 44 h1. Classes: `.page-title .h2 .h3 .h4 .lede .small .text-2` |
| Motion | `--ease-out`, `--t-fast` 150, `--t-base` 220, `--t-slow` 350 |

Gaps belong to the `margin-top` of the element below. Never use magic numbers. Pick from the scale.

## Components (ui.tsx)
- `Shell current="make"|"brands"`: the providers (Mantine and MotionRoot), skip link, sticky top bar with gliding nav pill, page entrance, and Toaster. Use it once per page.
- `PageHeader title lede? id? before?` / `PageTitle`: the h1 with its dot.
- `Section title? intro? id? level? reveal?`: a block of the page, with its heading.
- `Card interactive? as?`: a white surface. Don't nest cards.
- `EmptyState icon title action?`: one line at most, one action at most.
- `SkeletonLines lines label` / `SkeletonBlock height label`: use while loading. Screen readers hear `label`.
- `Disclosure summary`: an animated details link for optional extras.
- `toast("Saved", { tone })`: only for short confirmations. Never put the only copy of important information in a toast.
- Still available: `Message`, `Tag`, `ErrorSummary`, `Field`, `describedBy`, `CharCount`, `InlineConfirm`, `goToField`, `useAfterRender`, `ICON`, `WaitingIcon`.
- Buttons are Mantine `<Button>`: primary is the default (ink), secondary is `variant="default"`, and tertiary is `variant="subtle"`. Use `loading` for busy states. Buttons already squeeze on press, so don't wrap them in motion.
- Native form classes: `.input .select .textarea .choices .choice .file .label .hint .error-msg`.

## Motion (motion.tsx): "Quiet-Clear"
- Keep it between 150 and 350ms, with ease-out or a damped spring and **no bounce**. Animate opacity and transform only. Height is allowed only in `Collapse`.
- Entrance first. Exits are quick (100–150ms) and only where the removal means something (a list item deleted, a toast gone).
- Motion never blocks input or delays focus. Move focus right away and let the animation run around it.
- Reduced motion is handled by `MotionRoot` (reducedMotion="user") and the CSS kill switch. Don't hand-roll animation without `useReducedMotion`.
- Use **Reveal** for something that appears because of what the person did. Use **Stagger/StaggerItem** for short lists on first show (at most around 8 items). Use **AnimatedList/AnimatedItem** for lists that change. Use **Collapse** for progressive disclosure. Use **Swap** for a status line or number that changes. Use **ProgressBar**, **PulseDot** and **SuccessCheck** for job state. Use **Pressable** for clickable cards.
- Don't animate on scroll, add parallax, loop anything except "working" indicators, or stagger whole pages (`PageEnter` already handles the page).

## Don't
Gradients, coloured top-borders on cards, icon-only buttons without labels, `transition: all`, pale text, text under 16px, more than one primary action, putting decorative pictures in empty space, widening the column for media.
