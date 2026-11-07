# Coil workspace design QA

final result: passed

## Comparison target

Source visual truth: [Rove App](docs/design/dribbble-workspace/rove-reference.png) and [Cardinal](docs/design/dribbble-workspace/cardinal-reference.png), inspected on their actual public Dribbble pages. Both source bitmaps are1024×768 presentation images. Rove includes three framed phones; Cardinal includes a desktop app. They are references for hierarchy and compact navigation, not literal screens to clone.

Implementation: [desktop](docs/design/dribbble-workspace/desktop.png), [mobile](docs/design/dribbble-workspace/mobile.png), [Keeper](docs/design/dribbble-workspace/keeper-desktop.png), [successful quote fixture](docs/design/dribbble-workspace/fixture-quote-1440.png), [connected wrong-network fixture](docs/design/dribbble-workspace/fixture-connected-wrong-320.png).

CSS viewports:320,390,768,1024,1280,1440×1000. Screenshot density1CSSpx:1imagepx. Additional connected320×900 and short-height1280×400 checks. Source phone frames/background presentation were excluded from the pattern comparison. Coil's dark/orange theme, app content and financial warnings intentionally differ. This is a source-informed adaptation QA, not a claim of pixel fidelity to an unrelated banking/analytics product.

## Full-view and focused comparison

Opened Rove and the mobile implementation, Cardinal and the desktop implementation together in the comparison input. Desktop uses a208px navigation rail, restrained utility header, single workspace heading and input/quote columns. Mobile uses direct four-destination navigation, stacked cards and an accessible resource menu. Rove's clear primary financial value is applied to the deposit and total BTC collateral; Cardinal's compact navigation and aligned rows are applied to real Coil controls.

Focused quote1440 and320captures were inspected to check fee/risk labels, amount alignment, wrapping and primary action. The successful quote uses labelled read-only market RPC fixtures because the live pool currently rejects the tested slippage. No fixture data is embedded in production. Connected screenshots use an injected test provider that rejects signing and transaction methods.

## Findings and iteration history

- [P1, fixed] Sidebar was inside a backdrop-filter header; geometry showed x208/height68 instead of viewport-left/full-height. Moved navigation outside the filtered header. Subsequent desktop route checks confirm x0 and full viewport height.
- [P2, fixed] Hidden sidebar and mobile header reused a logo gradient ID, making the mobile mark disappear. Regression failed with1unique ID for2instances. Scoped IDs with React useId; reloaded browser check passes and visible mark was inspected.
- [P2, fixed] Short desktop sidebar clipped lower links at1280×400. Added vertical scrolling and nonshrinking children. View-source link is now reachable inside the viewport.
- [P2, fixed] Connected wrong-network header grew to222px while the App heading scrolled to176px. Shared WorkspaceHeader now measures actual height and updates anchor offset. Heading now lands at270px, below the header.
- [P2, fixed] At320px the network action squeezed warning text to26.6px. A basis constraint makes the action wrap onto another row. Post-fix connected warning is readable, at least160px wide, with no viewport overflow.

## Required surfaces

- Typography: one Geist family;20px main heading,14px panel headings,12px financial rows and28–32px focal values. No added display font. Financial numbers retain tabular alignment. Source hierarchy is adapted intentionally.
- Spacing/layout: sidebar208px,16–20px panel padding,16px composition gap; one column below1280px. Native disclosure rows reduce repeated explanatory text. Long quote rows wrap. No overflow in24tested route/viewport combinations.
- Colors/tokens: neutral dark background/card, restrained orange active navigation and primary action; existing green/amber/red risk semantics retained. Critical warnings remain visible.
- Image quality/assets: existing Coil brand mark and installed Lucide icons retained. Public source images are attributed research evidence. No generated placeholders, invented charts, copied phone chrome or decorative imagery added.
- Copy/content: removed duplicate overview heading and empty gauge; shortened headings/helper text while preserving fee labels, deployment disclosures, Recovery/PegOff reasons, account discovery and all exit/owner controls.

## Interaction verification

[Machine-readable evidence](docs/design/dribbble-workspace/browser-checks.json):24viewport/route cases plus7navigation/form cases;6successful-quote/invalid-input/wallet-dialog cases;2connected/wrong-network cases; short rail and unique-logo regressions. No page JavaScript errors in the route or quote suites. Menu focus remains trapped and returns after Escape; cross-page navigation and App anchors work. Deposit, leverage and slippage selections and keyboard disclosures remain functional.

Existing web suite40/40; lint, typecheck and production build passed. Independent whole-diff review found no outstanding Critical/Important source issues after the rail fix; its quote and connected-state verification gaps were covered with the subsequent fixtures.

## Practical limits

No funded transactions, smart-contract deployments or keeper-signing changes were part of this UI release. The application's real market/recovery constraints still apply. Existing secondary meter ticks are dense at320px; critical ratio and liquidation values are separately labelled and readable.
