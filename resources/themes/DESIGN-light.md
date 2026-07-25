---
name: MetroLink Utility
colors:
  surface: '#fdf8f8'
  surface-dim: '#ddd9d8'
  surface-bright: '#fdf8f8'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f7f3f2'
  surface-container: '#f1edec'
  surface-container-high: '#ebe7e6'
  surface-container-highest: '#e5e2e1'
  on-surface: '#1c1b1b'
  on-surface-variant: '#444748'
  inverse-surface: '#313030'
  inverse-on-surface: '#f4f0ef'
  outline: '#747878'
  outline-variant: '#c4c7c7'
  surface-tint: '#5f5e5e'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#1c1b1b'
  on-primary-container: '#858383'
  inverse-primary: '#c8c6c5'
  secondary: '#5d5f5f'
  on-secondary: '#ffffff'
  secondary-container: '#dcdddd'
  on-secondary-container: '#5f6161'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#1a1c1c'
  on-tertiary-container: '#838484'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
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
  background: '#fdf8f8'
  on-background: '#1c1b1b'
  surface-variant: '#e5e2e1'
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
The palette is now optimized for a **Light Mode** environment, providing maximum clarity and readability under bright daylight or station lighting. It maintains the high-contrast foundation of **Charcoal (#1A1A1A)** and **Off-White (#F5F5F5)**, but flips the hierarchy for a clean, paper-white digital aesthetic.

- **Background:** Off-White (#F5F5F5) or pure White (#FFFFFF) serves as the primary canvas for the application to ensure a clean, high-brightness interface.
- **Surface:** Light grey containers provide subtle separation, ensuring the UI feels structured without becoming visually heavy.
- **Text:** Primary text is strictly Charcoal (#1A1A1A) for maximum legibility against the light background. 
- **Accents:** Use solid, non-gradient colors strictly to represent their respective Metro lines. These colors should be bold enough to stand out against the white/light grey UI to categorize data or indicate status.

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
Depth is created through **Tonal Layering** and **High-Contrast Outlines** rather than shadows. This maintains the flat, "utility" aesthetic in a light environment.

- **Level 0 (Background):** #F5F5F5.
- **Level 1 (Cards/Surfaces):** #FFFFFF with a 1px solid border of #1A1A1A (or a light grey for secondary elements).
- **Interactive State:** When an element is pressed or active, it should use a solid fill color change (e.g., a card background becomes a light grey or the specific Metro line color).
- **Separators:** Use 1px or 2px solid lines to divide information within cards. Avoid using shadows to indicate hierarchy.

## Shapes
The shape language is **Sharp and Rigid**. 

- **Corners:** Use 0px (sharp) corners for all primary containers, buttons, and input fields. This reinforces the industrial, no-nonsense utility of the app.
- **Exceptions:** Very small badges or chips may use a 2px radius only if necessary to distinguish them from clickable buttons, but sharp corners remain the default preference.
- **Iconography:** Use thick, 2px stroke-width icons with sharp terminals. Avoid rounded caps or joins.

## Components

### Buttons
- **Primary:** Solid #1A1A1A background with #F5F5F5 text. Sharp 0px corners.
- **Secondary:** Transparent background with a 2px #1A1A1A solid border.
- **Accent/Metro:** Solid Metro line color background with high-contrast text.

### Cards (Journey Details)
- Cards should have a 1px #1A1A1A or tonal grey border. 
- Use a vertical accent bar on the left edge of the card (4px width) to indicate the Metro line.
- Data density is high: use `Space Mono` for all timing and platform information.

### Bottom Navigation
- Fixed at the bottom with a 2px top border of #1A1A1A.
- The "Active" state is indicated by a solid Charcoal (#1A1A1A) background for the icon block, with the icon inverting to #F5F5F5.

### Map Overlays & Markers
- **Markers:** Square or diamond-shaped markers (no circles).
- **Callouts:** Map callouts should be sharp rectangles with high-contrast borders and no transparency.

### Input Fields
- Sharp 1px #1A1A1A border. 
- Label should be placed in the top-left corner, using `label-caps` in `Space Mono`.
- Active state: 2px border width.