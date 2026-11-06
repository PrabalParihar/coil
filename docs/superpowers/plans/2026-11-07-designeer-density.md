# Designeer Density Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline.

**Goal:** Improve Coil's actual information hierarchy from inspected references and the user's typography/copy correction.
**Architecture:** Retain current app/state owners; revise existing layout, font tokens and presentation only.
**Tech Stack:** Next15, React19, Geist, Tailwind4, existing icons/components.
**Spec:** docs/superpowers/specs/2026-11-07-designeer-density-design.md

## Global Constraints
- All financial calculations, calls, supported account generations and guards remain unchanged.
- No mocked account/market values; retain warning meaning and exact fee/quote rows.
- One Geist family; primary headings<=32px, app heading<=28px, input<=32px.

## Review Focus
- Hidden disclosure content stays reachable by keyboard.
- Opening errors and Recovery Mode restrictions remain immediately visible.
- Education/provenance links and mobile navigation remain reachable.
- RPC failures show unavailable states, not positive claims.
- Narrow screens retain full form and real values without overflow.

### Task1: Typography, hierarchy and disclosure refinement
- [x] Capture the failing typography/placement checks on the baseline.
- [x] Update font layout/tokens, compact hero and section sizes; move education below the app.
- [x] Add explicit optional deployment/execution disclosures without changing their actions or values.
- [x] Run web40 tests, lint, build, typecheck and responsive/browser interaction checks.
- [x] Inspect before/after screenshots and review the diff independently.
