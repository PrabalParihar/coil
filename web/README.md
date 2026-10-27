# Coil web

Next.js app for Coil. Connect a wallet on Mezo testnet, preview a loop from the live oracle and the MUSD/BTC pool, then create an account, loop, de-lever, unwind, and set the guard.

Setup, contract addresses, and risks are in the repository README.

```bash
npm install
npm run dev
```

The dev server listens on [http://127.0.0.1:43123](http://127.0.0.1:43123).

`npm run build` writes a static export to `out/`. The live demo at [coil.up.railway.app](https://coil.up.railway.app) serves that export. On Vercel, set the project root to `web`. The app defaults to the live Wave 2 factory `0x2218D33d2f9279A4266b49dB572F5b1343d09De5` (block 16407578). Set `NEXT_PUBLIC_COIL_FACTORY` in `.env.local` to use a different one. That factory has the reserve and the peg gate. Close fixes that spend the reserve and skip a failing BTC sale need a newer factory. `/stats` is the public count page. Mainnet numbers on the desk are read-only.
