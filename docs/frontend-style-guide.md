# OxideRelay Frontend Style Guide

## Purpose

This document defines the current frontend visual language for OxideRelay and should be used as the baseline for future UI work.

The primary reference specimen is the compact users table on the `Users and permissions` page:

- compact row height
- monochrome first visual impression
- muted surfaces on dark background
- restrained borders
- monospace typography
- clear information density without dashboard noise

This guide documents the style that already exists in the codebase and clarifies which patterns are preferred going forward.

## Core Visual Principles

1. Dark, console-like interface first.
2. Monospace typography is the default product voice.
3. White and gray carry most of the UI.
4. Warm tint is allowed only as a subtle surface treatment, not as a dominant accent.
5. Orange is a supporting accent and focus color, not a framing color.
6. Dense, readable layouts are preferred over oversized dashboard spacing.
7. Cards, tables, and forms should feel operational and production-oriented, not mock-like.

## Canonical Tokens

Defined in `frontend/src/styles.css`.

### Palette

#### Core palette values

| Token | Value | Usage |
| --- | --- | --- |
| `--black` | `#080808` | sidebar, auth hero, deepest dark background |
| `--surface` | `#0e0e0e` | primary app background |
| `--surface-raised` | `#131313` | panels, inputs, cards, table shells |
| `--surface-hover` | `#1a1a1a` | hover states, nested dark surfaces |
| `--border` | `#1e1e1e` | default borders |
| `--border-strong` | `#2a2a2a` | stronger borders, input outlines, card separation |
| `--border-dotted` | `#333333` | dotted separators, low-emphasis structural dividers |
| `--text-muted` | `#555555` | low-priority metadata, table headers in quieter contexts |
| `--text-secondary` | `#888888` | helper text, descriptions, secondary labels |
| `--text-primary` | `#f0f0f0` | main content text |
| `--white` | `#ffffff` | primary buttons, focus outlines, highest-contrast UI elements |

#### Semantic status palette

| Token | Value | Usage |
| --- | --- | --- |
| `--color-danger-bg` | `rgba(220, 50, 50, 0.10)` | destructive surface background |
| `--color-danger-border` | `rgba(220, 50, 50, 0.28)` | destructive border |
| `--color-danger-text` | `#fca5a5` | destructive text/icon color |
| `--color-success-bg` | `rgba(74, 222, 128, 0.10)` | success surface background |
| `--color-success-border` | `rgba(74, 222, 128, 0.28)` | success border |
| `--color-success-text` | `#bbf7d0` | success text |
| `--color-warning-bg` | `rgba(252, 211, 77, 0.10)` | warning surface background |
| `--color-warning-border` | `rgba(252, 211, 77, 0.28)` | warning border |
| `--color-warning-text` | `#fef08a` | warning text |
| `--color-info-bg` | `rgba(148, 163, 184, 0.10)` | info surface background |
| `--color-info-border` | `rgba(148, 163, 184, 0.28)` | info border |
| `--color-info-text` | `#cbd5e1` | info text |

#### Warm surface treatment

Warm tint is allowed only as a subtle mix over dark surfaces.

Current warm workspace surfaces are derived from:

- `color-mix(in srgb, #fff8f1 6%, var(--surface-raised) 94%)`
- `color-mix(in srgb, #fff8ef 5% to 6%, var(--surface-hover or --surface-raised) 94% to 95%)`

These values are acceptable for:

- workspace panels
- nested admin cards
- low-key project/user settings surfaces

These values are not intended for:

- tab separators
- large table frames
- primary navigation active states
- global page chrome

#### Color rules

1. Default UI impression should remain monochrome.
2. White and gray should carry structure before accent colors do.
3. Orange should appear mainly in:
   - focus states
   - warning/help text
   - subtle warm surface mixes
   - delivery/import or caution-adjacent support states
4. Card, panel, and table borders should stay neutral by default and must not use orange framing.
5. Active tabs, table selection, and layout separators should prefer neutral white/gray treatments.
6. New raw colors should not be introduced unless they first become tokens in `styles.css` and are added here.

### Typography

#### Font family

| Token | Value | Usage |
| --- | --- | --- |
| `--font-mono` | `"JetBrains Mono", "Fira Code", "Cascadia Code", monospace` | default product font across app shell, forms, tables, metadata, and admin content |

#### Type scale

| Token | Value | Usage |
| --- | --- | --- |
| `--text-xs` | `0.72rem` | badges, eyebrows, compact labels, table headers |
| `--text-sm` | `0.875rem` | helper text, metadata, secondary copy, button text |
| `--text-md` | `1rem` | body text, input text, default content |
| `--text-lg` | `1.125rem` | section headings |
| `--text-xl` | `1.375rem` | larger card titles |
| `--text-2xl` | `1.75rem` | brand block / larger utility headings |
| `--text-3xl` | `2.25rem` | auth form title scale |
| `--text-4xl` | `clamp(2rem, 3.5vw, 3.25rem)` | page titles and major hero headings |

#### Typography rules

1. Monospace is the default, not just a decorative accent.
2. `--text-4xl` is reserved for page titles and auth hero/form titles.
3. `--text-lg` is the default section-title size.
4. `--text-sm` should carry most secondary operational text.
5. `--text-xs` should be used for structural microcopy only, not for core content blocks.

### Spacing

#### Spacing scale

| Token | Value | Usage |
| --- | --- | --- |
| `--space-1` | `4px` | micro gaps, badge padding adjustments |
| `--space-2` | `8px` | tight label/input separation, compact row gaps |
| `--space-3` | `10px` | dense component spacing, compact cards, tight rows |
| `--space-4` | `14px` | default internal spacing |
| `--space-5` | `18px` | medium card rhythm |
| `--space-6` | `22px` | panel padding rhythm, page block gaps |
| `--space-8` | `32px` | larger layout spacing |
| `--space-9` | `36px` | larger panel/auth padding |
| `--space-10` | `40px` | hero and shell spacing |
| `--space-12` | `48px` | oversized top-level spacing, use sparingly |

#### Spacing rules

1. Default content spacing should be built primarily from `--space-3`, `--space-4`, and `--space-6`.
2. Dense operational UIs should prefer `--space-2`, `--space-3`, and `--space-4`.
3. `--space-8` and above should be reserved for shell, hero, or major section separation.
4. Avoid introducing raw pixel spacing when a token already matches the need closely.
5. Input controls, compact tables, and inspector sections should bias toward the denser end of the spacing scale.

### Radius and Shadows

#### Radius

| Token | Value | Usage |
| --- | --- | --- |
| `--radius-sm` | `2px` | inputs, badges, compact controls |
| `--radius-md` | `4px` | panels, cards, dialogs, elevated surfaces |
| `--radius-full` | `9999px` | pills, progress bars, circular spinner geometry |

#### Shadows

| Token | Value | Usage |
| --- | --- | --- |
| `--shadow-sm` | `0 2px 8px rgba(0, 0, 0, 0.25)` | small elevated affordances |
| `--shadow-card` | `0 4px 16px rgba(0, 0, 0, 0.20)` | default cards and panels |
| `--shadow-panel` | `0 24px 80px rgba(0, 0, 0, 0.35), 0 4px 24px rgba(0, 0, 0, 0.22)` | stronger auth/login shell emphasis only |

#### Radius and shadow rules

1. Use `--radius-sm` and `--radius-md` almost exclusively.
2. Use existing panel/card shadows only.
3. Do not introduce decorative glow stacks.
4. `--shadow-panel` is for prominent auth surfaces, not normal workspace panels.

### Motion

#### Motion tokens

| Token | Value | Usage |
| --- | --- | --- |
| `--dur-fast` | `120ms` | hover/focus reactions |
| `--dur-base` | `200ms` | normal UI transitions |
| `--dur-slow` | `340ms` | page entrance and larger reveal motion |
| `--ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | default easing curve |

#### Motion rules

1. Motion should support clarity, not decoration.
2. Use existing short transitions for hover/focus and entrance.
3. Avoid stacking multiple animations in the same component.
4. Loading and progress motion should stay subtle and utilitarian.

## Page-Level Structure

### App Shell

- Left navigation remains visually stable across pages.
- Main content uses the existing `content-shell`.
- Each workspace page should start with:
  - eyebrow
  - page title
  - optional supporting metadata

### Preferred Workspace Pattern

Preferred structure for admin/workspace pages:

1. Header
2. Toolbar or tab row
3. One or more panels
4. Dense content areas inside those panels

### Two-Column Workspace Pattern

For settings or admin-detail screens:

- left side: list/table or main form
- right side: detail/metadata/inspector
- recommended visual ratio:
  - `1:2` for master-detail
  - approximately `1.5:1` for settings form + metadata

## Panels and Surfaces

### Default Panel

- Use `.panel`
- Border should stay subtle
- Background should be dark or softly warm-tinted dark

### Warm Workspace Panel

Used on project and users pages:

- off-white warm tint mixed into dark surface
- slight elevation
- no aggressive orange outline

This is currently the best panel treatment for product administration screens and should become the standard for similar pages.

### Nested Cards

Nested cards such as resource items, permission groups, and danger boxes should:

- stay darker than the outer panel
- use restrained borders
- not rely on bright accents for structure

## Tables

The users table is the canonical table style.

### Required Characteristics

- compact vertical rhythm
- uppercase muted headers
- subtle header separation line
- dark filled body
- selected row indicated by a left rule and slight background shift
- no heavy zebra striping
- no excessive hover animation

### Table Content Rules

- primary cell line: bold, short, high-contrast
- secondary line: muted and smaller
- numeric columns should stay visually quiet
- badges should not dominate the row

### Do Not

- make rows tall unless the content truly requires it
- use bright accent borders across the entire table
- add decorative color blocks inside cells

## Tabs

Tabs are used on project settings and user inspector.

Rules:

- active state should be monochrome or near-monochrome
- use underline or bottom border for selection
- separators around tabs should be neutral, not accent-colored
- tab rows should read as structure, not decoration

## Forms

### Inputs

- dark raised background
- subtle border
- orange focus ring / focus border treatment
- placeholder text stays muted
- control padding should be compact by default; avoid oversized form fields in admin workflows

### Form Layout

- stack fields vertically unless there is a strong reason for a two-column form
- multi-field rows should use the existing grid tokens
- helper text is small and secondary

### Mutations

- primary save action: white button
- secondary action: ghost or secondary button
- destructive action: ghost danger button, visually separated

## Buttons

### Primary

- white fill
- black text
- reserved for the main action in a section

### Secondary

- muted raised surface
- neutral border

### Ghost

- transparent or near-transparent
- neutral border

### Danger

- only for destructive actions
- should not be placed immediately next to standard save actions without spatial separation

## Feedback

### Banners

- use existing semantic banners only
- success, warning, error, info
- keep copy short and operational

### Loading

- loading UI should be compact
- avoid large empty shells unless the whole page is blocked

## Copy and Tone

- concise
- operational
- low-marketing
- no fake data
- no role terminology where roles do not exist

## Responsive Behavior

- no horizontal overflow on normal admin pages
- two-column pages collapse to one column on narrower screens
- tables may scroll horizontally if needed, but forms and panels should reflow first

## Implementation Rules

1. Prefer reusable classes in `styles.css` over inline styles.
2. Avoid one-off visual values when a token already exists.
3. Prefer shared utility or component classes over page-local styling when patterns repeat.
4. New pages should reuse:
   - `.panel`
   - `.toolbar`
   - `.table-shell`
   - `.badge`
   - `.banner`
   - `.project-tab`
5. Avoid introducing new visual directions page by page.

## Current Compliance Snapshot

### Strong Matches

- Users table and inspector
- Project settings page structure
- Resource cards and metadata rows
- Shared form controls and buttons

### Partial Matches

- Projects page: structurally sound, but visually older and less aligned with the denser admin pattern
- Login and reset password pages: consistent in palette and type, but rely too much on inline layout styling
- App shell: consistent overall, but some composition is still hard-coded inline

### Current Main Deviations

1. Inline styles are still used in layout and auth pages.
2. Warm workspace panel treatment is duplicated page-specifically instead of being a shared page pattern.
3. Projects page still uses an older “create panel + project cards” composition that is visually looser than newer workspace pages.
4. Some hover and helper states still lean warmer than necessary for a mostly monochrome UI.
5. Shared spacing and header composition patterns are not fully extracted into reusable classes.

## Preferred Next Refactor Direction

1. Extract shared workspace surface classes.
2. Remove most inline layout and spacing styles from `AppLayout`, `LoginPage`, and `ResetPasswordPage`.
3. Bring `ProjectsPage` onto the same density and panel language as `UsersPage` and `ProjectPage`.
4. Normalize accent usage so orange remains informational and subtle.
