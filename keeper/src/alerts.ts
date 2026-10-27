import { isAddress, type Address } from "viem";

export type GuardPosition = {
  active: boolean;
  cr: bigint;
  redemptionRank: bigint;
  floorCR: bigint;
  guardTargetCR: bigint;
  redemptionZone: number;
};

export type PegSnapshot = {
  belowPegBps: bigint;
  pegGuardBps: number;
};

const OUTSIDE = (1n << 256n) - 1n;
const WAD = 10n ** 18n;
const BPS = 10_000n;

export function deviationBps(reserveMusd: bigint, reserveBtc: bigint, oraclePrice: bigint) {
  if (reserveBtc === 0n || oraclePrice === 0n) return OUTSIDE;
  const poolPrice = (reserveMusd * WAD) / reserveBtc;
  const diff = poolPrice > oraclePrice ? poolPrice - oraclePrice : oraclePrice - poolPrice;
  return (diff * BPS) / oraclePrice;
}

export function musdBelowPegBps(reserveMusd: bigint, reserveBtc: bigint, oraclePrice: bigint) {
  if (reserveBtc === 0n || oraclePrice === 0n) return 0n;
  const poolPrice = (reserveMusd * WAD) / reserveBtc;
  if (poolPrice <= oraclePrice) return 0n;
  return ((poolPrice - oraclePrice) * BPS) / poolPrice;
}

/** Same rule as `CoilAccount.guard`: a zero redemption zone uses the bottom 8 for the peg trigger. */
export function pegZone(redemptionZone: number) {
  return redemptionZone === 0 ? 8 : redemptionZone;
}

export function needsGuard(position: GuardPosition, peg?: PegSnapshot) {
  if (!position.active || position.guardTargetCR === 0n) return null;
  if (position.cr >= position.guardTargetCR) return null;
  const crRisk = position.floorCR > 0n && position.cr < position.floorCR;
  const inZone =
    position.redemptionZone > 0 &&
    position.redemptionRank > 0n &&
    position.redemptionRank !== OUTSIDE &&
    position.redemptionRank <= BigInt(position.redemptionZone);
  const zone = pegZone(position.redemptionZone);
  const pegRisk =
    peg !== undefined &&
    peg.pegGuardBps > 0 &&
    peg.belowPegBps >= BigInt(peg.pegGuardBps) &&
    position.redemptionRank > 0n &&
    position.redemptionRank !== OUTSIDE &&
    position.redemptionRank <= BigInt(zone);
  if (crRisk) return "collateral ratio is under the floor";
  if (inZone) return "trove is inside the redemption zone";
  if (pegRisk) return "MUSD is under $1 and the trove is near the redemption queue";
  return null;
}

export type Telegram = {
  token: string;
  chatId: string;
  offset: number;
};

export function telegramFromEnv(env: NodeJS.ProcessEnv = process.env): Telegram | null {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) return null;
  return { token, chatId, offset: 0 };
}

type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/**
 * Posts one alert. The bot token stays in the request URL and is never written to the log.
 * A missing client is a no-op so the keeper runs without Telegram.
 */
export async function notify(
  tg: Telegram | null,
  text: string,
  fetchImpl: FetchLike = fetch,
  log: (line: string) => void = (line) => console.error(line),
) {
  if (!tg) return;
  const response = await fetchImpl(`https://api.telegram.org/bot${tg.token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: tg.chatId, text, disable_web_page_preview: true }),
  });
  if (!response.ok) {
    const body = await response.text();
    log(`telegram ${response.status}: ${body.slice(0, 200)}`);
  }
}

export function isWatchAddress(value: string | undefined): value is Address {
  return Boolean(value && isAddress(value));
}

export type SaleBackoff = { until: number; cr: bigint };

/** True while a no-op guard should stay quiet. A changed collateral ratio ends the wait. */
export function saleBackoffActive(entry: SaleBackoff | undefined, cr: bigint, now: number) {
  return entry !== undefined && entry.cr === cr && now < entry.until;
}
