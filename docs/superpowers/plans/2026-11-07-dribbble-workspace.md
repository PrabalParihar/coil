# Dribbble Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Apply the approved Rove/Cardinal direction to the functional Coil app.
**Architecture:** Keep transaction and data logic intact; change shared navigation, layout, styles and presentation markup. Reuse native disclosures and Radix menu.
**Tech Stack:** Next 15, React 19, Tailwind 4, Geist, Lucide, Playwright.
**Spec:** docs/superpowers/specs/2026-11-07-dribbble-workspace-design.md

## Global Constraints
- One Geist family; dark/orange Coil identity; no new dependencies.
- Preserve financial handlers and every fee, block, risk and release gate.
- No fabricated charts or financial data.

## Review Focus
- Narrow screens: rows, header and menus must remain within viewport.
- Keyboard: direct navigation, disclosures and wallet controls reachable.
- Live market failures: show unavailable state, never invented price.
- Connected accounts: retain discovery, fee quotes, owner and exit controls.
- Danger states: Recovery Mode and PegOff remain visible before action.

### Task 1: Workspace presentation
**Files:** site-navigation.tsx, public-page.tsx, coil-app.tsx, shell.tsx, ui/button.tsx, globals.css under web/src.
**Interfaces:** Preserve existing exports, props and financial callbacks. Navigation consumes selectedChain and pathname; renders shared desktop and mobile destinations.
- [x] Implement sidebar, mobile direct navigation and slim utility header.
- [x] Restructure app heading, composition cards and compact disclosures; align review rows.
- [x] Run existing web test suite, lint, typecheck and production build. Expected: all pass.

### Task 2: Visual and interaction verification
**Files:** docs/design/dribbble-workspace/*, design-qa.md.
**Interfaces:** Browser runs production build from Task 1.
- [x] Capture 16 viewport/route states, check overflow and console errors.
- [x] Exercise presets, ratios, slippage, invalid input, menu focus and disclosures.
- [x] Compare references with rendered app and fix actionable visual issues. Expected: passed QA.
- [ ] Independent final review; resolve meaningful findings; commit and integrate according to existing authorization.
