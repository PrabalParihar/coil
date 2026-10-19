import { addr } from "./mezo";

const WAD = 10n ** 18n;
const MCR = 11n * 10n ** 17n;
const GAS = 200n * WAD;
const BPS = 10_000n;
const OPEN_HEADROOM = 5n * 10n ** 15n;
const CR_BUFFER = 3n * 10n ** 15n;
const MAX_ITERS = 6;

export type Market = {
  price: bigint;
  borrowRate: bigint;
  minNetDebt: bigint;
  refiPct: bigint;
  reserveMusd: bigint;
  reserveBtc: bigint;
  feeBps: bigint;
};

export type LoopPreview = {
  collateral: bigint;
  debt: bigint;
  cr: bigint;
  liquidationPrice: bigint;
  musdMinted: bigint;
  iterations: number;
  leverage: string;
};

export class QuoteError extends Error {}

function amountOut(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: bigint,
): bigint {
  if (amountIn === 0n || reserveIn === 0n || reserveOut === 0n) return 0n;
  const afterFee = amountIn - (amountIn * feeBps) / BPS;
  if (afterFee <= 0n) return 0n;
  return (afterFee * reserveOut) / (reserveIn + afterFee);
}

function projectedDebt(debt: bigint, amount: bigint, rate: bigint, refiPct: bigint) {
  const fee = (amount * rate) / WAD;
  let next = (debt === 0n ? GAS : debt) + amount + fee;
  if (refiPct !== 0n && next > GAS) {
    const refiBase = ((next - GAS) * refiPct) / 100n;
    next += (refiBase * rate) / WAD;
  }
  return next;
}

function amountFromCap(debt: bigint, cap: bigint, rate: bigint) {
  const base = debt === 0n ? GAS : debt;
  if (cap <= base) return 0n;
  let room = cap - base;
  if (debt !== 0n) room = (room * 995n) / 1000n;
  return (room * WAD) / (WAD + rate);
}

export function quoteLoop(
  collateralIn: bigint,
  targetCR: bigint,
  slippageBps: bigint,
  market: Market,
): LoopPreview {
  if (collateralIn <= 0n) throw new QuoteError("Enter an amount of BTC.");
  if (market.price <= 0n) throw new QuoteError("The Mezo price feed returned zero.");
  if (slippageBps <= 0n || slippageBps > 300n) {
    throw new QuoteError("Slippage must sit between 0.01% and 3%.");
  }

  let coll = collateralIn;
  let debt = 0n;
  let minted = 0n;
  let reserveMusd = market.reserveMusd;
  let reserveBtc = market.reserveBtc;
  let iterations = 0;

  const btcMinOut = (musdIn: bigint) => {
    const quoted = amountOut(musdIn, reserveMusd, reserveBtc, market.feeBps);
    return (quoted * (BPS - slippageBps)) / BPS;
  };

  const projectedCR = (amount: bigint) => {
    const out = btcMinOut(amount);
    const nextDebt = projectedDebt(debt, amount, market.borrowRate, market.refiPct);
    if (nextDebt === 0n) return 2n ** 256n - 1n;
    return ((coll + out) * market.price) / nextDebt;
  };

  for (let i = 0; i < MAX_ITERS; i++) {
    if (debt !== 0n && (coll * market.price) / debt <= targetCR) break;
    const cap =
      debt === 0n
        ? (coll * market.price) / (MCR + OPEN_HEADROOM)
        : (coll * market.price) / MCR;
    const maxAmt = amountFromCap(debt, cap, market.borrowRate);
    const minAmt =
      debt === 0n
        ? (market.minNetDebt * WAD + (WAD + market.borrowRate) - 1n) /
          (WAD + market.borrowRate)
        : 10n ** 16n;

    let amount = 0n;
    if (maxAmt !== 0n && minAmt <= maxAmt && projectedCR(minAmt) >= targetCR) {
      if (projectedCR(maxAmt) >= targetCR) {
        amount = maxAmt;
      } else {
        let lo = minAmt;
        let hi = maxAmt;
        for (let s = 0; s < 18; s++) {
          const mid = (lo + hi + 1n) / 2n;
          if (projectedCR(mid) >= targetCR) lo = mid;
          else hi = mid - 1n;
        }
        amount = lo;
      }
    }

    if (amount === 0n) break;
    const quoted = amountOut(amount, reserveMusd, reserveBtc, market.feeBps);
    const received = (quoted * (BPS - slippageBps)) / BPS;
    if (received === 0n) break;
    const afterFee = amount - (amount * market.feeBps) / BPS;
    reserveMusd += afterFee;
    reserveBtc -= quoted;
    debt = projectedDebt(debt, amount, market.borrowRate, market.refiPct);
    coll += received;
    minted += amount;
    iterations += 1;
    if ((coll * market.price) / debt <= targetCR + CR_BUFFER) break;
  }

  if (debt === 0n) {
    throw new QuoteError(
      "This deposit cannot open at that ratio. Mezo requires at least 1,800 MUSD of debt, and borrowing that much would land under your target. Add BTC or choose a lower collateral ratio.",
    );
  }

  return {
    collateral: coll,
    debt,
    cr: (coll * market.price) / debt,
    liquidationPrice: (MCR * debt) / coll,
    musdMinted: minted,
    iterations,
    leverage: leverageLabel((coll * market.price) / debt),
  };
}

export function leverageLabel(cr: bigint) {
  if (cr <= WAD) return "—";
  const bps = (cr * 100n) / (cr - WAD);
  const whole = bps / 100n;
  const frac = (bps % 100n).toString().padStart(2, "0");
  return `${whole}.${frac}×`;
}

export function percentToCr(percent: number) {
  return BigInt(Math.round(percent * 100)) * 10n ** 14n;
}

export function crToPercent(cr: bigint) {
  const hundredths = (cr * 10000n) / WAD;
  return Number(hundredths) / 100;
}

export function formatBtc(value: bigint, digits = 4) {
  return trim(value, 18, digits);
}

export function formatMusd(value: bigint, digits = 2) {
  return trim(value, 18, digits);
}

export function formatUsd(value: bigint, digits = 0) {
  return `$${trim(value, 18, digits)}`;
}

export function formatPercent(cr: bigint) {
  const hundredths = (cr * 10000n) / WAD;
  const whole = hundredths / 100n;
  const frac = (hundredths % 100n).toString().padStart(2, "0");
  return `${whole}.${frac}%`;
}

function trim(value: bigint, decimals: number, digits: number) {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = value % base;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, digits);
  const trimmed = fracStr.replace(/0+$/, "");
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return trimmed ? `${wholeStr}.${trimmed}` : wholeStr;
}

export function poolReserves(
  token0: string,
  reserve0: bigint,
  reserve1: bigint,
) {
  if (token0.toLowerCase() === addr.musd.toLowerCase()) {
    return { reserveMusd: reserve0, reserveBtc: reserve1 };
  }
  return { reserveMusd: reserve1, reserveBtc: reserve0 };
}
