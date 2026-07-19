# MediaLab Branding & Style Guide

This guide establishes the visual design system, token configuration, and interface guidelines for the MediaLab Operations Console. Adherence to this system ensures a cohesive, professional, and premium aesthetic across all digital assets.

---

## 1. Core Visual Tokens

These CSS Custom Properties (variables) define the core theme of the MediaLab dashboard.

### Color Palette

| Token Name | Value | Purpose |
| :--- | :--- | :--- |
| `--color-primary` | `#ffc107` | Golden Amber brand highlight (buttons, active tabs, accents) |
| `--color-bg-base` | `#121212` | Dark background base |
| `--color-bg-surface` | `#1e1e1e` | Panel and card background (lighter dark) |
| `--color-bg-surface-hover` | `#2d2d2d` | List item hover states and secondary active elements |
| `--color-border` | `#333333` | Thin borders, separators, and card boundaries |
| `--color-text-primary` | `#f5f5f5` | High-contrast white for headings and primary copy |
| `--color-text-secondary` | `#8e8e8e` | Medium-contrast grey for labels, descriptions, and metadata |
| `--color-text-muted` | `#666666` | Lower-contrast grey for disabled states or minor labels |

---

## 2. Typography Guidelines

All user interfaces must prioritize modern, geometric sans-serif fonts to support dashboard legibility and premium feel.

- **Primary Font Face**: `Inter`, `Roboto`, or `system-ui`
- **Weights & Sizes**:
  - **Headings (h1, h2, h3)**: Bold/Semi-bold, white (`--color-text-primary`).
  - **Metadata/Labels**: Medium/Regular, smaller sizing, medium grey (`--color-text-secondary`).
  - **Action Links & Interactive Elements**: Uppercase, Bold/Semi-bold, golden amber (`--color-primary`).

---

## 3. Layout and Structural Guidelines

Our interfaces use a structured, high-efficiency grid layout tailored for real-time field operations.

### Split-Pane Layout
- **Left Pane (Master list)**: Width of 35%–40% on desktop. Scrollable container displaying active or upcoming orders. Each item card should feature a structured, compact metadata layout.
- **Right Pane (Details panel)**: Width of 60%–65% on desktop. Dynamically renders comprehensive information for the selected list item, including forms, dropdown menus, and nested media.

### Cards and Interactive States
- Cards should have a solid or slightly translucent background (`--color-bg-surface`), rounded corners (`8px`), and subtle micro-borders (`1px solid --color-border`).
- Hovering over lists, links, or cards must trigger smooth transitions (`transition: all 0.2s ease`) using elevated backgrounds (`--color-bg-surface-hover`) or increased opacity.

---

## 4. Key UI Assets & Visual Language

- **Action Links**: For non-button text links that execute actions (e.g. *GET DIRECTIONS*, *GET MISSION PLAN*), always format in all-uppercase bold using `--color-primary` with interactive underlines or color shifts on hover.
- **Form Controls**: Text fields, selects, and inputs must use deep backgrounds (`--color-bg-base`), a clean border (`--color-border`), and an amber highlight (`--color-primary`) on active focus.
