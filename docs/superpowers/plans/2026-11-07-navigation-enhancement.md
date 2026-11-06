# Coil Navigation Enhancement Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this scoped enhancement inline.

**Goal:** Provide usable mobile navigation and a consistent public evidence-page experience.
**Architecture:** Shared SiteNavigation/MobileNavigation primitives plus PublicPage shell; existing reads and transaction paths stay in their current owners.
**Tech Stack:** Next 15, React 19, Tailwind 4, existing Radix Dialog and Lucide.
**Spec:** docs/superpowers/specs/2026-11-07-navigation-enhancement-design.md

## Global Constraints
- Preserve current dark/orange theme, all seven navigation destinations and all financial/release-gate semantics.
- Menu trigger/links/close and public navigation targets are at least 44px.
- No new package, wallet transaction, contract deployment or environment publication.

## Review Focus
- Narrow screens and wrong-network wallet headers must wrap without overflow.
- Mobile dialog must support Escape, focus return and navigation dismissal.
- Tablet width cannot show desktop links alongside crowded wallet controls.
- Partial or unconfigured keeper/chain data retains its original meaning.
- Same-document links work on home and cross-route section links work on public pages.

### Task 1: Accessible shared navigation and page consistency
Files: create web/src/components/site-navigation.tsx and public-page.tsx; update coil-app.tsx and guard/stats/keeper pages; update globals.css for visible link focus.
- [x] Verify baseline mobile navigation regression fails on the current public app.
- [x] Implement shared desktop links and Radix mobile dialog using existing dependencies.
- [x] Adopt PublicPage on all three evidence routes, retaining existing data/error/refresh behavior.
- [x] Check browser navigation, focus, viewport overflow and active-route semantics.
- [x] Run web tests, lint, typecheck and production build.
- [x] Review the diff and retain evidence and relevant limitations.
