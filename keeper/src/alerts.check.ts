import { deviationBps, musdBelowPegBps, needsGuard, notify, telegramFromEnv, type GuardPosition } from "./alerts.js";

function assertEq<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

const base: GuardPosition = {
  active: true,
  cr: 130n * 10n ** 16n,
  redemptionRank: 3n,
  floorCR: 140n * 10n ** 16n,
  guardTargetCR: 150n * 10n ** 16n,
  redemptionZone: 0,
};

assertEq(needsGuard(base), "collateral ratio is under the floor", "floor");
assertEq(
  needsGuard({ ...base, floorCR: 0n, redemptionZone: 8 }),
  "trove is inside the redemption zone",
  "zone",
);
assertEq(
  needsGuard({ ...base, floorCR: 0n }, { belowPegBps: 80n, pegGuardBps: 50 }),
  "MUSD is under $1 and the trove is near the redemption queue",
  "peg",
);
assertEq(needsGuard({ ...base, floorCR: 0n }, { belowPegBps: 80n, pegGuardBps: 0 }), null, "peg off");
assertEq(
  needsGuard({ ...base, floorCR: 0n, redemptionRank: (1n << 256n) - 1n }, { belowPegBps: 80n, pegGuardBps: 50 }),
  null,
  "outside the walk",
);
assertEq(needsGuard({ ...base, cr: 160n * 10n ** 16n }), null, "already at target");

const oracle = 80_125n * 10n ** 18n;
const btc = 738n * 10n ** 15n;
const rich = (80_745n * 10n ** 18n * 738n) / 1000n;
const below = musdBelowPegBps(rich, btc, oracle);
const gap = deviationBps(rich, btc, oracle);
if (below <= 50n || below >= 150n) throw new Error(`below peg ${below}`);
if (gap <= 50n) throw new Error(`gap ${gap}`);
assertEq(musdBelowPegBps((oracle * btc) / 10n ** 18n, btc, oracle), 0n, "at peg");

assertEq(telegramFromEnv({} as NodeJS.ProcessEnv), null, "no env");
assertEq(telegramFromEnv({ TELEGRAM_BOT_TOKEN: "secret", TELEGRAM_CHAT_ID: "" } as NodeJS.ProcessEnv), null, "no chat");
const tg = telegramFromEnv({ TELEGRAM_BOT_TOKEN: "123:secret", TELEGRAM_CHAT_ID: "42" } as NodeJS.ProcessEnv);
if (!tg) throw new Error("telegram client missing");

let fetched = "";
const lines: string[] = [];
await notify(
  tg,
  "rescue",
  async (url) => {
    fetched = url;
    return { ok: false, status: 401, text: async () => "unauthorized" };
  },
  (line) => lines.push(line),
);
if (!fetched.includes("/bot123:secret/")) throw new Error("request did not use the token");
if (lines.length !== 1 || lines[0]?.includes("secret") || lines[0]?.includes(fetched)) {
  throw new Error(`token leaked into the log: ${lines.join(" | ")}`);
}
await notify(null, "nope", async () => {
  throw new Error("fetch should not run");
});

console.log("alerts ok");
