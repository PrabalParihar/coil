# Coil navigation and public-page enhancements

Intent: make the existing Coil app easier to navigate on a phone and keep public evidence pages recognizably part of the same product.

Grounding: fresh desktop/mobile captures of the public app on 2026-11-07 (Asia/Kolkata). The home navigation is hidden below md with no mobile replacement. Guard/Keeper have plain text navigation; Stats has a separate branded header. All four routes returned 200 with no observed JavaScript errors. Data is asynchronous: screenshots do not establish full event-history completeness or authenticated keeper health.

Approaches considered:
- Local styling fixes per page: smallest diff, but retains three competing headers and duplicated links.
- Shared navigation plus a public-page shell (recommended default): consistent brand, network badge and route links; one accessible mobile dialog; keeps existing app composition and financial controls.
- Guided-flow redesign: changes the user's established app flow and needs separate visual exploration.

Chosen implementation default: shared navigation and shell, following the user's instruction to continue enhancements. This is an implementation choice, not a claimed user-selected mockup. Keep the orange/dark theme, current routes, quote behavior, legacy capability labels, partial-data disclosures and release gates.

Scope:
- Seven destinations available from mobile home and public pages.
- Radix dialog provides modal focus containment, Escape dismissal and return to trigger. Selecting a destination closes it. Touch targets at least 44px.
- Desktop navigation switches at xl to leave room for wallet and market controls. Primary route links expose aria-current=page.
- Guard, Stats and Keeper share the logo, network/deployment badge, page title and a clear app return link. Public-page skip link targets a focusable main landmark.
- Public metadata wraps without splitting normal words; no optimistic health labels or invented data.

Verification: existing 40 web tests, lint, typecheck, production build; real browser checks at 320/390/768/1024/1440 widths, menu open/close/navigation/keyboard, active route, return link and no horizontal overflow. No financial transactions are needed.
