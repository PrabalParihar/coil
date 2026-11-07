# Dribbble reference inspection — Coil

Opened the actual public Y Combinator collection and six shot pages in normal graphical Chromium. The collection and all six selected shot pages returned HTTP 200. Images and a frame from the Endex video were visually inspected. This research informed the implemented workspace redesign; the adaptation preserves Coil’s product and financial behavior.

## Most useful references

1. [Rove App — Vova](https://dribbble.com/shots/25431151-Rove-App)
   - Viewed both the single-phone presentation and the three-screen image.
   - Balance has one clear focal point. Payment action sits directly beneath it. Transaction rows use aligned amounts, restrained secondary labels, and small consistent icons.
   - Coil application: one clear deposit/position focal point, one primary action, compact account and receipt rows. Preserve Coil's dark/orange identity. Borrow hierarchy, not credit-card or travel features.
   - Actual source image: [three screens](rove-reference.png).

2. [Cardinal — Scott Perket / Forge Studio](https://dribbble.com/shots/22476004-Cardinal-YC-W23-zero-to-one-product-design-MVP)
   - Viewed the actual application screenshot: slim navigation, a restrained toolbar, compact filters, chart, and aligned table rows.
   - Coil application: compact app navigation, consistent labels, tighter spacing and aligned quote/receipt rows. Give the active task most of the width. Chart data is not a reason to add a fabricated chart to Coil.
   - Actual source image: [application screenshot](cardinal-reference.png).

## Other actual shots inspected

- [Explo brand identity — Larysa Yaniohlo / Implse](https://dribbble.com/shots/19515607-Explo-insights-and-visualizations-for-SQL-data): both images are brand-system presentations, including palette, typography, and iconography. Not evidence of a product dashboard layout.
- [Explo website — Larysa Yaniohlo / Implse](https://dribbble.com/shots/19264978-Explo-a-new-way-for-front-facing-analytics): centered large marketing heading, two calls to action, dashboard preview below. Useful product preview placement, but oversized hero is a poor match for the current feedback.
- [Endex AI — Vova](https://dribbble.com/shots/25277855-Endex-AI): inspected the actual video at approximately five seconds. Black canvas, large two-line heading, particle illustration, small secondary labels. Contrast is useful; oversized heading and particle decoration are not appropriate for the requested compact Coil app.
- [AI fintech website — Nico](https://dribbble.com/shots/25991348-AI-fintech-startup-website-design): actual Spiros website concept uses a dark green hero, large centered heading, decorative lines and glow. Less suitable than Rove/Cardinal for Coil's transactional flow.

## Recommended Coil direction

Use Rove's financial hierarchy and Cardinal's compact application structure within the existing dark/orange Coil identity. Keep one font family, small headings, short labels, aligned numbers and one dominant action. Keep risk and transaction-blocking warnings visible, with deeper explanations behind explicit details controls. Do not introduce simulated financial data or remove transaction safeguards.

## Implementation evidence

[Desktop app](desktop.png), [mobile app](mobile.png), [successful quote fixture](fixture-quote-1440.png), [browser checks](browser-checks.json), and [design QA](../../../design-qa.md).

Quote fixture screenshots use read-only test RPC responses to exercise a successful preview while the real pool rejects the current slippage. They are test evidence, not production financial observations. Public app screenshots use live data and retain its warnings.
