# Coil web

Next.js app for Coil. Connect a wallet on Mezo testnet, preview a loop from the live oracle and the MUSD/BTC pool, then create an account, loop, de-lever, unwind, and set the guard.

Setup, contract addresses, and risks are in the repository README.

```bash
npm install
npm run dev
```

The dev server listens on [http://127.0.0.1:43123](http://127.0.0.1:43123).

`npm run build` writes a static export to `out/`. The live demo at [coil.up.railway.app](https://coil.up.railway.app) serves that export. On Vercel, set the project root to `web`. The app defaults to the live testnet factory `0xE29fAf17ed44B43c94D2Ff0e43E289aE49D98a3e`. Set `NEXT_PUBLIC_COIL_FACTORY` in `.env.local` to use a different one.
