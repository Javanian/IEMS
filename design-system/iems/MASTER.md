# IEMS Design System (Master)

Source of truth for the IEMS web app (`apps/web`). Version 2 (Oct 2026) moved the system from flat
Swiss minimal to Soft UI Evolution with bento-style card grids, tuned for a modern, data-dense
operations dashboard. A page file in
`design-system/iems/pages/<page>.md` overrides these rules for that page.

## Product context

- Internal operations platform for a heavy-equipment plant: planners and admins on desktop,
  operators on wall-mounted tablets on the shop floor.
- Runs on a factory LAN, often without internet. Every asset, including fonts, is bundled.
- Data-dense screens (tables, KPI cards, charts) are the norm, so the system optimizes for
  scanning numbers and status, not for marketing-style whitespace.

## Style

Soft UI Evolution on a cool slate canvas (soft UI with bento-style card grids):

- White cards with a hairline border (`border-slate-200/80`), 16px radius and a two-layer soft
  shadow (`shadow-soft`; Tailwind's `shadow-sm/md/lg` are redefined to the same family).
- A deep navy chrome (`bg-chrome`, `#0B1220`) for the app sidebar and the login brand panel, so
  navigation reads as a separate layer from data.
- Sticky headers are translucent (`bg-white/75 backdrop-blur-md`). Glass is used only on chrome and
  overlays, never behind numbers.
- Primary actions are solid blue with a colored glow (`shadow-glow`); secondary actions are white
  cards that lift 2px on hover (`hover:-translate-y-0.5 hover:shadow-lift`).
- Modal overlays are `bg-slate-950/50 backdrop-blur-sm`.
- No 3D/embossed buttons, no neumorphism (its low-contrast surfaces fail accessibility).

## Color

All colors are CSS variables in `apps/web/src/index.css` and Tailwind tokens in
`tailwind.config.js`. Components use tokens, never raw hex.

| Role | Token | Value | Notes |
| --- | --- | --- | --- |
| Canvas (page background) | `bg-canvas` | `#F4F6FA` | cool slate, gives white cards edge without borders |
| Surface (cards, panels) | `bg-surface` | `#FFFFFF` | |
| Ink (primary text) | `text-ink` | `#0F172A` | slate-900, 17.8:1 on canvas |
| Muted text | `text-slate-500/600` | `#64748B` / `#475569` | 600 for body-size text |
| Border | `border-slate-200` | `#E2E8F0` | |
| Chrome (sidebar, login brand panel) | `bg-chrome` | `#0B1220` | slate-300 text 12.6:1 |
| Action | `brand-600` | `#2563EB` | primary buttons, links, selected state; white text 5.2:1 |
| Action hover / pressed | `brand-700` | `#1D4ED8` | white text 6.7:1; also used by older pages as the action fill |
| Focus ring, live dots | `brand-500` | `#3B82F6` | non-text only |
| Tints | `brand-50/100/200` | `#EFF6FF` / `#DBEAFE` / `#BFDBFE` | selected rows, chips, info panels |
| Success | `emerald-600` | `#059669` | used for status, not actions |
| Warning | `amber-600/700` | `#D97706` / `#B45309` | |
| Danger | `red-600` | `#DC2626` | |

The brand scale is Tailwind's blue scale, with `#2563EB` as the action color. There is no orange
CTA accent, because amber and orange
already mean "watch / rework" on the shop floor, and operators read color as status first.
Version 1 used a sky scale (`#0369A1`); every class, chart color and inline style was mapped
step for step onto the blue scale. Legacy Bootstrap-style tokens (`primary`,
`success`, `danger`, `warning`, `secondary`, `shadow-3d-*`) are remapped in the Tailwind
config so older pages follow the new palette.

## Typography

| Use | Font | Weight |
| --- | --- | --- |
| UI text and headings | Plus Jakarta Sans (variable) | 400 to 700 |
| Numbers in tables and KPIs, IDs, codes | Fira Code (`font-mono`) | 500 |

Fonts are bundled with `@fontsource-variable/plus-jakarta-sans` and `@fontsource/fira-code`; no
Google Fonts request. Plus Jakarta Sans is a friendly, modern SaaS face for dashboards and
B2B tools; headings use `font-bold tracking-tight`, labels use sentence case at `font-medium`
instead of uppercase micro-labels. Base size 14px for data screens (16px on forms and tablet screens), line height 1.5,
`tabular-nums` on every numeric column. Fira Code is kept only for IDs and codes.

## Spacing and shape

- Dense scale: 4, 8, 12, 16, 24, 32px.
- Radius: 12px controls (`rounded-xl`), 16px cards (`rounded-2xl`), 24px kiosk tiles (`rounded-3xl`).
- Shadows: `shadow-soft` on cards, `shadow-lift` on hover, `shadow-glow` on the primary action.
- Kiosk screens (timesheet main menu): one solid primary tile (Start), the rest white tiles with a
  tinted icon chip, so the next step is obvious at arm's length.

## Interaction

- Touch targets at least 44x44px on tablet screens, 8px gap between targets.
- Every interactive element has a visible `:focus-visible` ring (2px brand-500, 2px offset).
- Hover and press feedback 200ms; press scales to 0.98. Entrance animation `animate-rise`
  (420ms, expo-out). No animation on layout properties.
- `prefers-reduced-motion` disables non-essential transitions and animations.
- Icons are Lucide SVG with labels; icon-only buttons need `aria-label`.

## Data display

- Status is never shown by color alone: badges carry a text label and, where space allows, an icon.
- Tables scroll horizontally inside their card on small screens.
- Charts use the brand scale for series and red only for limits and out-of-control points.

## Anti-patterns

- Raw hex values in components.
- Gradient headers, 3D/embossed buttons and neumorphic shadows.
- Uppercase micro-labels for card titles (use sentence case, `text-xs font-medium text-slate-500`).
- Emoji as icons.
- Placeholder-only form labels.
- Gray-on-gray text below 4.5:1.

## Pre-delivery checklist

- [ ] No raw hex in changed components (tokens only)
- [ ] Text contrast at least 4.5:1, focus ring visible
- [ ] Touch targets at least 44px on tablet screens
- [ ] Works at 375, 768, 1024 and 1440px without horizontal page scroll
- [ ] `prefers-reduced-motion` respected
