# Trezor — Design Foundation (Phase 0)

Trezor is a private, offline-first personal organizer. This document defines the
visual direction, navigation model and design system that every future screen
should follow. Tokens live in `src/theme/tokens.ts`; this file explains the why.

---

## 1. Visual direction — "a quiet drawer"

Trezor should feel like a well-made drawer in your desk: calm, orderly, private.
Not a dashboard, not a social feed.

- **Content first.** Screens are mostly typography on a flat background. Rows and
  dividers do the structuring work; containers are used only where grouping
  genuinely helps (e.g. a settings group, the loyalty card panel).
- **One accent, used sparingly.** The accent marks *the* primary action, the
  active tab and selected states. Everything else is neutral.
- **Categories are distinguished by icon, not colour.** Four category colours
  would turn the UI into a rainbow; consistent line icons are enough.
- **No decoration.** No gradients, illustrations or ornamental shadows. Elevation
  is expressed with hairline borders and a slightly different surface tone.
- **Motion is functional only** — default platform transitions, nothing custom.

## 2. Colour

Warm neutrals ("paper and ink") with a deep pine accent. Warm greys feel softer
and more personal than blue-greys; pine reads as calm and trustworthy without the
"banking app" connotation of blue.

| Token            | Light     | Dark      | Use                                       |
| ---------------- | --------- | --------- | ----------------------------------------- |
| `background`     | `#F7F6F3` | `#121211` | Screen background                         |
| `surface`        | `#FFFFFF` | `#1B1B19` | Grouped sections, inputs, sheets, dialogs |
| `surfaceMuted`   | `#EFEDE8` | `#252522` | Icon tiles, chips, placeholders           |
| `border`         | `#E4E1DA` | `#2F2E2B` | Hairlines, input borders                  |
| `borderStrong`   | `#CFCBC2` | `#45433F` | Focused/pressed outlines                  |
| `text`           | `#1C1B19` | `#ECEAE5` | Primary text                              |
| `textSecondary`  | `#5F5C55` | `#A8A49B` | Supporting text, icons                    |
| `textTertiary`   | `#8E8A81` | `#75716A` | Metadata, placeholders                    |
| `accent`         | `#2E6A5C` | `#7DBBA9` | Primary buttons, active tab, selection    |
| `accentSoft`     | `#E2EDE9` | `#1E332E` | Selected chip background                  |
| `onAccent`       | `#FFFFFF` | `#0E1C18` | Text/icons on accent                      |
| `danger`         | `#B3412F` | `#E58A79` | Destructive actions, overdue              |
| `dangerSoft`     | `#F6E4E0` | `#3A221D` | Destructive button pressed state          |

Light and dark themes are both supported. The user can follow the system or force
either one in Settings.

## 3. Typography

System typeface (Roboto on Android, SF Pro on iOS). It is highly legible, renders
perfectly at every size, costs nothing to ship and feels native on each platform.
Hierarchy comes from size and weight, not from colour or decoration.

| Style        | Size / line | Weight | Use                                 |
| ------------ | ----------- | ------ | ----------------------------------- |
| `display`    | 30 / 36     | 600    | Top-level screen titles             |
| `title`      | 22 / 28     | 600    | Detail screen titles                |
| `headline`   | 17 / 22     | 600    | Card names, dialog titles           |
| `body`       | 16 / 23     | 400    | Default text, inputs                |
| `bodyStrong` | 16 / 22     | 500    | List item titles                    |
| `callout`    | 14 / 20     | 400    | Supporting text, previews           |
| `label`      | 13 / 18     | 500    | Section labels, form labels, chips  |
| `caption`    | 12 / 16     | 400    | Metadata, helper text, tab labels   |
| `mono`       | 20 / 28     | 500    | Card numbers (tabular, spaced)      |

## 4. Spacing, radius, icons

- **Spacing** — 4-point scale: `2, 4, 8, 12, 16, 20, 24, 32, 48`. Screen gutter is
  20; vertical rhythm between sections is 32.
- **Radius** — `sm 6` (chips, small tiles), `md 10` (inputs, buttons), `lg 14`
  (grouped sections, card panel), `xl 20` (sheets), `full` (FAB, pills).
- **Icons** — [Lucide](https://lucide.dev) line icons only. Stroke width 1.75.
  Sizes: 16 (inline metadata), 20 (list rows, buttons), 22 (tab bar, header
  actions). Default colour `textSecondary`; `accent` only for active/selected.
- **Touch targets** — minimum 44×44 for anything tappable.

## 5. Navigation

```
Root stack
├── Tabs (bottom bar)
│   ├── Home        overview: coming up, pinned, recent
│   ├── Notes       list
│   ├── Reminders   list (Upcoming / Done)
│   ├── Cards       list
│   └── Documents   list (All / Receipts / Warranties / Other)
├── ItemDetail      one screen, type-specific body
├── ItemEditor      create + edit, type-specific fields (modal presentation)
├── Search          global search across all types
└── Settings
```

**Why the four categories are tabs.** We considered a hub-only model (Home with
category tiles, three tabs). It looks tidier but adds a tap to every daily task,
and the most time-critical one — showing a loyalty card at a checkout — needs to
be one tap away. Five destinations is the upper limit for a bottom bar, but with
short one-word labels and consistent icons it stays readable down to 360dp.

**Settings and Search** are not tabs: Settings is visited rarely, and Search is
global, so both are reached from header actions on every top-level screen.

**Creating items.** A single floating "+" button sits bottom-right on every tab.
On a category tab it opens that category's editor directly. On Home it opens a
small sheet asking which type to create. The editor is presented modally, with
Cancel and Save in the header, so it's clear that you're inside a task you can
leave.

## 6. Screens

| Screen       | Purpose                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| Home         | Date, search entry, category counts, "Coming up" reminders, pinned items, recent items. Welcome state on first launch. |
| Category tab | Title, item count, optional filter chips, list, FAB, empty state with a "create first" action.           |
| Item detail  | Back, edit, pin, delete. Note body; reminder due/repeat + "Mark as done"; card panel with number; document fields + attachment. |
| Item editor  | Title + type-specific fields, inline validation, Cancel/Save.                                             |
| Search       | Auto-focused field, results grouped by type, hint and no-results states.                                  |
| Settings     | Appearance, Security, Data, About. Features not yet built are shown but clearly marked "Not available yet". |

## 7. Components

All in `src/components/`. Screens are composed from these; screens never define
their own colours, font sizes or spacing.

| Component         | Notes                                                                    |
| ----------------- | ------------------------------------------------------------------------ |
| `Text`            | Typography variants + semantic colour.                                   |
| `Icon`            | Lucide wrapper enforcing stroke width, sizes and colours.                |
| `Button`          | `primary`, `secondary`, `ghost`, `destructive`; `md` / `sm`; optional icon. |
| `IconButton`      | 44×44 touch target, used in headers.                                     |
| `TextField`       | Label, placeholder, helper, error, multiline.                            |
| `SearchField`     | Rounded, icon-led; can act as a button that opens Search.                |
| `ListItem`        | Leading icon tile, title, subtitle, trailing meta/chevron/control.       |
| `Section`         | Label + optional action + content; `grouped` variant for settings.       |
| `ChipGroup`       | Single-select filter/segmented control.                                  |
| `EmptyState`      | Icon, title, message, optional action.                                   |
| `Screen`          | Background, safe-area handling, optional scroll.                         |
| `ScreenHeader`    | Large title or compact back-header, with actions.                        |
| `Fab`             | Single floating create button.                                           |
| `Dialog`          | Centered modal for confirmations.                                        |
| `Sheet`           | Bottom sheet modal for short choices.                                    |
| `Divider`         | Hairline, optional inset.                                                |

## 8. UX decisions

- **First launch** shows a welcome block on Home: one sentence about what
  Trezor is, one about privacy ("Everything stays on this device"), and four
  "Add your first …" rows. Each category tab has its own empty state with a
  direct create action.
- **Overdue reminders** are the only place `danger` colour appears outside of
  destructive actions.
- **Destructive actions** always go through a confirmation dialog that names
  what will be deleted.
- **Unavailable features are shown honestly.** Settings lists App lock, Backup
  and Export so the product's direction is visible, but they're disabled and
  labelled "Not available yet". Nothing pretends to work.
- **Cards** show the card number large and spaced for a cashier to type in. The
  barcode area is a labelled placeholder until barcode rendering is built; we
  don't draw fake stripes that someone might try to scan.
- **Language** — English only, sentence case everywhere, short verbs on buttons
  ("Save", "Delete", "Mark as done").

## 9. Phase 0 data

The app runs on in-memory sample data (`src/data/`). Changes made in the app
(create, edit, delete, complete) last only until the app is closed, and Settings
says so. Settings → Preview → "Show sample data" switches to an empty state, which
makes it possible to review the first-launch experience. `src/data/ItemsProvider`
is the seam that Phase 1 replaces with real local persistence.

## 10. Privacy guarantees in the build

Release builds request no network permission: `INTERNET` is declared only in
`android/app/src/debug/AndroidManifest.xml` so development builds can reach
Metro. The app cannot make network requests in production, which makes the
"nothing leaves this device" promise structural rather than a policy.
