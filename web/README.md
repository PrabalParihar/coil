# Coil web

Next.js app for Coil. Connect a wallet on Mezo testnet, preview a loop from the live oracle and the MUSD/BTC pool, then create an account, loop, unwind, and set the guard.

Setup, contract addresses, and risks are in the repository README.

```bash
npm install
npm run dev
```

The dev server listens on [http://127.0.0.1:43123](http://127.0.0.1:43123).

The app defaults to the live testnet factory `0x0bF9984BA4b68Afee3d697b866a2a1d24A5c027c`. Set `NEXT_PUBLIC_COIL_FACTORY` in `.env.local` to use a different one.
