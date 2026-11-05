# SYNTHETIC LOCAL ANVIL FORK ONLY

These artifacts are **local regression evidence, not a public deployment, recruited
user proof, funded matsnet transaction proof, native-precompile measurement, or
mainnet go-live evidence**. All transaction hashes in these files belong to the
disposable `http://127.0.0.1:28747` Anvil fork. Chain ID 31611 matches matsnet so
the app can be tested, but these transactions were never sent to matsnet.

The run used a fork at matsnet block 16595146 and only the standard public Anvil
account. Repository BTC/MEZO precompile stand-ins and a controlled oracle were
installed locally, and the test account received a synthetic MUSD balance.
BorrowerOperations, TroveManager and MUSD protocol logic remained fork code.
The 1000× oracle-price reduction triggered the real fork protocol's Recovery
Mode; it was not a boolean mock. This does not validate native Mezo precompile
execution or real keeper funding.

The optional HTTPS keeper-status endpoint was intercepted by Playwright with
synthetic read-only/stale/unavailable responses. Its service counters are test
fixtures, not a deployed public keeper's telemetry. Authenticated heartbeat and
guard events came from the local EVM, separately from that service fixture.

The final run passed **14 browser phases and 17 confirmed post-deployment local
transactions**, with zero browser page errors and zero mainnet writes. It covers
wallet availability without WalletConnect configuration; paused create and
finite caps; exact 25 bps fee-bearing open and active-position increase; owner
MUSD approval/repayment during real protocol Recovery Mode; later direct MUSD
close; funded bounded guard and history; keeper monitoring/stale/error/retry;
scoped stats; and selection/owner exit of a funded retained legacy clone while
the current clone is empty. The generation selector and discovery retry were
also verified disabled while the local wallet held fee consent pending.

- [result.json](result.json): phase results, public local identities, decoded fee,
  positions and retained-selection outcome, with explicit local/fork scope.
- [receipts-local-fork.json](receipts-local-fork.json): the 17 successful local
  transaction receipts. Factory deployment identity/block is recorded separately
  in `result.json`; this is not a live release manifest.
- [recovery-repay-local-fork.png](recovery-repay-local-fork.png): Recovery Mode,
  owner repayment, unchanged collateral and disabled full-close control.
- [keeper-monitoring-local-fork.png](keeper-monitoring-local-fork.png): separately
  labelled local authenticated chain evidence and synthetic read-only service.
- [retained-funded-local-fork.png](retained-funded-local-fork.png): funded legacy
  clone remains selected instead of the new empty clone; its later owner exit
  is confirmed in the result/receipts. Legacy opens may show policy unavailable
  in the intercepted RPC fixture; owner exit remains available and was tested.

Screenshots are unedited browser captures with a LOCAL ANVIL FORK banner.
Public explorer links visible in the app do not make local transaction hashes
valid on the public explorer. No keys, checkpoints, failed attempts or pitch
assets are included here.

Reproduce with `scripts/browser-wave2.cjs` using a dedicated Anvil on port 28747,
`--prepare`, a local-only `Deploy.s.sol` broadcast with finite limits and opens
paused, then `--run`. The harness starts an isolated Next copy on port 43127,
intercepts testnet RPC to localhost and refuses remote signing, raw signing and
other wallet chains. `--restore` returns only this local fixture to its saved
checkpoint for a repeat run. Playwright/Chromium and the existing web dependency
installation are required. Never use a real signing identity for this harness.
