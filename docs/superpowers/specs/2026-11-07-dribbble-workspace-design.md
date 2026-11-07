# Coil workspace redesign

The user approved implementing the Rove financial hierarchy and Cardinal compact application direction after actual source inspection. Keep Coil dark/orange, one Geist family, smaller headings and short labels. This is an adaptation for an existing financial application, not a replica of credit-card or analytics functionality.

## Approach

Use the existing Next/React app and existing Lucide icon library. Desktop gets a 208px workspace sidebar and slim utility header; mobile gets a compact header, four direct destinations and the existing accessible resource menu. Keep one main heading. The deposit and a clearly labelled quote summary share the main workspace. Explanations use native disclosures; risk, fees and blocking reasons remain available before signing.

Alternative marketing-led treatments (Explo, Endex, Spiros) were inspected and rejected for this task because large promotional headings and decoration conflict with the user's feedback. No backend or transaction architecture changes are necessary.

## Surface changes

- Shared shell and navigation on App, Guard, Stats and Keeper.
- Remove duplicate overview heading; retain real BTC price in utility header.
- Compact setup progress, status disclosures, rectangular controls and aligned financial rows.
- Deposit is the input focal point; final BTC collateral is the output focal point.
- Preserve all quote fields, fees, owner actions, account discovery, network handling, open/close gates and risk disclosures. No fabricated charts, values, activity or keeper health.
- At 320–768px there is no viewport overflow; all navigation, input controls and disclosure toggles remain keyboard accessible.

## Validation

Run existing web tests, lint, typecheck and production build. Browser-check App/Guard/Stats/Keeper at 320, 390, 768 and 1440px, menu keyboard behavior, preset/ratio/slippage controls, disclosure visibility, invalid amount feedback and wallet dialog. Compare actual reference imagery and rendered screenshots, recording intentional content/theme differences in design-qa.md.
