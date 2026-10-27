import { addr } from "./mezo";

const WAD = 10n ** 18n;
const MCR = 11n * 10n ** 17n;
const GAS = 200n * WAD;
const BPS = 10_000n;
const OPEN_HEADROOM = 5n * 10n ** 15n;
const CR_BUFFER = 3n * 10n ** 15n;
const MAX_SWAPS = 2;

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

  for (let i = 0; i < MAX_SWAPS; i++) {
    if (debt !== 0n && (coll * market.price) / debt <= targetCR) break;
    const last = i + 1 >= MAX_SWAPS;
    const refiPct = last ? 0n : market.refiPct;
    const projectedCR = (amount: bigint) => {
      const out = btcMinOut(amount);
      const nextDebt = projectedDebt(debt, amount, market.borrowRate, refiPct);
      if (nextDebt === 0n) return 2n ** 256n - 1n;
      return ((coll + out) * market.price) / nextDebt;
    };
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
    debt = projectedDebt(debt, amount, market.borrowRate, refiPct);
    coll += received;
    minted += amount;
    iterations += 1;
    if (last || (coll * market.price) / debt <= targetCR + CR_BUFFER) break;
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

export type FlashPreview = LoopPreview & {
  flashBtc: bigint;
  poolFeeMusd: bigint;
};

function amountIn(
  reserveIn: bigint,
  reserveOut: bigint,
  amountOut_: bigint,
  feeBps: bigint,
): bigint {
  if (amountOut_ === 0n || amountOut_ >= reserveOut || feeBps >= BPS || reserveIn === 0n) return 0n;
  const outLeft = reserveOut - amountOut_;
  const net = BPS - feeBps;
  let guess = (reserveIn * amountOut_ * BPS) / (outLeft * net) + 1n;
  for (let i = 0; i < 8; i++) {
    const fee = (guess * feeBps) / BPS;
    if (fee >= guess) return 0n;
    const kept = guess - fee;
    const balIn = reserveIn + kept;
    if (balIn * outLeft >= reserveIn * reserveOut) return guess;
    guess += 1n;
  }
  return 0n;
}

function openDebt(amount: bigint, rate: bigint) {
  return GAS + amount + (amount * rate) / WAD;
}

type Fit = { ok: boolean; owed: bigint; minted: bigint };

function flashFits(
  deposit: bigint,
  targetCR: bigint,
  market: Market,
  minAmt: bigint,
  flash: bigint,
): Fit {
  let owed = 0n;
  if (flash > 0n) {
    owed = amountIn(market.reserveMusd, market.reserveBtc, flash, market.feeBps);
    if (owed === 0n) return { ok: false, owed: 0n, minted: 0n };
  }
  const minted = owed < minAmt ? minAmt : owed;
  const coll = deposit + flash;
  if (coll === 0n || minted === 0n) return { ok: false, owed, minted };
  const debt = openDebt(minted, market.borrowRate);
  const cap = (coll * market.price) / (MCR + OPEN_HEADROOM);
  if (debt > cap) return { ok: false, owed, minted };
  if ((coll * market.price) / debt < targetCR) return { ok: false, owed, minted };
  return { ok: true, owed, minted };
}

/** One-transaction flash loop. Matches `FlashSizer` for a fresh trove. */
export function quoteFlashLoop(
  collateralIn: bigint,
  targetCR: bigint,
  slippageBps: bigint,
  market: Market,
): FlashPreview {
  if (collateralIn <= 0n) throw new QuoteError("Enter an amount of BTC.");
  if (market.price <= 0n) throw new QuoteError("The Mezo price feed returned zero.");
  if (slippageBps <= 0n || slippageBps > 300n) {
    throw new QuoteError("Slippage must sit between 0.01% and 3%.");
  }
  if (targetCR < 115n * 10n ** 16n) throw new QuoteError("Coil will not target below 115%.");
  if (market.reserveBtc < 5n) throw new QuoteError("The MUSD/BTC pool has no BTC liquidity.");

  const minAmt =
    (market.minNetDebt * WAD + (WAD + market.borrowRate) - 1n) / (WAD + market.borrowRate);

  let hi = market.reserveBtc / 5n;
  let lo = 0n;
  let best = 0n;
  for (let i = 0; i < 72; i++) {
    const mid = (lo + hi + 1n) / 2n;
    if (flashFits(collateralIn, targetCR, market, minAmt, mid).ok) {
      best = mid;
      lo = mid;
    } else if (mid === 0n) {
      break;
    } else {
      hi = mid - 1n;
    }
  }

  let chosen = flashFits(collateralIn, targetCR, market, minAmt, best);
  let flash = best;
  if (!chosen.ok) {
    chosen = flashFits(collateralIn, targetCR, market, minAmt, 0n);
    flash = 0n;
  }
  if (!chosen.ok || chosen.minted === 0n) {
    throw new QuoteError(
      "This deposit cannot open at that ratio. Mezo requires at least 1,800 MUSD of debt, and borrowing that much would land under your target. Add BTC or choose a lower collateral ratio.",
    );
  }
  if (flash > 0n) {
    const fair = (flash * market.price) / WAD;
    if (fair === 0n || chosen.owed > (fair * (BPS + slippageBps)) / BPS) {
      throw new QuoteError(
        "The pool quote is outside your slippage. Raise the slippage limit or choose a higher collateral ratio.",
      );
    }
  }

  const coll = collateralIn + flash;
  const debt = openDebt(chosen.minted, market.borrowRate);
  const cr = (coll * market.price) / debt;
  return {
    collateral: coll,
    debt,
    cr,
    liquidationPrice: (MCR * debt) / coll,
    musdMinted: chosen.minted,
    iterations: flash === 0n ? 0 : 1,
    leverage: leverageLabel(cr),
    flashBtc: flash,
    poolFeeMusd: (chosen.owed * market.feeBps) / BPS,
  };
}

/** Nominal ICR, Liquity scale: collateral * 1e20 / debt. */
export function nominalIcr(collateral: bigint, debt: bigint) {
  if (debt === 0n) return 0n;
  return (collateral * 10n ** 20n) / debt;
}

/** Convert a nominal ICR and a price into a collateral ratio (1e18 = 100%). */
export function icrFromNominal(nicr: bigint, price: bigint) {
  if (nicr === 0n || price === 0n) return 0n;
  return (nicr * price) / 10n ** 20n;
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

/** Price impact of selling `amountIn_` of the input reserve. Matches `FlashSizer.impactBps`. */
export function impactBps(reserveIn: bigint, reserveOut: bigint, amountIn_: bigint, feeBps: bigint) {
  if (amountIn_ === 0n || reserveIn === 0n || reserveOut === 0n || feeBps >= BPS) return 0n;
  const spot = (amountIn_ * reserveOut) / reserveIn;
  if (spot === 0n) return BPS;
  const fee = (amountIn_ * feeBps) / BPS;
  if (fee >= amountIn_) return BPS;
  const kept = amountIn_ - fee;
  const outAmt = (reserveOut * kept) / (reserveIn + kept);
  if (outAmt >= spot) return 0n;
  return ((spot - outAmt) * BPS) / spot;
}

export type SensibleOpen = {
  targetCR: bigint;
  impact: bigint;
  leverage: string;
  capped: boolean;
};

const SENSIBLE_RUNGS = [
  { cr: (4n * 10n ** 18n) / 3n, leverage: "4.00×" },
  { cr: (3n * 10n ** 18n) / 2n, leverage: "3.00×" },
  { cr: 2n * 10n ** 18n, leverage: "2.00×" },
  { cr: 3n * 10n ** 18n, leverage: "1.50×" },
  { cr: 4n * 10n ** 18n, leverage: "1.33×" },
] as const;

function flashOwed(deposit: bigint, targetCR: bigint, market: Market): bigint | null {
  if (deposit <= 0n || market.price <= 0n || market.reserveBtc < 5n) return null;
  const minAmt =
    (market.minNetDebt * WAD + (WAD + market.borrowRate) - 1n) / (WAD + market.borrowRate);
  let hi = market.reserveBtc / 5n;
  let lo = 0n;
  let best = 0n;
  for (let i = 0; i < 72; i++) {
    const mid = (lo + hi + 1n) / 2n;
    if (flashFits(deposit, targetCR, market, minAmt, mid).ok) {
      best = mid;
      lo = mid;
    } else if (mid === 0n) {
      break;
    } else {
      hi = mid - 1n;
    }
  }
  let chosen = flashFits(deposit, targetCR, market, minAmt, best);
  if (!chosen.ok) chosen = flashFits(deposit, targetCR, market, minAmt, 0n);
  if (!chosen.ok || chosen.minted === 0n) return null;
  return chosen.owed;
}

/**
 * Highest leverage whose MUSD sale stays within `maxImpactBps` (default 1%).
 * Keep this in lockstep with `FlashSizer.sensibleTarget`.
 * `capped` is false when every rung that can open is over the cap.
 */
export function sensibleOpen(deposit: bigint, market: Market, maxImpactBps = 100n): SensibleOpen {
  let bestImpact = (1n << 256n) - 1n;
  let best = SENSIBLE_RUNGS[SENSIBLE_RUNGS.length - 1]!;
  let any = false;
  for (const rung of SENSIBLE_RUNGS) {
    const owed = flashOwed(deposit, rung.cr, market);
    if (owed === null) continue;
    const bps = impactBps(market.reserveMusd, market.reserveBtc, owed, market.feeBps);
    any = true;
    if (bps < bestImpact) {
      bestImpact = bps;
      best = rung;
    }
    if (bps <= maxImpactBps) {
      return { targetCR: rung.cr, impact: bps, leverage: rung.leverage, capped: true };
    }
  }
  if (!any) return { targetCR: 0n, impact: bestImpact, leverage: "—", capped: false };
  return { targetCR: best.cr, impact: bestImpact, leverage: best.leverage, capped: false };
}

/** Absolute pool-vs-oracle gap. Matches `CoilLegacy.deviationBps`. */
export function deviationBps(reserveMusd: bigint, reserveBtc: bigint, oraclePrice: bigint) {
  if (reserveBtc === 0n || oraclePrice === 0n) return (1n << 256n) - 1n;
  const poolPrice = (reserveMusd * WAD) / reserveBtc;
  const diff = poolPrice > oraclePrice ? poolPrice - oraclePrice : oraclePrice - poolPrice;
  return (diff * BPS) / oraclePrice;
}

/** How far MUSD sits under $1. Zero when the pool price is at or below the oracle. */
export function musdBelowPegBps(reserveMusd: bigint, reserveBtc: bigint, oraclePrice: bigint) {
  if (reserveBtc === 0n || oraclePrice === 0n) return 0n;
  const poolPrice = (reserveMusd * WAD) / reserveBtc;
  if (poolPrice <= oraclePrice) return 0n;
  return ((poolPrice - oraclePrice) * BPS) / poolPrice;
}
