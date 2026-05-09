# ASI public UI (RU landing)

Shared primitives live under `src/components/public/`. They rely on theme CSS variables (`--t-*` from `globals.css`) and Tailwind, aligned with existing RU pages that wrap content in `ThemeProvider`.

## Button and link hierarchy

1. **`PublicPrimaryCta`** — one dominant action per viewport (hero or closing block). Large control (~56–60px min height), bold label, filled accent background, subtle shadow. Use for high-intent steps (e.g. start express assessment).
2. **`PublicSecondaryCta`** — supporting navigation that must still feel tappable: medium height (~48–52px), bordered surface, semibold text. Visibly weaker than primary (no fill, smaller footprint).
3. **`PublicTextLink`** — tertiary navigation or “learn more” paths that should not compete with CTAs (methodology, auxiliary docs). Underline on hover; no chip or button shape.

Do not stack multiple primaries in one row. Prefer **primary + secondary + text link** rather than three equal bordered buttons.

## Card types

### `PublicInfoCard` (static)

Use for explanations, disclaimers, feature summaries, and taxonomy blocks that **do not** navigate.

- Neutral surface and border; comfortable typography.
- **No** `cursor-pointer`, **no** hover elevation, **no** scale animation, **no** keyboard focus ring styled like a button.

### `PublicClickableCard`

Use when the **whole card** is the hit target (navigation or deep-link). Includes hover/focus affordances and a trailing arrow (customizable).

Do not use `PublicClickableCard` for purely informational copy; that trains users to click everything.

## Badges

**`PublicBadge`** — non-interactive labels (object types, categories). Light ring and muted text; not padded like a button.

## Sections

**`PublicSection`** — vertical rhythm and background alternation:

- `hero`: top of page; no top border; tighter vertical padding.
- `default`: main background (`--t-bg`), top border.
- `muted`: secondary background (`--t-surface-2`), top border.

**`PublicSectionHeader`** — eyebrow (optional), title, description. Keeps heading and body copy scales consistent; use `titleClassName` when a closing headline needs a larger scale than interior sections.

Spacing defaults: section horizontal padding `px-4 sm:px-6`; internal stacks typically `mt-8` after the header for grids.

## What should look clickable

- Primary and secondary CTAs, real links in prose (`PublicTextLink`), and `PublicClickableCard`.
- Form controls and nav items in headers.

## What should not look clickable

- Info cards, disclaimers, methodology summaries, and bullet/feature lists inside static panels.
- Badges and tags that only describe content.

When in doubt: if there is no navigation on click, use **`PublicInfoCard`** or plain typography — not a button-shaped surface.

## RU landing principles

- Copy stays **Russian-only** on RU product pages; primitives are locale-agnostic.
- Respect theme switching: always use `var(--t-*)` tokens for colors and borders inside public components.
- Prefer a calm commercial product layout: clear hierarchy, limited motion, no decorative scaling on primary actions unless explicitly requested.
