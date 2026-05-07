---
name: Slimboard
version: 0.1.0
status: alpha
platform: mobile-web
tokens:
  color:
    background: "#f4f6f8"
    surface: "#ffffff"
    surfaceSubtle: "#f8fafc"
    text: "#1f2933"
    textStrong: "#111827"
    muted: "#8b95a1"
    mutedSoft: "#b8c0c9"
    line: "#edf0f3"
    blue: "#3182f6"
    blueSoft: "#e8f2ff"
    red: "#ef4452"
    amber: "#f59f00"
    green: "#20b486"
  typography:
    family: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    title: "34px/1.16 800"
    section: "24px/1.25 800"
    body: "17px/1.55 500"
    caption: "14px/1.4 700"
  radius:
    card: 28px
    button: 18px
    control: 18px
    chip: 999px
  spacing:
    pageX: 20px
    pageY: 18px
    card: 24px
    gap: 16px
    dockBottom: 20px
components:
  button:
    primary: "blue fill, white text, 56px minimum height"
    secondary: "soft gray fill, dark text, no border"
  card:
    style: "white surface, 28px radius, minimal shadow, no visible heavy border"
  list:
    style: "large icon on left, title and muted metadata, optional right action"
  bottomDock:
    style: "floating rounded white dock, 5 or fewer items, active item dark"
---

# Slimboard Mobile Design

Slimboard is a mobile-first web app for saving whiteboard photos as searchable notes. The UI should feel like a clean Korean mobile finance app: calm, fast, readable, and touch-first.

## Direction

- Use a white and light-gray canvas with blue as the only strong action color.
- Favor large rounded cards, clear section titles, and short Korean labels.
- Build screens as vertical mobile flows, not desktop grids.
- Keep actions thumb-friendly with at least 48px touch targets.
- Use list rows for saved notes and information sections.

## Do

- Put the primary task near the top of the screen.
- Use strong hierarchy: title, supporting text, then action.
- Use muted text for metadata and descriptions.
- Keep card spacing generous so each section breathes.
- Reuse the same button, chip, input, card, and bottom dock rhythm across all screens.

## Do Not

- Do not copy Toss brand names, logos, characters, or financial product language.
- Do not add fake OS status bars.
- Do not design wide desktop layouts.
- Do not use decorative hero stock photos, heavy borders, nested cards, or colorful gradients as decoration.
- Do not introduce new packages for visual polish.
