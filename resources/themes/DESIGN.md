---
name: MetroLink Utility
colors:
  surface: '#141313'
  surface-dim: '#141313'
  surface-bright: '#3a3939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#201f1f'
  surface-container-high: '#2b2a2a'
  surface-container-highest: '#353434'
  on-surface: '#e5e2e1'
  on-surface-variant: '#c4c7c7'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#8e9192'
  outline-variant: '#444748'
  surface-tint: '#c8c6c5'
  primary: '#c8c6c5'
  on-primary: '#313030'
  primary-container: '#1a1a1a'
  on-primary-container: '#848282'
  inverse-primary: '#5f5e5e'
  secondary: '#c6c6c7'
  on-secondary: '#2f3131'
  secondary-container: '#454747'
  on-secondary-container: '#b4b5b5'
  tertiary: '#c6c6c7'
  on-tertiary: '#2f3131'
  tertiary-container: '#181a1a'
  on-tertiary-container: '#818383'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e5e2e1'
  primary-fixed-dim: '#c8c6c5'
  on-primary-fixed: '#1c1b1b'
  on-primary-fixed-variant: '#474746'
  secondary-fixed: '#e2e2e2'
  secondary-fixed-dim: '#c6c6c7'
  on-secondary-fixed: '#1a1c1c'
  on-secondary-fixed-variant: '#454747'
  tertiary-fixed: '#e2e2e2'
  tertiary-fixed-dim: '#c6c6c7'
  on-tertiary-fixed: '#1a1c1c'
  on-tertiary-fixed-variant: '#454747'
  background: '#141313'
  on-background: '#e5e2e1'
  surface-variant: '#353434'
typography:
  display-lg:
    fontFamily: Outfit
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Outfit
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
  headline-md:
    fontFamily: Outfit
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Outfit
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Outfit
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  data-lg:
    fontFamily: Space Mono
    fontSize: 16px
    fontWeight: '700'
    lineHeight: 20px
  data-sm:
    fontFamily: Space Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-caps:
    fontFamily: Space Mono
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 14px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  gutter: 12px
  margin-mobile: 16px
  margin-desktop: 40px
---

## Brand & Style
The design system is built on the principle of **Digital Utility**. It rejects the soft, blurred aesthetics of modern social apps in favor of high-contrast, high-density information display. It is designed for the commuter—someone moving through high-stress, fast-paced environments where legibility and speed are the only metrics that matter.

The style is **Modern Industrial/Utility**. It utilizes a strict grid, sharp edges, and a "live data" aesthetic. It evokes the feeling of a transit control room: functional, precise, and authoritative. There is no decorative "fluff"; every element serves a navigational or informational purpose.

**Target Audience:** Daily Delhi Metro commuters, students, and office-goers who prioritize real-time coordination and efficient journey planning.

## Colors
The palette is now optimized for a **Dark Mode** environment, prioritizing reduced eye strain in low-light transit conditions while maintaining the high-contrast foundation of **Charcoal (#1A1A1A)** and **Off-White (#F5F5F5)**.

- **Background:** Charcoal (#1A1A1A) serves as the primary canvas for the application.
- **Surface:** Deep containers (#1C1B1B) provide subtle separation without heavy shadows.
- **Text:** Primary text is strictly Off-White (#F5F5F5) for high legibility against the dark background. 
- **Accents:** Use solid, non-gradient colors strictly to represent their respective Metro lines. These should pop against the dark UI to categorize data or indicate status (e.g., a Red Line delay).

## Typography
This design system employs a dual-font strategy to balance modern aesthetics with technical precision.

- **Primary Typeface (Outfit):** A geometric sans-serif used for all UI headings and primary body text. It is clean, approachable, and highly legible at various scales.
- **Secondary Typeface (Space Mono):** Used for "Live Data" components, such as arrival times, station codes, distances, and status labels. The monospaced nature emphasizes the utility and real-time accuracy of the data.

**Hierarchy Rules:**
- Use `data-lg` for primary time and station indicators.
- Use `label-caps` for metadata (e.g., "NEXT TRAIN", "DISTANCE").
- Headlines should remain tight with slight negative letter spacing for a compact, authoritative feel.

## Layout & Spacing
The layout follows a **Strict Grid System** based on a 4px baseline. 

- **Grid Model:** A 12-column grid for desktop/tablet and a 4-column grid for mobile.
- **Density:** High. Margins are kept tight (16px) to maximize the amount of information visible on a single screen without scrolling.
- **Gutters:** 12px gutters provide just enough breathing room to distinguish between data columns.
- **Alignment:** Content should be strictly left-aligned. Center alignment is only permitted for iconography or splash states.

## Elevation & Depth
Depth is created through **Tonal Layering** and **High-Contrast Outlines** rather than shadows. This maintains the flat, "utility" aesthetic in a dark environment.

- **Level 0 (Background):** #1A1A1A.
- **Level 1 (Cards/Surfaces):** #1C1B1B with a 1px solid border of #F5F5F5 (or a darker grey for secondary elements).
- **Interactive State:** When an element is pressed or active, it should use a solid fill color change (e.g., a card background becomes the Metro line color or light grey).
- **Separators:** Use 1px or 2px solid lines to divide information within cards. Avoid using shadows to indicate hierarchy.

## Shapes
The shape language is **Sharp and Rigid**. 

- **Corners:** Use 0px (sharp) corners for all primary containers, buttons, and input fields. This reinforces the industrial, non-nonsense utility of the app.
- **Exceptions:** Very small badges or chips may use a 2px radius only if necessary to distinguish them from clickable buttons, but sharp corners remain the default preference.
- **Iconography:** Use thick, 2px stroke-width icons with sharp terminals. Avoid rounded caps or joins.

## Components

### Buttons
- **Primary:** Solid #F5F5F5 background with #1A1A1A text. Sharp 0px corners.
- **Secondary:** Transparent background with a 2px #F5F5F5 solid border.
- **Accent/Metro:** Solid Metro line color background with high-contrast text.

### Cards (Journey Details)
- Cards should have a 1px #F5F5F5 or tonal border. 
- Use a vertical accent bar on the left edge of the card (4px width) to indicate the Metro line.
- Data density is high: use `Space Mono` for all timing and platform information.

### Bottom Navigation
- Fixed at the bottom with a 2px top border of #F5F5F5.
- The "Active" state is indicated by a solid White (#FFFFFF) background for the icon block, with the icon inverting to #1A1A1A.

### Map Overlays & Markers
- **Markers:** Square or diamond-shaped markers (no circles).
- **Callouts:** Map callouts should be sharp rectangles with high-contrast borders and no transparency.

### Input Fields
- Sharp 1px #F5F5F5 border. 
- Label should be placed in the top-left corner, using `label-caps` in `Space Mono`.
- Active state: 2px border width.